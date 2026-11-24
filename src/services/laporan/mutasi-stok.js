import { supabaseAdmin } from '../../lib/supabase.js';

/**
 * Daftar Log Mutasi Stok Inventaris Toko
 */
export async function listMutasiStok(tokoId, { produk_id, jenis, limit = 15, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('mutasi_stok')
    .select(`
      *,
      produk:produk_id(id, nama, barcode, sku, satuan_dasar, foto_url)
    `, { count: 'exact' })
    .eq('toko_id', tokoId);

  if (produk_id) {
    query = query.eq('produk_id', produk_id);
  }

  if (jenis) {
    query = query.eq('jenis', jenis);
  }

  const { data, count, error } = await query
    .order('waktu', { ascending: false })
    .range(from, to);

  if (error) {
    throw error;
  }

  return {
    items: data || [],
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

