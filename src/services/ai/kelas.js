import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound, BadRequest } from '../../utils/errors.js';
import {
  buildHfSamplePath,
  extractHfFolderFromPath,
  isProtectedStagingPath,
  slugifyKodeKelas,
} from './helpers.js';
import {
  deleteClassFolderFromHuggingFace,
  moveFilesInHuggingFace,
} from './huggingface.js';
import {
  listKelasAI,
  getDetailKelasAI,
  createKelasAI as createKelasRecord,
} from './kelas-queries.js';

export { listKelasAI, getDetailKelasAI };

export async function createKelasAI(payload = {}) {
  return createKelasRecord(payload, slugifyKodeKelas);
}

/**
 * Edit Kelas Produk AI (Nama, Kode Kelas + Move HF, Barcode, Kategori, Target Kuota, Status)
 */
export async function updateKelasAI(id, payload = {}) {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('ai_kelas')
    .select('id, kode_kelas')
    .eq('id', id)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!existing) throw new NotFound('Kelas AI tidak ditemukan');

  const nowIso = new Date().toISOString();
  const updateData = { diubah_pada: nowIso };
  if (payload.nama !== undefined && String(payload.nama).trim()) {
    updateData.nama = String(payload.nama).trim();
  }
  if (payload.kode_kelas !== undefined && String(payload.kode_kelas).trim()) {
    const newKode = slugifyKodeKelas(payload.kode_kelas);
    if (!newKode) throw new BadRequest('Kode kelas tidak valid');
    if (newKode !== existing.kode_kelas) {
      const { data: dup } = await supabaseAdmin
        .from('ai_kelas')
        .select('id')
        .eq('kode_kelas', newKode)
        .neq('id', id)
        .maybeSingle();
      if (dup) throw new BadRequest(`Kelas dengan kode '${newKode}' sudah terdaftar`);

      const { data: hfSamples, error: hfFetchErr } = await supabaseAdmin
        .from('ai_sampel')
        .select('id, nama_file, hf_path, lokasi_simpan')
        .eq('kelas_id', id)
        .eq('lokasi_simpan', 'huggingface')
        .not('hf_path', 'is', null);
      if (hfFetchErr) throw hfFetchErr;

      if (hfSamples && hfSamples.length > 0) {
        const moves = hfSamples.map((row) => ({
          id: row.id,
          oldPath: row.hf_path,
          newPath: buildHfSamplePath(newKode, row.nama_file),
        }));
        const moveRes = await moveFilesInHuggingFace(
          moves,
          `Tokiva Rename Class: ${existing.kode_kelas} -> ${newKode}`
        );
        for (const moved of moveRes.moved || []) {
          await supabaseAdmin
            .from('ai_sampel')
            .update({ hf_path: moved.newPath, hf_commit: moved.commitOid, tgl_sync: nowIso })
            .eq('id', moved.id);
        }
      }
    }
    updateData.kode_kelas = newKode;
  }
  if (payload.kategori !== undefined) updateData.kategori = payload.kategori;
  if (payload.barcode !== undefined) updateData.barcode = payload.barcode ? String(payload.barcode).trim() : null;
  if (payload.target_foto !== undefined && Number(payload.target_foto) > 0) {
    updateData.target_foto = Number(payload.target_foto);
  }
  if (payload.status !== undefined) updateData.status = payload.status;

  const { data, error } = await supabaseAdmin.from('ai_kelas').update(updateData).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/**
 * Perbarui Kuota Target Foto Kelas AI
 */
export async function updateTargetKelasAI(id, targetFoto) {
  const numTarget = Number(targetFoto);
  if (!numTarget || numTarget <= 0) throw new BadRequest('Target kuota foto harus lebih dari 0');
  return updateKelasAI(id, { target_foto: numTarget });
}

/**
 * Hapus Kelas AI beserta Seluruh Sampel di Supabase & Hugging Face
 */
export async function deleteKelasAI(id) {
  const { data: cls, error: findErr } = await supabaseAdmin
    .from('ai_kelas')
    .select('id, kode_kelas, nama')
    .eq('id', id)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!cls) throw new NotFound('Kelas AI tidak ditemukan');

  const { data: samples } = await supabaseAdmin
    .from('ai_sampel')
    .select('id, path_supabase, hf_path, lokasi_simpan')
    .eq('kelas_id', id);

  const storagePaths = [
    ...new Set((samples || []).map((r) => r.path_supabase).filter((p) => p && !isProtectedStagingPath(p))),
  ];
  if (storagePaths.length > 0) {
    await Promise.resolve(supabaseAdmin.storage.from('dataset-raw-temp').remove(storagePaths)).catch(() => {});
  }

  const knownHfPaths = (samples || []).filter((r) => r.lokasi_simpan === 'huggingface' && r.hf_path).map((r) => r.hf_path);
  const targetFolders = [...new Set([cls.kode_kelas, ...knownHfPaths.map(extractHfFolderFromPath)].filter(Boolean))];
  let totalHfDeleted = 0;
  for (const folder of targetFolders) {
    const folderPaths = knownHfPaths.filter((p) => extractHfFolderFromPath(p) === folder);
    const hfRes = await deleteClassFolderFromHuggingFace(folder, folderPaths);
    totalHfDeleted += hfRes?.deleted || 0;
  }

  await supabaseAdmin.from('ai_sampel').delete().eq('kelas_id', id);
  const { error: delErr } = await supabaseAdmin.from('ai_kelas').delete().eq('id', id);
  if (delErr) throw delErr;

  return { deleted: true, id: cls.id, nama: cls.nama, hf_deleted: totalHfDeleted };
}

/**
 * Daftar Produk Toko yang Belum Terpetakan ke Kelas AI
 */
export async function listUnmappedProduk() {
  const [{ data: classes }, { data: products }] = await Promise.all([
    supabaseAdmin.from('ai_kelas').select('id, kode_kelas, nama, barcode, master_id'),
    supabaseAdmin
      .from('produk')
      .select('id, nama, sku, barcode, foto_url, master_id, toko:toko_id(id, nama), kategori:kategori_id(id, nama)')
      .eq('aktif', true)
      .order('dibuat_pada', { ascending: false })
      .limit(200),
  ]);

  const mappedMasterIds = new Set((classes || []).map((c) => c.master_id).filter(Boolean));
  const mappedBarcodes = new Set((classes || []).map((c) => c.barcode).filter(Boolean));
  const mappedSlugs = new Set((classes || []).map((c) => c.kode_kelas).filter(Boolean));

  return (products || []).filter((p) => {
    if (p.master_id && mappedMasterIds.has(p.master_id)) return false;
    if (p.barcode && mappedBarcodes.has(p.barcode)) return false;
    return !mappedSlugs.has(slugifyKodeKelas(p.nama));
  });
}

/**
 * Petakan Produk Toko ke Kelas AI Existing atau Buat Kelas AI Baru
 */
export async function mapProdukKeKelas(payload = {}) {
  const { produk_id, kelas_id, buat_kelas_baru = false, nama_kelas, kategori = 'Kebutuhan Harian', barcode } = payload;
  if (!produk_id) throw new BadRequest('ID produk wajib diisi');

  const { data: prod, error: pErr } = await supabaseAdmin
    .from('produk')
    .select('id, nama, barcode, master_id, foto_url')
    .eq('id', produk_id)
    .maybeSingle();
  if (pErr || !prod) throw new NotFound('Produk tidak ditemukan');

  let targetKelas = null;
  if (buat_kelas_baru) {
    targetKelas = await createKelasAI({
      nama: nama_kelas || prod.nama,
      kategori,
      barcode: barcode || prod.barcode,
      master_id: prod.master_id,
    });
  } else {
    if (!kelas_id) throw new BadRequest('Pilih kelas AI tujuan');
    const { data: k } = await supabaseAdmin.from('ai_kelas').select('*').eq('id', kelas_id).maybeSingle();
    if (!k) throw new NotFound('Kelas AI tujuan tidak ditemukan');
    targetKelas = k;

    if ((barcode || prod.barcode) && !k.barcode) {
      await supabaseAdmin
        .from('ai_kelas')
        .update({ barcode: barcode || prod.barcode, master_id: k.master_id || prod.master_id })
        .eq('id', k.id);
    }
  }

  return { produk: prod, kelas: targetKelas };
}
