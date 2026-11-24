import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { uploadMediaGambar, parseBase64Image } from '../media/upload.js';
import { registerProductAiDataset } from './katalog-helpers.js';
import { getDetailProduk, listProdukKasir, listProdukOwner } from './katalog-queries.js';

export { listProdukKasir, listProdukOwner, getDetailProduk };

/**
 * Tambah Produk Baru ke Toko (Owner)
 */
export async function createProduk(tokoId, payload) {
  const {
    master_id,
    kategori_id,
    nama,
    sku,
    barcode,
    foto_url,
    satuan_dasar = 'pcs',
    harga_jual,
    harga_modal = 0,
    stok = 0,
    stok_min = 10,
    satuan_tambahan = [],
    dataset_fotos = [],
  } = payload;

  if (!nama || harga_jual === undefined) {
    throw new BadRequest('Nama produk dan harga jual wajib diisi');
  }

  if (barcode) {
    const { data: duplicate } = await supabaseAdmin
      .from('produk')
      .select('id')
      .eq('toko_id', tokoId)
      .eq('barcode', barcode)
      .eq('aktif', true)
      .maybeSingle();

    if (duplicate) {
      throw new BadRequest(`Barcode '${barcode}' sudah digunakan oleh produk lain di toko Anda`);
    }
  }

  let finalFotoUrl = foto_url || null;
  const rawDatasetFotos = Array.isArray(dataset_fotos) ? dataset_fotos : [];

  if (!finalFotoUrl && rawDatasetFotos.length > 0 && rawDatasetFotos[0]?.base64) {
    try {
      const { buffer, mimetype } = parseBase64Image(rawDatasetFotos[0].base64);
      const uploadedCover = await uploadMediaGambar(tokoId, {
        buffer,
        mimetype,
        filename: `${nama.trim()}_sampul.jpg`,
        folder: 'produk',
      });
      finalFotoUrl = uploadedCover.url;
    } catch (e) {
      console.warn('Gagal upload sampul produk dari dataset:', e.message);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('produk')
    .insert({
      toko_id: tokoId,
      master_id: master_id || null,
      kategori_id: kategori_id || null,
      nama: nama.trim(),
      sku: sku || null,
      barcode: barcode || null,
      foto_url: finalFotoUrl,
      satuan_dasar: satuan_dasar.toLowerCase().trim(),
      harga_jual: Number(harga_jual),
      harga_modal: Number(harga_modal),
      stok: Number(stok),
      stok_min: Number(stok_min),
      aktif: true,
    })
    .select()
    .single();

  if (error) throw error;

  if (Array.isArray(satuan_tambahan) && satuan_tambahan.length > 0) {
    for (const sat of satuan_tambahan) {
      const namaSat = sat.nama_satuan ? String(sat.nama_satuan).trim() : '';
      const konversi = Number(sat.isi_konversi || sat.konversi_ke_dasar || 1);
      const hj = Number(sat.harga_jual || 0);

      if (namaSat && konversi > 1 && hj > 0) {
        const { error: satErr } = await supabaseAdmin.from('produk_satuan').insert({
          produk_id: data.id,
          nama_satuan: namaSat,
          isi_konversi: konversi,
          harga_jual: hj,
          barcode: sat.barcode || null,
          aktif: true,
        });
        if (satErr) console.warn('Gagal simpan satuan grosir:', satErr.message);
      }
    }
  }

  if (rawDatasetFotos.length > 0) {
    await registerProductAiDataset({ nama, barcode, kategori_id, master_id, rawDatasetFotos });
  }

  return data;
}

/**
 * Edit Data Produk Toko (Owner)
 */
export async function updateProduk(tokoId, produkId, payload) {
  const { kategori_id, nama, sku, barcode, foto_url, satuan_dasar, harga_jual, harga_modal, stok, stok_min } = payload;

  const updateFields = { diubah_pada: new Date().toISOString() };
  if (kategori_id !== undefined) updateFields.kategori_id = kategori_id;
  if (nama) updateFields.nama = nama.trim();
  if (sku !== undefined) updateFields.sku = sku;
  if (barcode !== undefined) updateFields.barcode = barcode;
  if (foto_url !== undefined) updateFields.foto_url = foto_url;
  if (satuan_dasar) updateFields.satuan_dasar = satuan_dasar.toLowerCase().trim();
  if (harga_jual !== undefined) updateFields.harga_jual = Number(harga_jual);
  if (harga_modal !== undefined) updateFields.harga_modal = Number(harga_modal);
  if (stok !== undefined) updateFields.stok = Number(stok);
  if (stok_min !== undefined) updateFields.stok_min = Number(stok_min);
  if (payload.aktif !== undefined) updateFields.aktif = Boolean(payload.aktif);

  const { data, error } = await supabaseAdmin
    .from('produk')
    .update(updateFields)
    .eq('id', produkId)
    .eq('toko_id', tokoId)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Produk tidak ditemukan');
  return data;
}

/**
 * Hapus Produk Toko (Soft Delete)
 */
export async function deleteProduk(tokoId, produkId) {
  const { data, error } = await supabaseAdmin
    .from('produk')
    .update({ aktif: false, diubah_pada: new Date().toISOString() })
    .eq('id', produkId)
    .eq('toko_id', tokoId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Produk tidak ditemukan');
  return { id: produkId, deleted: true };
}
