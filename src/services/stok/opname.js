import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { adjustProdukStokAtomic } from '../../utils/atomic-db.js';

/**
 * Penyesuaian Stok Fisik (Stok Opname) — Mendukung 1 produk atau batch array secara atomik
 */
export async function opnameStok(tokoId, payload) {
  const itemList = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
    : (payload.produk_id ? [payload] : []);

  if (itemList.length === 0) {
    throw new BadRequest('Daftar item stok opname tidak boleh kosong');
  }

  const productIds = Array.from(new Set(itemList.map(it => it.produk_id)));
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('produk')
    .select('id, nama, satuan_dasar, stok')
    .eq('toko_id', tokoId)
    .in('id', productIds);

  if (prodErr) throw prodErr;
  const prodMap = new Map((products || []).map(p => [p.id, p]));

  const hasilOpname = [];

  for (const item of itemList) {
    const prod = prodMap.get(item.produk_id);
    if (!prod) {
      throw new NotFound(`Produk ID '${item.produk_id}' tidak ditemukan di toko ini`);
    }

    const stokFisik = Number(item.stok_fisik);
    if (!Number.isFinite(stokFisik) || stokFisik < 0) {
      throw new BadRequest(`Stok fisik untuk '${prod.nama}' tidak valid`);
    }

    const stokSistem = Number(prod.stok || 0);
    const selisih = stokFisik - stokSistem;
    const jenisMutasi = ['opname', 'koreksi', 'rusak'].includes(item.jenis || payload.jenis)
      ? item.jenis || payload.jenis
      : 'penyesuaian';

    const adjusted = await adjustProdukStokAtomic({
      tokoId,
      produkId: prod.id,
      delta: selisih,
      jenis: jenisMutasi,
      catatan: item.catatan || item.alasan || 'Stok opname fisik gudang/rak',
      allowNegative: true,
    });

    hasilOpname.push({
      produk_id: prod.id,
      nama: prod.nama,
      satuan_dasar: prod.satuan_dasar,
      stok_sistem: adjusted.stok_sebelum,
      stok_fisik: adjusted.stok_sesudah,
      selisih,
    });
  }

  return {
    jumlah_disesuaikan: hasilOpname.length,
    items: hasilOpname,
  };
}

/**
 * Daftar Produk dengan Stok Menipis (stok <= stok_min)
 */
export async function getStokMenipis(tokoId) {
  let query = supabaseAdmin
    .from('produk')
    .select('id, nama, barcode, foto_url, satuan_dasar, stok, stok_min, harga_modal, harga_jual, kategori:kategori_id(id, nama)')
    .eq('aktif', true)
    .order('stok', { ascending: true });

  if (tokoId) {
    query = query.eq('toko_id', tokoId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const menipis = (data || [])
    .filter(p => Number(p.stok || 0) <= Number(p.stok_min ?? 10))
    .map(p => ({
      ...p,
      stok_minimum: Number(p.stok_min ?? 10),
    }));
  return {
    total: menipis.length,
    items: menipis,
  };
}

