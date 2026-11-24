import { supabaseAdmin } from '../../lib/supabase.js';
import { resolveDateRange } from './penjualan.js';

/**
 * Laporan Laba Rugi (Profit & Loss) Toko
 */
export async function getLaporanLabaRugi(tokoId, { tanggal_awal, tanggal_mulai, tanggal_akhir } = {}) {
  const { awal, akhir } = resolveDateRange(tanggal_awal || tanggal_mulai, tanggal_akhir);

  // 1. Pendapatan & HPP dari transaksi selesai
  const { data: txList, error: txErr } = await supabaseAdmin
    .from('transaksi')
    .select('subtotal, diskon, total, total_hpp, laba_kotor')
    .eq('toko_id', tokoId)
    .eq('status', 'selesai')
    .gte('tgl_transaksi', `${awal}T00:00:00+07:00`)
    .lte('tgl_transaksi', `${akhir}T23:59:59+07:00`);

  if (txErr) throw txErr;

  let pendapatanKotor = 0;
  let potonganDiskon = 0;
  let pendapatanBersih = 0;
  let totalHpp = 0;
  let labaKotor = 0;

  for (const tx of (txList || [])) {
    pendapatanKotor += Number(tx.subtotal || 0);
    potonganDiskon += Number(tx.diskon || 0);
    pendapatanBersih += Number(tx.total || 0);
    totalHpp += Number(tx.total_hpp || 0);
    labaKotor += Number(tx.laba_kotor || 0);
  }

  // 2. Beban Operasional dari arus_kas (tipe keluar, selain kulakan stok karena kulakan dihitung via HPP saat terjual)
  const { data: kasKeluar, error: kasErr } = await supabaseAdmin
    .from('arus_kas')
    .select('kategori, nominal')
    .eq('toko_id', tokoId)
    .eq('tipe', 'keluar')
    .gte('tgl_kas', awal)
    .lte('tgl_kas', akhir);

  if (kasErr) throw kasErr;

  let totalBebanOperasional = 0;
  let totalBelanjaKulakanKas = 0;
  const rincianBeban = {};

  for (const kas of (kasKeluar || [])) {
    const nom = Number(kas.nominal || 0);
    if (kas.kategori === 'kulakan') {
      totalBelanjaKulakanKas += nom;
      continue;
    }
    totalBebanOperasional += nom;
    rincianBeban[kas.kategori] = (rincianBeban[kas.kategori] || 0) + nom;
  }

  const labaBersih = labaKotor - totalBebanOperasional;
  const marginKotorPersen = pendapatanBersih > 0
    ? Number(((labaKotor / pendapatanBersih) * 100).toFixed(2))
    : 0;
  const marginBersihPersen = pendapatanBersih > 0
    ? Number(((labaBersih / pendapatanBersih) * 100).toFixed(2))
    : 0;

  return {
    periode: { awal, akhir },
    pendapatan: {
      pendapatan_kotor: pendapatanKotor,
      potongan_diskon: potonganDiskon,
      pendapatan_bersih: pendapatanBersih,
    },
    harga_pokok_penjualan: totalHpp,
    laba_kotor: labaKotor,
    margin_kotor_persen: marginKotorPersen,
    beban_operasional: {
      total: totalBebanOperasional,
      rincian: rincianBeban,
    },
    laba_bersih: labaBersih,
    margin_bersih_persen: marginBersihPersen,
    catatan_arus_kas: {
      belanja_kulakan_tunai: totalBelanjaKulakanKas,
    },
  };
}

