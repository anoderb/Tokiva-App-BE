import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';

/**
 * Tambah Satuan Grosir (Multi-Satuan) untuk Produk Toko
 * Contoh: 1 Dus = 24 Pcs, Harga Rp105.000, Barcode Eceran + DUS
 */
export async function addSatuanGrosir(tokoId, produkId, payload) {
  const { nama_satuan, isi_konversi, harga_jual, barcode } = payload;

  if (!nama_satuan || !isi_konversi || harga_jual === undefined) {
    throw new BadRequest('Nama satuan, isi konversi, dan harga jual satuan wajib diisi');
  }

  if (Number(isi_konversi) <= 1) {
    throw new BadRequest('Isi konversi satuan grosir harus lebih besar dari 1');
  }

  // 1. Verifikasi produk adalah milik toko ini
  const { data: produk } = await supabaseAdmin
    .from('produk')
    .select('id, barcode')
    .eq('id', produkId)
    .eq('toko_id', tokoId)
    .eq('aktif', true)
    .maybeSingle();

  if (!produk) {
    throw new NotFound('Produk tidak ditemukan');
  }

  // Barcode satuan: jika kosong, buat otomatis dari barcode produk + nama satuan
  const finalBarcode = barcode ? barcode.trim() : (produk.barcode ? `${produk.barcode}-${nama_satuan.toUpperCase()}` : null);

  // 2. Insert ke produk_satuan
  const { data, error } = await supabaseAdmin
    .from('produk_satuan')
    .insert({
      produk_id: produkId,
      nama_satuan: nama_satuan.trim(),
      isi_konversi: Number(isi_konversi),
      harga_jual: Number(harga_jual),
      barcode: finalBarcode,
      aktif: true,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Hapus / Nonaktifkan Satuan Grosir
 */
export async function removeSatuanGrosir(tokoId, produkId, satuanId) {
  // Verifikasi kepemilikan via relasi produk
  const { data: satuan, error: findErr } = await supabaseAdmin
    .from('produk_satuan')
    .select('id, produk:produk_id(id, toko_id)')
    .eq('id', satuanId)
    .eq('produk_id', produkId)
    .maybeSingle();

  if (findErr) {
    throw findErr;
  }

  if (!satuan || satuan.produk?.toko_id !== tokoId) {
    throw new NotFound('Satuan grosir tidak ditemukan');
  }

  const { error } = await supabaseAdmin
    .from('produk_satuan')
    .delete()
    .eq('id', satuanId);

  if (error) {
    throw error;
  }

  return { id: satuanId, deleted: true };
}

