import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';

/**
 * Scanner Barcode Cepat POS (< 30ms)
 * Mendeteksi otomatis apakah barcode yang discan adalah eceran (pcs) atau grosir (dus/renceng).
 * Terisolasi penuh berdasarkan tokoId.
 */
export async function scanBarcode(tokoId, rawBarcode) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko wajib ada untuk pemindaian barcode');
  }

  const barcode = String(rawBarcode || '').trim();
  if (!barcode) {
    throw new NotFound('Barcode tidak boleh kosong');
  }

  // 1. Cek pencarian di tabel produk (Satuan Eceran Dasar)
  const { data: produkEceran, error: errEceran } = await supabaseAdmin
    .from('produk')
    .select(`
      id, toko_id, master_id, kategori_id, nama, sku, barcode, foto_url,
      satuan_dasar, harga_jual, harga_modal, stok, stok_min, aktif,
      kategori:kategori_id(id, nama, slug),
      produk_satuan(id, nama_satuan, isi_konversi, harga_jual, barcode, aktif)
    `)
    .eq('toko_id', tokoId)
    .eq('barcode', barcode)
    .eq('aktif', true)
    .maybeSingle();

  if (errEceran) {
    throw errEceran;
  }

  if (produkEceran) {
    const multiSatuan = (produkEceran.produk_satuan || []).filter(s => s.aktif);
    const sanitizedProd = { ...produkEceran, produk_satuan: multiSatuan };

    return {
      tipe_scan: 'eceran',
      produk: sanitizedProd,
      produk_id: produkEceran.id,
      nama_produk: produkEceran.nama,
      foto_url: produkEceran.foto_url,
      kategori: produkEceran.kategori?.nama || 'Umum',
      stok_saat_ini: Number(produkEceran.stok),
      satuan_terpilih: {
        satuan_id: null,
        tipe: 'dasar',
        nama: produkEceran.satuan_dasar,
        nama_satuan: produkEceran.satuan_dasar,
        isi_konversi: 1,
        harga_jual: Number(produkEceran.harga_jual),
        barcode: produkEceran.barcode,
      },
      opsi_satuan: [
        {
          satuan_id: null,
          tipe: 'dasar',
          nama: produkEceran.satuan_dasar,
          nama_satuan: produkEceran.satuan_dasar,
          isi_konversi: 1,
          harga_jual: Number(produkEceran.harga_jual),
          barcode: produkEceran.barcode,
        },
        ...multiSatuan.map(s => ({
          satuan_id: s.id,
          tipe: 'multi',
          nama: s.nama_satuan,
          nama_satuan: s.nama_satuan,
          isi_konversi: Number(s.isi_konversi),
          harga_jual: Number(s.harga_jual),
          barcode: s.barcode,
        })),
      ],
    };
  }

  // 2. Cek tabel produk_satuan dengan INNER JOIN terisolasi per toko_id
  const { data: grosir, error: errGrosir } = await supabaseAdmin
    .from('produk_satuan')
    .select(`
      id, produk_id, nama_satuan, isi_konversi, harga_jual, barcode, aktif,
      produk:produk_id!inner(
        id, toko_id, master_id, kategori_id, nama, sku, barcode, foto_url,
        satuan_dasar, harga_jual, harga_modal, stok, stok_min, aktif,
        kategori:kategori_id(id, nama, slug),
        produk_satuan(id, nama_satuan, isi_konversi, harga_jual, barcode, aktif)
      )
    `)
    .eq('barcode', barcode)
    .eq('aktif', true)
    .eq('produk.toko_id', tokoId)
    .eq('produk.aktif', true)
    .maybeSingle();

  if (errGrosir) {
    throw errGrosir;
  }

  if (grosir && grosir.produk) {
    const parent = grosir.produk;
    const multiSatuan = (parent.produk_satuan || []).filter(s => s.aktif);
    const sanitizedProd = { ...parent, produk_satuan: multiSatuan };

    return {
      tipe_scan: 'grosir',
      produk: sanitizedProd,
      produk_id: parent.id,
      nama_produk: parent.nama,
      foto_url: parent.foto_url,
      kategori: parent.kategori?.nama || 'Umum',
      stok_saat_ini: Number(parent.stok),
      satuan_terpilih: {
        satuan_id: grosir.id,
        tipe: 'multi',
        nama: grosir.nama_satuan,
        nama_satuan: grosir.nama_satuan,
        isi_konversi: Number(grosir.isi_konversi),
        harga_jual: Number(grosir.harga_jual),
        barcode: grosir.barcode,
      },
      opsi_satuan: [
        {
          satuan_id: null,
          tipe: 'dasar',
          nama: parent.satuan_dasar,
          nama_satuan: parent.satuan_dasar,
          isi_konversi: 1,
          harga_jual: Number(parent.harga_jual),
          barcode: parent.barcode,
        },
        ...multiSatuan.map(s => ({
          satuan_id: s.id,
          tipe: 'multi',
          nama: s.nama_satuan,
          nama_satuan: s.nama_satuan,
          isi_konversi: Number(s.isi_konversi),
          harga_jual: Number(s.harga_jual),
          barcode: s.barcode,
        })),
      ],
    };
  }

  throw new NotFound(`Produk dengan barcode '${barcode}' tidak ditemukan di toko ini`);
}
