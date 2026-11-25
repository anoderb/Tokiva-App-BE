import { supabaseAdmin } from '../../lib/supabase.js';

/**
 * Standarisasi kode_kelas ke format slug tanda hubung (-) huruf kecil.
 * Contoh: "Indomie Goreng_85g!" -> "indomie-goreng-85g"
 */
export function slugifyKodeKelas(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Bangun path kanonik dataset di Hugging Face Hub: data/{kode-kelas}/{nama_file}
 */
export function buildHfSamplePath(kodeKelas, fileName) {
  const cleanKode = String(kodeKelas || 'umum').trim().replace(/^\/+|\/+$/g, '') || 'umum';
  const cleanFile = String(fileName || '').trim().replace(/^\/+/, '');
  return `data/${cleanKode}/${cleanFile}`;
}

export function extractHfFolderFromPath(hfPath) {
  const match = String(hfPath || '')
    .trim()
    .replace(/^\/+/, '')
    .match(/^(?:data|dataset)\/([^/]+)\//);
  return match ? match[1] : null;
}

export function pickDominantHfFolder(hfPaths = [], fallbackKodeKelas = '') {
  const counts = new Map();
  for (const p of hfPaths) {
    const folder = extractHfFolderFromPath(p);
    if (!folder) continue;
    counts.set(folder, (counts.get(folder) || 0) + 1);
  }
  const preferred = [...counts.entries()]
    .filter(([folder]) => !/^CLS-\d+$/i.test(folder))
    .sort((a, b) => b[1] - a[1]);
  if (preferred.length > 0) return preferred[0][0];

  const cleanFallback = String(fallbackKodeKelas || '').trim();
  if (cleanFallback && !/^CLS-\d+$/i.test(cleanFallback)) {
    return slugifyKodeKelas(cleanFallback) || cleanFallback;
  }
  return slugifyKodeKelas(cleanFallback) || 'umum';
}

/** Memetakan kelas_id ke nama folder Hugging Face kanonik (prioritas folder slug mayoritas). */
export async function resolveCanonicalHfFoldersMap(kelasEntries = [], { dbClient = supabaseAdmin } = {}) {
  const byId = new Map();
  for (const entry of kelasEntries) {
    if (entry?.id && !byId.has(entry.id)) {
      byId.set(entry.id, entry.kode_kelas || '');
    }
  }
  const result = new Map();
  if (byId.size === 0) return result;

  await Promise.all(
    [...byId.entries()].map(async ([kId, fallbackKode]) => {
      const { data: rows } = await dbClient
        .from('ai_sampel')
        .select('hf_path')
        .eq('kelas_id', kId)
        .not('hf_path', 'is', null)
        .limit(50);
      const folder = pickDominantHfFolder((rows || []).map((r) => r.hf_path), fallbackKode);
      result.set(kId, folder);
    })
  );
  return result;
}

export async function resolveCanonicalHfFolderForClass(kelasId, fallbackKodeKelas = '', options = {}) {
  if (!kelasId) return pickDominantHfFolder([], fallbackKodeKelas);
  const map = await resolveCanonicalHfFoldersMap([{ id: kelasId, kode_kelas: fallbackKodeKelas }], options);
  return map.get(kelasId) || pickDominantHfFolder([], fallbackKodeKelas);
}

/**
 * Lindungi file pada folder inferensi-log/ di Supabase Storage agar pratinjau
 * audit ai_log_inferensi.foto_cuplikan tetap utuh setelah sinkronisasi/hapus sampel.
 */
export function isProtectedStagingPath(storagePath) {
  if (!storagePath) return true;
  return String(storagePath).replace(/^\/+/, '').startsWith('inferensi-log/');
}

/**
 * Pecah array menjadi potongan berukuran maksimal `size`
 */
export function chunkArray(items = [], size = 40) {
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Hitung ulang metrik (total_foto, jml_supabase, jml_hf, status) pada ai_kelas
 */
export async function recountKelasMetrics(kelasIds) {
  const uniqueIds = [...new Set([...(kelasIds || [])].filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const nowIso = new Date().toISOString();

  await Promise.all(
    uniqueIds.map(async (kId) => {
      const [
        { count: totalCount },
        { count: sbCount },
        { count: hfCount },
        { data: kelasRow },
      ] = await Promise.all([
        supabaseAdmin.from('ai_sampel').select('id', { count: 'exact', head: true }).eq('kelas_id', kId),
        supabaseAdmin
          .from('ai_sampel')
          .select('id', { count: 'exact', head: true })
          .eq('kelas_id', kId)
          .eq('lokasi_simpan', 'supabase'),
        supabaseAdmin
          .from('ai_sampel')
          .select('id', { count: 'exact', head: true })
          .eq('kelas_id', kId)
          .eq('lokasi_simpan', 'huggingface'),
        supabaseAdmin.from('ai_kelas').select('target_foto').eq('id', kId).maybeSingle(),
      ]);

      const totalFoto = totalCount || 0;
      const jmlSupabase = sbCount || 0;
      const jmlHf = hfCount || 0;
      const target = Number(kelasRow?.target_foto || 100);

      let statusBaru = 'Kurang Data';
      if (jmlHf >= target) {
        statusBaru = 'Siap Training';
      } else if (totalFoto >= target) {
        statusBaru = 'Siap Verifikasi';
      }

      await supabaseAdmin
        .from('ai_kelas')
        .update({
          total_foto: totalFoto,
          jml_supabase: jmlSupabase,
          jml_hf: jmlHf,
          status: statusBaru,
          diubah_pada: nowIso,
        })
        .eq('id', kId);
    })
  );
}
