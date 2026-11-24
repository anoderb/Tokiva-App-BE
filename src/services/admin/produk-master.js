import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, Conflict, NotFound } from '../../utils/errors.js';

function sanitizeSearchTerm(str) {
  return String(str || '')
    .trim()
    .replace(/[,()\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Daftar Kategori Produk Global (toko_id IS NULL)
 */
export async function listKategoriGlobal() {
  const { data, error } = await supabaseAdmin
    .from('kategori')
    .select('id, nama, slug, urutan')
    .is('toko_id', null)
    .order('urutan', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Daftar Katalog Produk Master Global (Referensi Barcode EAN-13)
 */
export async function listProdukMaster({ search, merek, kategori_id, terverifikasi, limit = 50, page = 1 }) {
  const cleanPage = Math.max(1, Number(page) || 1);
  const cleanLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const from = (cleanPage - 1) * cleanLimit;
  const to = from + cleanLimit - 1;

  let query = supabaseAdmin
    .from('produk_master')
    .select('*, kategori:kategori_id(id, nama)', { count: 'exact' });

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(`nama.ilike.%${cleanSearch}%,merek.ilike.%${cleanSearch}%,barcode.ilike.%${cleanSearch}%`);
  }
  if (merek) {
    query = query.eq('merek', merek);
  }
  if (kategori_id) {
    query = query.eq('kategori_id', kategori_id);
  }
  if (terverifikasi !== undefined && terverifikasi !== null && terverifikasi !== '') {
    query = query.eq('terverifikasi', terverifikasi === 'true' || terverifikasi === true);
  }

  const [{ data, count, error }, { data: merekRows }] = await Promise.all([
    query.order('nama', { ascending: true }).range(from, to),
    supabaseAdmin.from('produk_master').select('merek').not('merek', 'is', null),
  ]);

  if (error) throw error;

  const merekList = Array.from(
    new Set((merekRows || []).map((r) => (r.merek ? String(r.merek).trim() : '')).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'id'));

  const total = count || 0;
  return {
    items: data || [],
    merek_list: merekList,
    pagination: {
      total,
      page: cleanPage,
      limit: cleanLimit,
      total_pages: Math.max(1, Math.ceil(total / cleanLimit)),
    },
  };
}

/**
 * Tambah Produk Master Global Baru
 */
export async function createProdukMaster(payload) {
  const {
    nama,
    merek = null,
    barcode = null,
    kategori_id = null,
    satuan_dasar = 'pcs',
    harga_saran = null,
    foto_url = null,
    terverifikasi = true,
  } = payload;

  if (!nama || !nama.trim()) {
    throw new BadRequest('Nama produk master wajib diisi');
  }

  const cleanBarcode = barcode ? String(barcode).trim() : null;
  if (cleanBarcode) {
    const { data: exist } = await supabaseAdmin
      .from('produk_master')
      .select('id')
      .eq('barcode', cleanBarcode)
      .maybeSingle();

    if (exist) {
      throw new Conflict(`Barcode master '${cleanBarcode}' sudah terdaftar`);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('produk_master')
    .insert({
      nama: nama.trim(),
      merek: merek && String(merek).trim() ? String(merek).trim() : null,
      barcode: cleanBarcode,
      kategori_id: kategori_id && String(kategori_id).trim() ? String(kategori_id).trim() : null,
      satuan_dasar: (satuan_dasar || 'pcs').trim(),
      harga_saran: harga_saran !== null && harga_saran !== '' && harga_saran !== undefined ? Number(harga_saran) : null,
      foto_url: foto_url && String(foto_url).trim() ? String(foto_url).trim() : null,
      terverifikasi: Boolean(terverifikasi),
    })
    .select('*, kategori:kategori_id(id, nama)')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Perbarui Produk Master Global
 */
export async function updateProdukMaster(id, payload) {
  const { data: exist } = await supabaseAdmin
    .from('produk_master')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (!exist) throw new NotFound('Produk master tidak ditemukan');

  const cleanBarcode =
    payload.barcode !== undefined
      ? payload.barcode && String(payload.barcode).trim()
        ? String(payload.barcode).trim()
        : null
      : undefined;

  if (cleanBarcode) {
    const { data: dupBarcode } = await supabaseAdmin
      .from('produk_master')
      .select('id')
      .eq('barcode', cleanBarcode)
      .neq('id', id)
      .maybeSingle();

    if (dupBarcode) {
      throw new Conflict(`Barcode master '${cleanBarcode}' sudah digunakan produk lain`);
    }
  }

  const updateFields = {};
  if (payload.nama !== undefined) {
    if (!String(payload.nama || '').trim()) {
      throw new BadRequest('Nama produk master tidak boleh kosong');
    }
    updateFields.nama = String(payload.nama).trim();
  }
  if (payload.merek !== undefined) {
    updateFields.merek = payload.merek && String(payload.merek).trim() ? String(payload.merek).trim() : null;
  }
  if (cleanBarcode !== undefined) {
    updateFields.barcode = cleanBarcode;
  }
  if (payload.kategori_id !== undefined) {
    updateFields.kategori_id = payload.kategori_id && String(payload.kategori_id).trim() ? String(payload.kategori_id).trim() : null;
  }
  if (payload.satuan_dasar !== undefined) {
    updateFields.satuan_dasar = (payload.satuan_dasar || 'pcs').trim();
  }
  if (payload.harga_saran !== undefined) {
    updateFields.harga_saran =
      payload.harga_saran === null || payload.harga_saran === '' ? null : Number(payload.harga_saran);
  }
  if (payload.foto_url !== undefined) {
    updateFields.foto_url = payload.foto_url && String(payload.foto_url).trim() ? String(payload.foto_url).trim() : null;
  }
  if (payload.terverifikasi !== undefined) {
    updateFields.terverifikasi = Boolean(payload.terverifikasi);
  }

  const { data, error } = await supabaseAdmin
    .from('produk_master')
    .update(updateFields)
    .eq('id', id)
    .select('*, kategori:kategori_id(id, nama)')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Hapus Produk Master Global
 */
export async function deleteProdukMaster(id) {
  const { data, error } = await supabaseAdmin
    .from('produk_master')
    .delete()
    .eq('id', id)
    .select('id, nama')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Produk master tidak ditemukan');

  return { id, message: `Produk master '${data.nama}' berhasil dihapus` };
}
