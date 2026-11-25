import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { slugifyKodeKelas } from './helpers.js';

/** Normalisasi L2 pada vektor fitur numerik. */
export function l2NormalizeVector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return [];
  let sumSq = 0;
  const nums = new Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    const v = Number(vec[i]);
    const clean = Number.isFinite(v) ? v : 0;
    nums[i] = clean;
    sumSq += clean * clean;
  }
  const norm = Math.sqrt(sumSq);
  if (norm <= 1e-12) return nums;
  return nums.map((v) => Number((v / norm).toFixed(6)));
}

/** Validasi dan normalisasi payload embedding ({ centroid, prototypes }). */
export function validateEmbeddingPayload(raw = {}, expectedDim = null) {
  const rawCentroid = Array.isArray(raw.centroid) ? raw.centroid : null;
  if (!rawCentroid || rawCentroid.length < 16 || rawCentroid.length > 2048) {
    throw new BadRequest('Vektor centroid embedding tidak valid');
  }
  if (expectedDim && rawCentroid.length !== Number(expectedDim)) {
    throw new BadRequest(`Dimensi embedding (${rawCentroid.length}) tidak sesuai model (${expectedDim})`);
  }

  const centroid = l2NormalizeVector(rawCentroid);
  const rawProtos = Array.isArray(raw.prototypes) ? raw.prototypes.slice(0, 8) : [];
  const prototypes = rawProtos
    .filter((p) => Array.isArray(p) && p.length === centroid.length)
    .map((p) => l2NormalizeVector(p));

  return {
    dimensi: centroid.length,
    embedding: {
      centroid,
      prototypes: prototypes.length > 0 ? prototypes : [centroid],
    },
  };
}

/** Daftarkan / perbarui prototipe visual sementara milik 1 toko untuk produk baru pada model v2. */
export async function enrollOwnerEmbedding(tokoId, userId, payload = {}) {
  if (!tokoId) throw new BadRequest('Konteks toko wajib dimiliki untuk enrollment embedding');

  const {
    produk_id = null,
    kelas_id = null,
    nama = '',
    barcode = null,
    model_versi = null,
    centroid,
    prototypes = [],
    jml_sampel = 1,
    sumber = 'owner_produk',
  } = payload;

  let modelRow = null;
  if (model_versi) {
    const { data } = await supabaseAdmin
      .from('ai_model')
      .select('id, versi, model_family, mendukung_embedding, dimensi_embedding')
      .eq('versi', String(model_versi).trim())
      .maybeSingle();
    modelRow = data;
  } else {
    const { data } = await supabaseAdmin
      .from('ai_model')
      .select('id, versi, model_family, mendukung_embedding, dimensi_embedding')
      .eq('aktif', true)
      .order('tgl_rilis', { ascending: false })
      .limit(1)
      .maybeSingle();
    modelRow = data;
  }

  if (!modelRow) throw new NotFound('Model AI aktif tidak ditemukan');
  if (!modelRow.mendukung_embedding && modelRow.model_family !== 'v2') {
    throw new BadRequest(`Model '${modelRow.versi}' tidak mendukung embedding v2`);
  }

  const expectedDim = modelRow.dimensi_embedding || null;
  const { dimensi, embedding } = validateEmbeddingPayload({ centroid, prototypes }, expectedDim);

  let targetKelasId = kelas_id || null;
  const cleanBarcode = barcode ? String(barcode).trim() : null;
  const cleanNama = String(nama || '').trim();

  if (!targetKelasId && cleanBarcode) {
    const { data: byBarcode } = await supabaseAdmin
      .from('ai_kelas')
      .select('id')
      .eq('barcode', cleanBarcode)
      .maybeSingle();
    if (byBarcode?.id) targetKelasId = byBarcode.id;
  }

  if (!targetKelasId && cleanNama) {
    const { data: byNama } = await supabaseAdmin
      .from('ai_kelas')
      .select('id')
      .ilike('nama', cleanNama)
      .limit(1)
      .maybeSingle();
    if (byNama?.id) targetKelasId = byNama.id;
  }

  if (!targetKelasId && produk_id) {
    const { data: prodRow } = await supabaseAdmin
      .from('produk')
      .select('id, nama, barcode, master_id')
      .eq('id', produk_id)
      .eq('toko_id', tokoId)
      .maybeSingle();

    if (prodRow) {
      if (prodRow.master_id) {
        const { data: byMaster } = await supabaseAdmin
          .from('ai_kelas')
          .select('id')
          .eq('master_id', prodRow.master_id)
          .maybeSingle();
        if (byMaster?.id) targetKelasId = byMaster.id;
      }
      if (!targetKelasId) {
        const baseKode = slugifyKodeKelas(prodRow.nama).slice(0, 50) || `produk-${Date.now()}`;
        const { data: bySlug } = await supabaseAdmin
          .from('ai_kelas')
          .select('id')
          .eq('kode_kelas', baseKode)
          .maybeSingle();
        if (bySlug?.id) {
          targetKelasId = bySlug.id;
        } else {
          const { data: createdKelas, error: kErr } = await supabaseAdmin
            .from('ai_kelas')
            .insert({
              kode_kelas: baseKode,
              nama: prodRow.nama,
              kategori: 'Kebutuhan Harian',
              barcode: prodRow.barcode || cleanBarcode,
              master_id: prodRow.master_id || null,
              target_foto: 100,
              total_foto: 0,
              jml_supabase: 0,
              jml_hf: 0,
              status: 'Menunggu Verifikasi',
            })
            .select('id')
            .single();
          if (!kErr && createdKelas?.id) targetKelasId = createdKelas.id;
        }
      }
    }
  }

  if (!targetKelasId) {
    throw new BadRequest('Kelas AI produk belum dapat ditentukan untuk enrollment embedding');
  }

  const safeSumber = ['owner_produk', 'kasir_konfirmasi', 'recompute_admin'].includes(sumber)
    ? sumber
    : 'owner_produk';

  const rowPayload = {
    toko_id: tokoId,
    produk_id: produk_id || null,
    kelas_id: targetKelasId,
    model_versi: modelRow.versi,
    embedding,
    dimensi,
    jml_sampel: Math.max(1, Number.parseInt(jml_sampel, 10) || embedding.prototypes.length || 1),
    sumber: safeSumber,
    status: 'aktif',
    dibuat_oleh: userId || null,
    diubah_pada: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('ai_kelas_embedding')
    .upsert(rowPayload, { onConflict: 'toko_id,kelas_id,model_versi' })
    .select('*, kelas:kelas_id(id, kode_kelas, nama, barcode), produk:produk_id(id, nama, barcode, harga_jual, foto_url)')
    .single();

  if (error) throw error;
  return data;
}

/** Ambil daftar prototipe embedding aktif milik 1 toko untuk model aktif (POS Kasir / Owner). */
export async function listStoreActiveEmbeddings(tokoId, modelVersi = null) {
  if (!tokoId) throw new BadRequest('Konteks toko wajib dimiliki');

  let targetVersi = modelVersi ? String(modelVersi).trim() : null;
  if (!targetVersi) {
    const { data: active } = await supabaseAdmin
      .from('ai_model')
      .select('versi, model_family, mendukung_embedding')
      .eq('aktif', true)
      .order('tgl_rilis', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!active || (!active.mendukung_embedding && active.model_family !== 'v2')) {
      return [];
    }
    targetVersi = active.versi;
  }

  const { data, error } = await supabaseAdmin
    .from('ai_kelas_embedding')
    .select('*, kelas:kelas_id(id, kode_kelas, nama, barcode), produk:produk_id(id, nama, barcode, harga_jual, foto_url)')
    .eq('toko_id', tokoId)
    .eq('model_versi', targetVersi)
    .eq('status', 'aktif')
    .order('diubah_pada', { ascending: false });

  if (error) throw error;
  return data || [];
}

/** Monitoring seluruh embedding sementara lintas toko untuk Admin. */
export async function listAdminEmbeddings({ toko_id = null, model_versi = null, status = null, limit = 100 } = {}) {
  let query = supabaseAdmin
    .from('ai_kelas_embedding')
    .select('*, toko:toko_id(id, nama), kelas:kelas_id(id, kode_kelas, nama, barcode), produk:produk_id(id, nama, barcode, foto_url)')
    .order('diubah_pada', { ascending: false })
    .limit(Math.min(200, Math.max(1, Number(limit) || 100)));

  let summaryQuery = supabaseAdmin.from('ai_kelas_embedding').select('status');

  if (toko_id) {
    query = query.eq('toko_id', toko_id);
    summaryQuery = summaryQuery.eq('toko_id', toko_id);
  }
  if (model_versi) {
    query = query.eq('model_versi', model_versi);
    summaryQuery = summaryQuery.eq('model_versi', model_versi);
  }
  if (status && status !== 'semua') query = query.eq('status', status);

  const [{ data, error }, { data: statusRows, error: sumErr }] = await Promise.all([query, summaryQuery]);
  if (error) throw error;
  const items = data || [];
  const allStatuses = !sumErr && Array.isArray(statusRows) ? statusRows : items;
  return {
    items,
    summary: {
      total: allStatuses.length,
      aktif: allStatuses.filter((r) => r.status === 'aktif').length,
      terlatih: allStatuses.filter((r) => r.status === 'terlatih').length,
      nonaktif: allStatuses.filter((r) => r.status === 'nonaktif').length,
    },
  };
}

/** Ubah status prototipe embedding oleh Admin ('aktif' | 'nonaktif' | 'terlatih'). */
export async function updateAdminEmbeddingStatus(id, status) {
  if (!['aktif', 'nonaktif', 'terlatih'].includes(status)) {
    throw new BadRequest('Status embedding harus salah satu dari: aktif, nonaktif, terlatih');
  }
  const { data, error } = await supabaseAdmin
    .from('ai_kelas_embedding')
    .update({ status, diubah_pada: new Date().toISOString() })
    .eq('id', id)
    .select('*, toko:toko_id(id, nama), kelas:kelas_id(id, kode_kelas, nama)')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Data embedding tidak ditemukan');
  return data;
}

/** Hapus permanen prototipe embedding oleh Admin. */
export async function deleteAdminEmbedding(id) {
  const { data, error } = await supabaseAdmin
    .from('ai_kelas_embedding')
    .delete()
    .eq('id', id)
    .select('id, kelas_id, toko_id, model_versi')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Data embedding tidak ditemukan');
  return data;
}

/** Promosikan embedding sementara menjadi 'terlatih' setelah kelas resmi masuk training model v2. */
export async function promoteTrainedEmbeddings(modelVersi, trainedKodeKelasList = []) {
  if (!Array.isArray(trainedKodeKelasList) || trainedKodeKelasList.length === 0) return 0;
  try {
    const { data, error } = await supabaseAdmin.rpc('promote_trained_ai_embeddings', {
      p_model_versi: modelVersi || null,
      p_trained_kode_kelas: trainedKodeKelasList.map((k) => String(k || '').trim()).filter(Boolean),
    });
    if (error) throw error;
    return Number(data || 0);
  } catch (err) {
    console.warn('Gagal mempromosikan embedding terlatih:', err?.message || err);
    return 0;
  }
}
