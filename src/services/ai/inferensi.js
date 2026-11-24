import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest } from '../../utils/errors.js';
import { jadikanDataLatihDariLog } from './inferensi-promote.js';

export { jadikanDataLatihDariLog };

/**
 * Catat Log Inferensi Kamera POS Kasir (Active Learning Umpan Balik)
 */
export async function catatLogInferensi(tokoId, kasirId, payload) {
  const {
    versi_model = 'v1.2.20260912',
    prediksi_kelas_id,
    skor_yakin,
    diterima_kasir = true,
    produk_id_asli = null,
    butuh_koreksi = false,
    foto_cuplikan = null,
  } = payload;

  if (!tokoId) throw new BadRequest('Konteks toko wajib dimiliki untuk mencatat log inferensi');
  if (!prediksi_kelas_id) throw new BadRequest('ID kelas prediksi AI wajib diisi');

  let normalizedSkor = Number(skor_yakin) || 0;
  if (normalizedSkor > 1) normalizedSkor /= 100;
  normalizedSkor = Math.min(0.9999, Math.max(0.0001, Number(normalizedSkor.toFixed(4))));

  let savedFotoPath = null;
  if (foto_cuplikan && typeof foto_cuplikan === 'string') {
    if (foto_cuplikan.startsWith('http') || foto_cuplikan.startsWith('inferensi-log/')) {
      savedFotoPath = foto_cuplikan;
    } else if (foto_cuplikan.startsWith('data:image') || foto_cuplikan.length > 100) {
      try {
        let base64Data = foto_cuplikan;
        let mimeType = 'image/jpeg';
        if (foto_cuplikan.startsWith('data:')) {
          const match = foto_cuplikan.match(/^data:(image\/\w+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const storagePath = `inferensi-log/pos_infer_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from('dataset-raw-temp')
          .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

        if (!upErr) savedFotoPath = storagePath;
        else console.error('Gagal upload cuplikan inferensi ke dataset-raw-temp:', upErr.message);
      } catch (uploadError) {
        console.error('Error proses cuplikan inferensi base64:', uploadError.message);
      }
    }
  }

  const { data, error } = await supabaseAdmin
    .from('ai_log_inferensi')
    .insert({
      toko_id: tokoId,
      kasir_id: kasirId || null,
      versi_model,
      prediksi_kelas_id,
      skor_yakin: normalizedSkor,
      diterima_kasir: Boolean(diterima_kasir),
      produk_id_asli: produk_id_asli || null,
      butuh_koreksi: Boolean(butuh_koreksi || !diterima_kasir),
      foto_cuplikan: savedFotoPath,
      waktu: new Date().toISOString(),
    })
    .select('*, kelas:prediksi_kelas_id(id, kode_kelas, nama)')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Daftar Riwayat Log Inferensi Visual di Kasir
 */
export async function listLogInferensi(tokoId, { butuh_koreksi, versi_model, limit = 50, page = 1 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  let query = supabaseAdmin
    .from('ai_log_inferensi')
    .select(
      `
      *,
      kelas:prediksi_kelas_id(id, kode_kelas, nama),
      produk_asli:produk_id_asli(id, nama, barcode, master_id),
      kasir:kasir_id(id, nama_lengkap)
    `,
      { count: 'exact' }
    );

  if (tokoId) query = query.eq('toko_id', tokoId);
  if (butuh_koreksi !== undefined && butuh_koreksi !== null && butuh_koreksi !== '') {
    query = query.eq('butuh_koreksi', butuh_koreksi === 'true' || butuh_koreksi === true);
  }
  if (versi_model) query = query.eq('versi_model', versi_model);

  const { data, count, error } = await query.order('waktu', { ascending: false }).range(from, to);
  if (error) throw error;

  const masterIds = [...new Set((data || []).map((r) => r.produk_asli?.master_id).filter(Boolean))];
  const barcodes = [...new Set((data || []).map((r) => r.produk_asli?.barcode).filter(Boolean))];
  const masterToKelasId = new Map();
  const barcodeToKelasId = new Map();

  if (masterIds.length > 0 || barcodes.length > 0) {
    const [byMasterRes, byBarcodeRes] = await Promise.all([
      masterIds.length > 0
        ? supabaseAdmin.from('ai_kelas').select('id, master_id').in('master_id', masterIds)
        : { data: [] },
      barcodes.length > 0
        ? supabaseAdmin.from('ai_kelas').select('id, barcode').in('barcode', barcodes)
        : { data: [] },
    ]);
    for (const k of byMasterRes.data || []) {
      if (k.master_id && !masterToKelasId.has(k.master_id)) masterToKelasId.set(k.master_id, k.id);
    }
    for (const k of byBarcodeRes.data || []) {
      if (k.barcode && !barcodeToKelasId.has(k.barcode)) barcodeToKelasId.set(k.barcode, k.id);
    }
  }

  const rawPaths = [
    ...new Set((data || []).map((r) => r.foto_cuplikan).filter((p) => typeof p === 'string' && p.length > 0 && !p.startsWith('data:'))),
  ];
  let promotedPaths = new Set();
  if (rawPaths.length > 0) {
    const { data: existingSamples } = await supabaseAdmin.from('ai_sampel').select('path_supabase').in('path_supabase', rawPaths);
    promotedPaths = new Set((existingSamples || []).map((s) => s.path_supabase).filter(Boolean));
  }

  const items = await Promise.all(
    (data || []).map(async (row) => {
      const rawPath = row.foto_cuplikan || null;
      let fotoUrl = rawPath;
      if (fotoUrl && !fotoUrl.startsWith('http') && !fotoUrl.startsWith('data:')) {
        const { data: signData } = await supabaseAdmin.storage.from('dataset-raw-temp').createSignedUrl(fotoUrl, 3600);
        fotoUrl = signData?.signedUrl || fotoUrl;
      }
      const produkAsli = row.produk_asli
        ? {
            ...row.produk_asli,
            ai_kelas_id:
              (row.produk_asli.master_id && masterToKelasId.get(row.produk_asli.master_id)) ||
              (row.produk_asli.barcode && barcodeToKelasId.get(row.produk_asli.barcode)) ||
              null,
          }
        : null;
      return {
        ...row,
        produk_asli: produkAsli,
        foto_cuplikan: fotoUrl,
        raw_foto_path: rawPath,
        sudah_jadi_sampel: Boolean(rawPath && promotedPaths.has(rawPath)),
        kelas_prediksi: row.kelas,
        dibuat_pada: row.waktu,
      };
    })
  );

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    items,
    pagination: { total, page: safePage, limit: safeLimit, total_pages: totalPages },
    meta: { total, page: safePage, limit: safeLimit, totalPages },
  };
}

/**
 * Ringkasan Akurasi Deteksi Lapangan (Real-World POS Accuracy)
 */
export async function getRingkasanAkurasi(tokoId, { versi_model } = {}) {
  const buildBaseQuery = () => {
    let q = supabaseAdmin.from('ai_log_inferensi').select('id', { count: 'exact', head: true });
    if (tokoId) q = q.eq('toko_id', tokoId);
    if (versi_model) q = q.eq('versi_model', versi_model);
    return q;
  };

  const [{ count: totalCount, error: totalErr }, { count: diterimaCount, error: ditErr }] = await Promise.all([
    buildBaseQuery(),
    buildBaseQuery().eq('butuh_koreksi', false),
  ]);

  if (totalErr) throw totalErr;
  if (ditErr) throw ditErr;

  const total = Number(totalCount || 0);
  const diterima = Number(diterimaCount || 0);
  return {
    versi_model: versi_model || 'semua',
    total_deteksi: total,
    diterima_kasir: diterima,
    butuh_koreksi: Math.max(0, total - diterima),
    akurasi_lapangan_persen: total > 0 ? Number(((diterima / total) * 100).toFixed(2)) : null,
  };
}
