import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound } from '../../utils/errors.js';

/**
 * Cari Produk di Katalog Master Global EAN-13 (untuk auto-fill produk baru di toko)
 */
export async function getProdukMasterByBarcode(rawBarcode) {
  const barcode = String(rawBarcode || '').trim();

  const { data, error } = await supabaseAdmin
    .from('produk_master')
    .select(`
      *,
      kategori:kategori_id(id, nama, slug)
    `)
    .eq('barcode', barcode)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new NotFound(`Barcode '${barcode}' belum terdaftar di katalog master global`);
  }

  return data;
}

