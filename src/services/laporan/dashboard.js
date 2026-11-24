import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest } from '../../utils/errors.js';
import { getStokMenipis } from '../stok/opname.js';
import { formatShiftRow } from '../shift/buka-tutup.js';

/**
 * Helper: Tanggal YYYY-MM-DD Zona Waktu WIB (UTC+7)
 */
function getWibDateString(offsetDays = 0) {
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  nowWib.setUTCDate(nowWib.getUTCDate() + offsetDays);
  return nowWib.toISOString().slice(0, 10);
}

/**
 * Ringkasan Dashboard Utama Owner Toko (Dioptimalkan dengan Parallel Query Execution)
 */
export async function getDashboardOwner(tokoId) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko tidak tersedia pada sesi ini');
  }
  const effectiveTokoId = tokoId;

  const todayStr = getWibDateString(0);
  const yesterdayStr = getWibDateString(-1);
  const sevenDaysAgoStr = getWibDateString(-6);
  const startRangeIso = `${sevenDaysAgoStr}T00:00:00+07:00`;

  // Siapkan 5 query independen untuk dijalankan secara PARALEL (Promise.all)
  let txQuery = supabaseAdmin
    .from('transaksi')
    .select('id, tgl_transaksi, total, laba_kotor, metode_bayar')
    .eq('status', 'selesai')
    .gte('tgl_transaksi', startRangeIso)
    .order('tgl_transaksi', { ascending: true });

  let shiftQuery = supabaseAdmin
    .from('shift_kasir')
    .select('*, kasir:kasir_id(id, nama_lengkap)')
    .eq('status', 'buka');

  let piutangQuery = supabaseAdmin
    .from('piutang')
    .select('sisa_bon, pelanggan_id')
    .eq('status', 'belum_lunas');

  let prodCountQuery = supabaseAdmin
    .from('produk')
    .select('id', { count: 'exact', head: true })
    .eq('aktif', true);

  if (effectiveTokoId) {
    txQuery = txQuery.eq('toko_id', effectiveTokoId);
    shiftQuery = shiftQuery.eq('toko_id', effectiveTokoId);
    piutangQuery = piutangQuery.eq('toko_id', effectiveTokoId);
    prodCountQuery = prodCountQuery.eq('toko_id', effectiveTokoId);
  }

  const [
    { data: tx7Hari, error: txErr },
    { data: rawShiftAktif },
    { data: piutangAktif },
    stokMenipis,
    { count: totalProdukAktif },
  ] = await Promise.all([
    txQuery,
    shiftQuery,
    piutangQuery,
    getStokMenipis(effectiveTokoId),
    prodCountQuery,
  ]);

  if (txErr) throw txErr;

  // Inisialisasi map 7 hari agar tanggal kosong tetap muncul 0 di grafik
  const harianMap = new Map();
  for (let i = -6; i <= 0; i++) {
    const dStr = getWibDateString(i);
    harianMap.set(dStr, { tanggal: dStr, omzet: 0, laba_kotor: 0, jumlah_transaksi: 0 });
  }

  const perMetode7Hari = {
    tunai: { jumlah_transaksi: 0, total_nominal: 0 },
    qris: { jumlah_transaksi: 0, total_nominal: 0 },
    split: { jumlah_transaksi: 0, total_nominal: 0 },
    bon: { jumlah_transaksi: 0, total_nominal: 0 },
  };

  for (const tx of (tx7Hari || [])) {
    const tot = Number(tx.total || 0);
    const wibDate = new Date(new Date(tx.tgl_transaksi).getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const bucket = harianMap.get(wibDate);
    if (bucket) {
      bucket.omzet += tot;
      bucket.laba_kotor += Number(tx.laba_kotor || 0);
      bucket.jumlah_transaksi += 1;
    }

    const mKey = perMetode7Hari[tx.metode_bayar] ? tx.metode_bayar : 'tunai';
    perMetode7Hari[mKey].jumlah_transaksi += 1;
    perMetode7Hari[mKey].total_nominal += tot;
  }

  const hariIni = harianMap.get(todayStr) || { omzet: 0, laba_kotor: 0, jumlah_transaksi: 0 };
  const kemarin = harianMap.get(yesterdayStr) || { omzet: 0, laba_kotor: 0, jumlah_transaksi: 0 };

  const pertumbuhanPersen = kemarin.omzet > 0
    ? Number((((hariIni.omzet - kemarin.omzet) / kemarin.omzet) * 100).toFixed(1))
    : (hariIni.omzet > 0 ? 100 : 0);

  const shiftAktif = (rawShiftAktif || []).map(formatShiftRow);
  const totalPiutang = (piutangAktif || []).reduce((sum, p) => sum + Number(p.sisa_bon || 0), 0);
  const jumlahPenghutang = new Set((piutangAktif || []).map(p => p.pelanggan_id)).size;

  // Produk terlaris 7 hari terakhir
  const txIds = (tx7Hari || []).map(t => t.id);
  let topProduk = [];
  if (txIds.length > 0) {
    const { data: details } = await supabaseAdmin
      .from('transaksi_detail')
      .select('produk_id, nama_produk, jumlah, isi_konversi, subtotal')
      .in('transaksi_id', txIds);

    const aggMap = new Map();
    for (const d of (details || [])) {
      const prev = aggMap.get(d.produk_id) || {
        produk_id: d.produk_id,
        nama_produk: d.nama_produk,
        qty_terjual_dasar: 0,
        total_penjualan: 0,
      };
      prev.qty_terjual_dasar += Number(d.jumlah || 0) * Number(d.isi_konversi || 1);
      prev.total_penjualan += Number(d.subtotal || 0);
      aggMap.set(d.produk_id, prev);
    }

    const topRaw = Array.from(aggMap.values())
      .sort((a, b) => b.total_penjualan - a.total_penjualan)
      .slice(0, 5);

    const topIds = topRaw.map(p => p.produk_id).filter(Boolean);
    let prodMetaMap = new Map();
    if (topIds.length > 0) {
      const { data: prodRows } = await supabaseAdmin
        .from('produk')
        .select('id, foto_url, satuan_dasar')
        .in('id', topIds);
      prodMetaMap = new Map((prodRows || []).map(r => [r.id, r]));
    }

    topProduk = topRaw.map(p => {
      const meta = prodMetaMap.get(p.produk_id);
      return {
        ...p,
        foto_url: meta?.foto_url || null,
        satuan_dasar: meta?.satuan_dasar || 'unit',
        total_qty: p.qty_terjual_dasar,
        total_omzet: p.total_penjualan,
      };
    });
  }

  return {
    hari_ini: {
      tanggal: todayStr,
      omzet: hariIni.omzet,
      laba_kotor: hariIni.laba_kotor,
      laba_kotor_estimasi: hariIni.laba_kotor,
      jumlah_transaksi: hariIni.jumlah_transaksi,
      rata_rata_keranjang: hariIni.jumlah_transaksi > 0 ? Math.round(hariIni.omzet / hariIni.jumlah_transaksi) : 0,
      pertumbuhan_persen: pertumbuhanPersen,
    },
    keuangan: {
      total_piutang_aktif: totalPiutang,
      jumlah_pelanggan_bon: jumlahPenghutang,
    },
    piutang: {
      total_belum_lunas: totalPiutang,
      jumlah_pelanggan: jumlahPenghutang,
    },
    inventaris: {
      total_produk_aktif: totalProdukAktif || 0,
      jumlah_stok_menipis: stokMenipis.total,
      produk_stok_menipis: stokMenipis.items || [],
    },
    shift_aktif: shiftAktif || [],
    stok_menipis: {
      total: stokMenipis.total,
      items: (stokMenipis.items || []).slice(0, 5),
    },
    grafik_7_hari: Array.from(harianMap.values()),
    per_metode_bayar: perMetode7Hari,
    produk_terlaris: topProduk,
  };
}
