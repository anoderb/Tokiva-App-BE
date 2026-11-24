import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest } from '../../utils/errors.js';

/**
 * Helper default rentang bulan berjalan (WIB)
 */
export function resolveDateRange(tanggal_awal, tanggal_akhir) {
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const todayStr = nowWib.toISOString().slice(0, 10);
  const firstOfMonth = `${todayStr.slice(0, 7)}-01`;

  return {
    awal: tanggal_awal || firstOfMonth,
    akhir: tanggal_akhir || todayStr,
  };
}

/**
 * Laporan Analitik Penjualan Berdasarkan Rentang Tanggal
 */
export async function getLaporanPenjualan(tokoId, { tanggal_awal, tanggal_mulai, tanggal_akhir } = {}) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko tidak tersedia pada sesi ini');
  }
  const effectiveTokoId = tokoId;

  const { awal, akhir } = resolveDateRange(tanggal_awal || tanggal_mulai, tanggal_akhir);

  let query = supabaseAdmin
    .from('transaksi')
    .select('id, tgl_transaksi, subtotal, diskon, total, total_hpp, laba_kotor, metode_bayar')
    .eq('status', 'selesai')
    .gte('tgl_transaksi', `${awal}T00:00:00+07:00`)
    .lte('tgl_transaksi', `${akhir}T23:59:59+07:00`)
    .order('tgl_transaksi', { ascending: true });

  if (effectiveTokoId) {
    query = query.eq('toko_id', effectiveTokoId);
  }

  const { data: txList, error: txErr } = await query;
  if (txErr) throw txErr;

  let totalOmzet = 0;
  let totalDiskon = 0;
  let totalHpp = 0;
  let totalLabaKotor = 0;

  const perMetode = {
    tunai: { jumlah: 0, total: 0, jumlah_transaksi: 0, total_nominal: 0 },
    qris: { jumlah: 0, total: 0, jumlah_transaksi: 0, total_nominal: 0 },
    split: { jumlah: 0, total: 0, jumlah_transaksi: 0, total_nominal: 0 },
    bon: { jumlah: 0, total: 0, jumlah_transaksi: 0, total_nominal: 0 },
  };
  const harianMap = new Map();

  for (const tx of (txList || [])) {
    const tot = Number(tx.total || 0);
    totalOmzet += tot;
    totalDiskon += Number(tx.diskon || 0);
    totalHpp += Number(tx.total_hpp || 0);
    totalLabaKotor += Number(tx.laba_kotor || 0);

    const mKey = perMetode[tx.metode_bayar] ? tx.metode_bayar : 'tunai';
    perMetode[mKey].jumlah += 1;
    perMetode[mKey].total += tot;
    perMetode[mKey].jumlah_transaksi += 1;
    perMetode[mKey].total_nominal += tot;

    const wibDate = new Date(new Date(tx.tgl_transaksi).getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const day = harianMap.get(wibDate) || { tanggal: wibDate, jumlah_transaksi: 0, omzet: 0, laba_kotor: 0 };
    day.jumlah_transaksi += 1;
    day.omzet += tot;
    day.laba_kotor += Number(tx.laba_kotor || 0);
    harianMap.set(wibDate, day);
  }

  const jumlahTx = (txList || []).length;

  // Produk terlaris pada rentang tanggal
  const txIds = (txList || []).map(t => t.id);
  let produkTerlaris = [];
  let totalItemTerjual = 0;

  if (txIds.length > 0) {
    const { data: details } = await supabaseAdmin
      .from('transaksi_detail')
      .select('produk_id, nama_produk, jumlah, isi_konversi, subtotal')
      .in('transaksi_id', txIds);

    const prodAgg = new Map();
    for (const d of (details || [])) {
      const soldQty = Number(d.jumlah || 0) * Number(d.isi_konversi || 1);
      totalItemTerjual += soldQty;

      const curr = prodAgg.get(d.produk_id) || {
        produk_id: d.produk_id,
        nama_produk: d.nama_produk,
        qty_terjual: 0,
        total_omzet: 0,
      };
      curr.qty_terjual += soldQty;
      curr.total_omzet += Number(d.subtotal || 0);
      prodAgg.set(d.produk_id, curr);
    }

    produkTerlaris = Array.from(prodAgg.values())
      .sort((a, b) => b.qty_terjual - a.qty_terjual)
      .slice(0, 10)
      .map(p => ({
        ...p,
        total_qty: p.qty_terjual,
      }));
  }

  const harianList = Array.from(harianMap.values());

  return {
    periode: { awal, akhir, tanggal_mulai: awal, tanggal_akhir: akhir },
    ringkasan: {
      total_transaksi: jumlahTx,
      jumlah_transaksi: jumlahTx,
      total_omzet: totalOmzet,
      total_diskon: totalDiskon,
      total_hpp: totalHpp,
      total_laba_kotor: totalLabaKotor,
      rata_rata_transaksi: jumlahTx > 0 ? Math.round(totalOmzet / jumlahTx) : 0,
      rata_rata_keranjang: jumlahTx > 0 ? Math.round(totalOmzet / jumlahTx) : 0,
      total_item_terjual: totalItemTerjual,
    },
    per_metode_bayar: perMetode,
    harian: harianList,
    tren_harian: harianList,
    produk_terlaris: produkTerlaris,
  };
}
