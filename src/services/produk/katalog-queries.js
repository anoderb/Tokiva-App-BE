import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';
import {
  computeStoreStockSummary,
  mapProductWithMargin,
  matchesStockStatus,
} from './katalog-helpers.js';

/**
 * List Produk untuk Meja Kasir (HPP Modal Disembunyikan)
 */
export async function listProdukKasir(tokoId, { q, kategori_id, limit = 50, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('produk')
    .select(
      `
      id, kategori_id, nama, barcode, foto_url, satuan_dasar, harga_jual, stok,
      kategori:kategori_id(id, nama, slug),
      produk_satuan(id, nama_satuan, isi_konversi, harga_jual, barcode, aktif)
    `,
      { count: 'exact' }
    )
    .eq('toko_id', tokoId)
    .eq('aktif', true);

  const cleanQ = sanitizeSearchTerm(q);
  if (cleanQ) query = query.or(`nama.ilike.%${cleanQ}%,barcode.ilike.%${cleanQ}%`);
  if (kategori_id) query = query.eq('kategori_id', kategori_id);

  const { data, count, error } = await query.order('nama', { ascending: true }).range(from, to);
  if (error) throw error;

  const items = (data || []).map((p) => ({
    ...p,
    produk_satuan: (p.produk_satuan || []).filter((s) => s.aktif),
  }));

  return {
    items,
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * List Produk Lengkap untuk Owner (Tampil HPP Modal, Margin, & Filter/Ringkasan Stok Akurat)
 */
export async function listProdukOwner(
  tokoId,
  { q, search, kategori_id, stok_menipis, status_stok, status, aktif, limit = 15, page = 1 }
) {
  const cleanPage = Math.max(1, Number(page) || 1);
  const cleanLimit = Math.max(1, Math.min(500, Number(limit) || 15));
  const from = (cleanPage - 1) * cleanLimit;
  const to = from + cleanLimit - 1;

  const ringkasanStok = await computeStoreStockSummary(tokoId);

  let query = supabaseAdmin
    .from('produk')
    .select(
      `
      *,
      kategori:kategori_id(id, nama, slug),
      produk_satuan(id, nama_satuan, isi_konversi, harga_jual, barcode, aktif)
    `,
      { count: 'exact' }
    )
    .eq('toko_id', tokoId);

  if (status === 'aktif' || aktif === true || aktif === 'true') query = query.eq('aktif', true);
  else if (status === 'nonaktif' || aktif === false || aktif === 'false') query = query.eq('aktif', false);

  const querySearch = sanitizeSearchTerm(q || search);
  if (querySearch) {
    query = query.or(`nama.ilike.%${querySearch}%,barcode.ilike.%${querySearch}%,sku.ilike.%${querySearch}%`);
  }
  if (kategori_id) query = query.eq('kategori_id', kategori_id);

  const effectiveStockFilter =
    status_stok && status_stok !== 'semua'
      ? status_stok
      : stok_menipis === 'true' || stok_menipis === true
      ? 'menipis'
      : null;

  if (effectiveStockFilter) {
    const { data: allFiltered, error } = await query
      .order('dibuat_pada', { ascending: false })
      .order('nama', { ascending: true });
    if (error) throw error;

    const matched = (allFiltered || []).filter((p) => matchesStockStatus(p, effectiveStockFilter));
    return {
      items: matched.slice(from, to + 1).map(mapProductWithMargin),
      ringkasan_stok: ringkasanStok,
      pagination: {
        total: matched.length,
        page: cleanPage,
        limit: cleanLimit,
        total_pages: Math.max(1, Math.ceil(matched.length / cleanLimit)),
      },
    };
  }

  const { data, count, error } = await query
    .order('dibuat_pada', { ascending: false })
    .order('nama', { ascending: true })
    .range(from, to);

  if (error) throw error;

  return {
    items: (data || []).map(mapProductWithMargin),
    ringkasan_stok: ringkasanStok,
    pagination: {
      total: count || 0,
      page: cleanPage,
      limit: cleanLimit,
      total_pages: Math.max(1, Math.ceil((count || 0) / cleanLimit)),
    },
  };
}

/**
 * Detail 1 Produk Lengkap dengan Seluruh Satuan Grosir
 */
export async function getDetailProduk(tokoId, produkId) {
  const { data, error } = await supabaseAdmin
    .from('produk')
    .select(
      `
      *,
      kategori:kategori_id(id, nama, slug),
      produk_satuan(*)
    `
    )
    .eq('id', produkId)
    .eq('toko_id', tokoId)
    .eq('aktif', true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Produk tidak ditemukan');
  return data;
}
