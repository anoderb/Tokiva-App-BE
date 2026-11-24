import { supabaseAdmin } from '../../lib/supabase.js';
import { config } from '../../config/env.js';
import { BadRequest } from '../../utils/errors.js';
import {
  buildHfSamplePath,
  chunkArray,
  isProtectedStagingPath,
  recountKelasMetrics,
} from './helpers.js';
import {
  UPLOAD_CHUNK_SIZE,
  MAX_SYNC_ALL_ITERATIONS,
  commitWithRetry,
  deleteFilesFromHuggingFace,
  deleteClassFolderFromHuggingFace,
  moveFilesInHuggingFace,
} from './huggingface-ops.js';

export { deleteFilesFromHuggingFace, deleteClassFolderFromHuggingFace, moveFilesInHuggingFace };

/**
 * Sinkronisasi Kumpulan Foto Sampel Terverifikasi ke Hugging Face Dataset Hub
 */
export async function syncDatasetToHuggingFace({
  batch_limit = 50,
  kelas_id = null,
  sync_all = false,
} = {}) {
  if (!config.huggingFace.token) {
    throw new BadRequest('HUGGINGFACE_TOKEN belum dikonfigurasi di file lingkungan .env');
  }

  const repoName = config.huggingFace.datasetRepo;
  const affectedKelasIds = new Set();
  let totalSynced = 0;
  let commitCount = 0;
  let stagingCleaned = 0;
  let lastCommitOid = null;
  let lastCommitUrl = '';
  const processedSampleIds = new Set();

  const perFetchLimit = sync_all ? UPLOAD_CHUNK_SIZE : Math.max(1, Number(batch_limit) || 50);
  const maxIterations = sync_all ? MAX_SYNC_ALL_ITERATIONS : 1;

  for (let iter = 0; iter < maxIterations; iter++) {
    let query = supabaseAdmin
      .from('ai_sampel')
      .select(`
        id,
        nama_file,
        path_supabase,
        kelas_id,
        kelas:kelas_id(id, kode_kelas, target_foto)
      `)
      .eq('terverifikasi', true)
      .is('hf_commit', null)
      .limit(perFetchLimit);

    if (kelas_id) query = query.eq('kelas_id', kelas_id);

    const { data: samples, error: sErr } = await query;
    if (sErr) throw sErr;

    const pendingSamples = (samples || []).filter((s) => !processedSampleIds.has(s.id));
    if (pendingSamples.length === 0) break;

    for (const chunk of chunkArray(pendingSamples, UPLOAD_CHUNK_SIZE)) {
      const operations = [];
      const validSamples = [];

      for (const s of chunk) {
        processedSampleIds.add(s.id);
        if (!s.path_supabase) continue;

        const { data: fileData, error: dlErr } = await supabaseAdmin.storage
          .from('dataset-raw-temp')
          .download(s.path_supabase);

        if (dlErr || !fileData) {
          console.error(`Gagal download sampel ${s.path_supabase}:`, dlErr?.message);
          continue;
        }

        const kodeKelas = s.kelas?.kode_kelas || 'umum';
        const targetPath = buildHfSamplePath(kodeKelas, s.nama_file);

        operations.push({ operation: 'addOrUpdate', path: targetPath, content: fileData });
        validSamples.push({
          id: s.id,
          kelas_id: s.kelas_id,
          hf_path: targetPath,
          old_path_supabase: s.path_supabase,
        });
      }

      if (operations.length === 0) continue;

      const commitTitle = `Tokiva Dataset Sync: ${operations.length} citra sampel (${new Date().toISOString().slice(0, 16)})`;
      let commitResult;
      try {
        commitResult = await commitWithRetry({ title: commitTitle, operations });
      } catch (hfErr) {
        throw new BadRequest(`Gagal sinkronisasi ke Hugging Face Hub: ${hfErr.message}`);
      }

      const commitOid = commitResult.commit?.oid || 'unknown';
      const commitUrl = commitResult.commit?.url || '';
      const nowIso = new Date().toISOString();

      commitCount++;
      lastCommitOid = commitOid;
      lastCommitUrl = commitUrl;

      const cleanablePaths = [];
      for (const item of validSamples) {
        affectedKelasIds.add(item.kelas_id);
        const keepStaging = isProtectedStagingPath(item.old_path_supabase);
        if (!keepStaging) cleanablePaths.push(item.old_path_supabase);

        await supabaseAdmin
          .from('ai_sampel')
          .update({
            hf_repo: repoName,
            hf_path: item.hf_path,
            hf_commit: commitOid,
            tgl_sync: nowIso,
            lokasi_simpan: 'huggingface',
            path_supabase: keepStaging ? item.old_path_supabase : null,
          })
          .eq('id', item.id);
      }

      if (cleanablePaths.length > 0) {
        const { error: rmErr } = await supabaseAdmin.storage.from('dataset-raw-temp').remove(cleanablePaths);
        if (rmErr) {
          console.warn('Peringatan: gagal membersihkan staging dataset-raw-temp:', rmErr.message);
        } else {
          stagingCleaned += cleanablePaths.length;
        }
      }

      totalSynced += validSamples.length;
    }

    if (!sync_all || pendingSamples.length < perFetchLimit) break;
  }

  if (totalSynced === 0) {
    return {
      message: 'Tidak ada sampel foto terverifikasi yang menunggu sinkronisasi',
      jumlah_disinkron: 0,
      jumlah_commit: 0,
      staging_dibersihkan: 0,
      commit: null,
    };
  }

  await recountKelasMetrics(affectedKelasIds);

  return {
    message: `Berhasil menyinkronkan ${totalSynced} sampel ke Hugging Face`,
    jumlah_disinkron: totalSynced,
    jumlah_commit: commitCount,
    staging_dibersihkan: stagingCleaned,
    hf_repo: repoName,
    commit_oid: lastCommitOid,
    commit_url: lastCommitUrl,
  };
}

/**
 * Statistik Ringkasan Dataset di Supabase vs Hugging Face
 */
export async function getDatasetStats() {
  const [
    { data: classes, error: cErr },
    { count: totalTerverifikasi, error: verErr },
    { count: totalMenungguValidasi, error: waitErr },
    { count: totalSiapSyncHf, error: siapErr },
  ] = await Promise.all([
    supabaseAdmin
      .from('ai_kelas')
      .select('id, kode_kelas, nama, target_foto, total_foto, jml_supabase, jml_hf, status'),
    supabaseAdmin.from('ai_sampel').select('id', { count: 'exact', head: true }).eq('terverifikasi', true),
    supabaseAdmin.from('ai_sampel').select('id', { count: 'exact', head: true }).eq('terverifikasi', false),
    supabaseAdmin
      .from('ai_sampel')
      .select('id', { count: 'exact', head: true })
      .eq('terverifikasi', true)
      .neq('lokasi_simpan', 'huggingface'),
  ]);

  if (cErr) throw cErr;
  if (verErr) throw verErr;
  if (waitErr) throw waitErr;
  if (siapErr) throw siapErr;

  let totalTarget = 0;
  let totalTerkumpul = 0;
  let totalSupabase = 0;
  let totalHF = 0;

  for (const c of classes || []) {
    totalTarget += Number(c.target_foto || 100);
    totalTerkumpul += Number(c.total_foto || 0);
    totalSupabase += Number(c.jml_supabase || 0);
    totalHF += Number(c.jml_hf || 0);
  }

  return {
    repo_hf: config.huggingFace.datasetRepo,
    total_kelas: (classes || []).length,
    total_target_dataset: totalTarget,
    total_sampel_terkumpul: totalTerkumpul,
    total_tersimpan_supabase: totalSupabase,
    total_tersinkron_hf: totalHF,
    total_terverifikasi: Number(totalTerverifikasi || 0),
    total_menunggu_validasi: Number(totalMenungguValidasi || 0),
    total_siap_sync_hf: Number(totalSiapSyncHf || 0),
    persentase_siap_hf: totalTarget > 0 ? Number(((totalHF / totalTarget) * 100).toFixed(1)) : 0,
    kelas_detail: classes || [],
  };
}
