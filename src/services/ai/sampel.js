import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound, BadRequest } from '../../utils/errors.js';
import {
  buildHfSamplePath,
  isProtectedStagingPath,
  recountKelasMetrics,
} from './helpers.js';
import {
  deleteFilesFromHuggingFace,
  moveFilesInHuggingFace,
} from './huggingface.js';
import { uploadBurstSampel } from './sampel-upload.js';

export { uploadBurstSampel };

/**
 * Daftar Sampel Foto AI (Review & Kurasi Dataset)
 */
export async function listSampel({ kelas_id, terverifikasi, status, sumber, lokasi_simpan, limit = 50, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('ai_sampel')
    .select(
      `
      *,
      kelas:kelas_id(id, kode_kelas, nama, kategori)
    `,
      { count: 'exact' }
    );

  if (kelas_id) query = query.eq('kelas_id', kelas_id);

  if (lokasi_simpan) {
    if (lokasi_simpan === 'huggingface') {
      query = query.eq('lokasi_simpan', 'huggingface');
    } else if (lokasi_simpan === 'supabase' || lokasi_simpan === 'supabase_temp') {
      query = query.neq('lokasi_simpan', 'huggingface');
    } else {
      query = query.eq('lokasi_simpan', lokasi_simpan);
    }
  }

  if (sumber) {
    if (sumber === 'owner' || sumber === 'owner_produk') {
      query = query.or('sumber.eq.owner_produk,sumber.eq.owner_studio,sumber.eq.owner');
    } else if (sumber === 'kasir') {
      query = query.or('sumber.eq.koreksi_kasir,sumber.eq.kasir');
    } else if (sumber === 'admin') {
      query = query.not('sumber', 'in', '("koreksi_kasir","kasir","owner_produk","owner_studio","owner")');
    } else {
      query = query.eq('sumber', sumber);
    }
  }

  if (terverifikasi !== undefined && terverifikasi !== null && terverifikasi !== '') {
    query = query.eq('terverifikasi', terverifikasi === 'true' || terverifikasi === true);
  } else if (status === 'diterima') {
    query = query.eq('terverifikasi', true);
  } else if (status === 'menunggu') {
    query = query.eq('terverifikasi', false);
  }

  const { data, count, error } = await query.order('dibuat_pada', { ascending: false }).range(from, to);
  if (error) throw error;

  const items = await Promise.all(
    (data || []).map(async (row) => {
      let fotoUrl = row.foto_url || null;
      if (!fotoUrl) {
        if (row.lokasi_simpan === 'huggingface' && row.hf_path) {
          fotoUrl = `/api/media/hf-proxy?path=${encodeURIComponent(row.hf_path)}`;
        } else if (row.path_supabase) {
          const { data: signed } = await supabaseAdmin.storage
            .from('dataset-raw-temp')
            .createSignedUrl(row.path_supabase, 3600);
          fotoUrl = signed?.signedUrl || null;
        }
      }
      return {
        ...row,
        foto_url: fotoUrl,
        tersinkron_hf: row.lokasi_simpan === 'huggingface' || Boolean(row.hf_commit),
      };
    })
  );

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    items,
    pagination: { total, page: Number(page), limit: Number(limit), total_pages: totalPages },
    meta: { total, page: Number(page), limit: Number(limit), totalPages },
  };
}

/**
 * Verifikasi Sampel Foto Sebelum Disinkronkan ke Hugging Face Hub
 */
export async function verifikasiSampel({ sampel_ids = [], terverifikasi, status }) {
  if (!sampel_ids || sampel_ids.length === 0) {
    throw new BadRequest('Daftar ID sampel tidak boleh kosong');
  }
  if (status === 'ditolak') return deleteSampelBatch({ sampel_ids });

  const verifiedBool = terverifikasi !== undefined ? Boolean(terverifikasi) : true;
  const { data, error } = await supabaseAdmin
    .from('ai_sampel')
    .update({ terverifikasi: verifiedBool })
    .in('id', sampel_ids)
    .select('id, nama_file, terverifikasi');

  if (error) throw error;
  return { jumlah_diperbarui: (data || []).length, items: data || [] };
}

/**
 * Hapus Batch Sampel Foto AI (Supabase Storage, Hugging Face & DB) lalu Recount Kelas
 */
export async function deleteSampelBatch({ sampel_ids = [] } = {}) {
  if (!sampel_ids || sampel_ids.length === 0) {
    throw new BadRequest('Daftar ID sampel tidak boleh kosong');
  }

  const { data: rows, error: fErr } = await supabaseAdmin
    .from('ai_sampel')
    .select('id, kelas_id, path_supabase, hf_path, lokasi_simpan')
    .in('id', sampel_ids);
  if (fErr) throw fErr;

  const affectedKelas = new Set((rows || []).map((r) => r.kelas_id).filter(Boolean));
  const storagePaths = [
    ...new Set((rows || []).map((r) => r.path_supabase).filter((p) => p && !isProtectedStagingPath(p))),
  ];
  if (storagePaths.length > 0) {
    await Promise.resolve(supabaseAdmin.storage.from('dataset-raw-temp').remove(storagePaths)).catch(() => {});
  }

  const hfPaths = (rows || []).filter((r) => r.lokasi_simpan === 'huggingface' && r.hf_path).map((r) => r.hf_path);
  const hfRes = await deleteFilesFromHuggingFace(hfPaths, 'Tokiva Delete Samples');

  const { error } = await supabaseAdmin.from('ai_sampel').delete().in('id', sampel_ids);
  if (error) throw error;

  await recountKelasMetrics(affectedKelas);
  return { jumlah_dihapus: (rows || []).length, hf_deleted: hfRes?.deleted || 0 };
}

/**
 * Ubah Kelas Produk untuk Sampel Foto Terpilih (Sync pindah file di Hugging Face + Recount Kelas)
 */
export async function ubahKelasSampel({ sampel_ids = [], kelas_id } = {}) {
  if (!sampel_ids || sampel_ids.length === 0 || !kelas_id) {
    throw new BadRequest('sampel_ids dan kelas_id tujuan wajib diisi');
  }

  const { data: targetKelas, error: kErr } = await supabaseAdmin
    .from('ai_kelas')
    .select('id, kode_kelas')
    .eq('id', kelas_id)
    .maybeSingle();
  if (kErr) throw kErr;
  if (!targetKelas) throw new NotFound('Kelas AI tujuan tidak ditemukan');

  const { data: currentRows, error: fErr } = await supabaseAdmin
    .from('ai_sampel')
    .select('id, kelas_id, nama_file, hf_path, lokasi_simpan')
    .in('id', sampel_ids);
  if (fErr) throw fErr;

  const affectedKelas = new Set([kelas_id, ...(currentRows || []).map((r) => r.kelas_id).filter(Boolean)]);
  const hfMoves = (currentRows || [])
    .filter((r) => r.lokasi_simpan === 'huggingface' && r.hf_path && r.kelas_id !== kelas_id)
    .map((r) => ({ id: r.id, oldPath: r.hf_path, newPath: buildHfSamplePath(targetKelas.kode_kelas, r.nama_file) }));

  const moveRes = await moveFilesInHuggingFace(hfMoves, `Tokiva Move Samples to ${targetKelas.kode_kelas}`);
  const nowIso = new Date().toISOString();
  const movedIdSet = new Set();
  const updatedItems = [];

  for (const moved of moveRes.moved || []) {
    movedIdSet.add(moved.id);
    const { data: upd, error: uErr } = await supabaseAdmin
      .from('ai_sampel')
      .update({ kelas_id, hf_path: moved.newPath, hf_commit: moved.commitOid, tgl_sync: nowIso })
      .eq('id', moved.id)
      .select('id, nama_file, kelas_id')
      .single();
    if (uErr) throw uErr;
    if (upd) updatedItems.push(upd);
  }

  const remainingIds = (currentRows || []).map((r) => r.id).filter((sid) => !movedIdSet.has(sid));
  if (remainingIds.length > 0) {
    const { data: updRest, error: rErr } = await supabaseAdmin
      .from('ai_sampel')
      .update({ kelas_id })
      .in('id', remainingIds)
      .select('id, nama_file, kelas_id');
    if (rErr) throw rErr;
    if (updRest) updatedItems.push(...updRest);
  }

  await recountKelasMetrics(affectedKelas);
  return { jumlah_diperbarui: updatedItems.length, hf_moved: (moveRes.moved || []).length, items: updatedItems };
}
