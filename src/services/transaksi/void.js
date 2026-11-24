import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import {
  applyAggregatedStockBatch,
  adjustPelangganPiutangAtomic,
  adjustShiftCountersAtomic,
} from '../../utils/atomic-db.js';
import { verifikasiPinKasir } from '../auth/pin.js';

/**
 * Pembatalan Transaksi Penjualan (Void Nota) oleh Owner atau Kasir (wajib PIN di server).
 * Menggunakan transisi status atomik anti-double-void & pengembalian stok/piutang/shift akurat.
 */
export async function voidTransaksi(
  tokoId,
  transaksiId,
  { alasan = 'Salah input nota', kasir_id_guard = null, pin = null, actor_id = null, actor_peran = null } = {}
) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko wajib tersedia pada sesi ini');
  }

  if (actor_peran === 'kasir' || kasir_id_guard) {
    const verifierId = actor_id || kasir_id_guard;
    if (!pin) {
      throw new BadRequest('PIN otorisasi kasir 6 digit wajib dikirim untuk membatalkan transaksi');
    }
    await verifikasiPinKasir(tokoId, verifierId, pin);
  }

  // 1. Cek kepemilikan & validasi sebelum void
  const { data: tx, error: txErr } = await supabaseAdmin
    .from('transaksi')
    .select(
      'id, no_transaksi, status, shift_id, kasir_id, total, uang_diterima, kembalian, split_tunai, split_qris, metode_bayar, pelanggan_id'
    )
    .eq('id', transaksiId)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (txErr) throw txErr;
  if (!tx) throw new NotFound('Transaksi tidak ditemukan');

  if (kasir_id_guard && tx.kasir_id && tx.kasir_id !== kasir_id_guard) {
    throw new BadRequest('Kasir hanya dapat membatalkan transaksi yang dilayani sendiri');
  }
  if (tx.status === 'batal') {
    throw new BadRequest('Transaksi ini sudah pernah dibatalkan sebelumnya');
  }

  // 2. Klaim status menjadi 'batal' secara atomik agar request paralel tidak melakukan double-void
  const { data: updatedTx, error: updateErr } = await supabaseAdmin
    .from('transaksi')
    .update({ status: 'batal' })
    .eq('id', transaksiId)
    .eq('toko_id', tokoId)
    .neq('status', 'batal')
    .select()
    .maybeSingle();

  if (updateErr) throw updateErr;
  if (!updatedTx) {
    throw new BadRequest('Transaksi ini sudah dibatalkan oleh proses lain');
  }

  // 3. Ambil & agregasikan detail produk per produk_id untuk pengembalian stok
  const { data: detailList, error: detErr } = await supabaseAdmin
    .from('transaksi_detail')
    .select('produk_id, jumlah, isi_konversi')
    .eq('transaksi_id', transaksiId);

  if (detErr) throw detErr;

  const returnByProd = new Map();
  for (const item of detailList || []) {
    const qtyKembali = Number(item.jumlah) * Number(item.isi_konversi || 1);
    if (qtyKembali <= 0) continue;
    returnByProd.set(item.produk_id, (returnByProd.get(item.produk_id) || 0) + qtyKembali);
  }

  if (returnByProd.size > 0) {
    const returnBatch = Array.from(returnByProd.entries()).map(([produkId, qtyKembali]) => ({
      produk_id: produkId,
      delta: qtyKembali,
      jenis: 'batal_jual',
      ref_id: transaksiId,
      catatan: `Void ${tx.no_transaksi} (${alasan})`,
    }));
    await applyAggregatedStockBatch(tokoId, returnBatch, { allowNegative: true });
  }

  // 4. Jika transaksi bon, batalkan piutang terkait & kurangi hanya sesuai sisa_bon yang belum terbayar
  let totalSisaBonDibatalkan = 0;
  if (tx.metode_bayar === 'bon' && tx.pelanggan_id) {
    const { data: piutangRows } = await supabaseAdmin
      .from('piutang')
      .select('id, sisa_bon, status')
      .eq('transaksi_id', transaksiId)
      .eq('toko_id', tokoId);

    for (const pt of piutangRows || []) {
      if (pt.status !== 'batal') {
        totalSisaBonDibatalkan += Math.max(0, Number(pt.sisa_bon || 0));
      }
    }

    await supabaseAdmin
      .from('piutang')
      .update({ status: 'batal', sisa_bon: 0 })
      .eq('transaksi_id', transaksiId)
      .eq('toko_id', tokoId);

    if (totalSisaBonDibatalkan > 0) {
      await adjustPelangganPiutangAtomic(tokoId, tx.pelanggan_id, -totalSisaBonDibatalkan);
    }
  }

  // 5. Revert akumulasi omzet pada shift_kasir terkait
  if (tx.shift_id) {
    let deltaTunai = 0;
    let deltaQris = 0;
    let deltaSplit = 0;
    let deltaBon = 0;
    const totalTx = Number(tx.total || 0);

    if (tx.metode_bayar === 'tunai') {
      deltaTunai = -totalTx;
    } else if (tx.metode_bayar === 'qris') {
      deltaQris = -totalTx;
    } else if (tx.metode_bayar === 'split') {
      const tunaiMasuk = Math.max(0, Number(tx.split_tunai || 0) - Number(tx.kembalian || 0));
      deltaTunai = -tunaiMasuk;
      deltaQris = -Number(tx.split_qris || 0);
      deltaSplit = -totalTx;
    } else if (tx.metode_bayar === 'bon') {
      const dpBon = Number(tx.uang_diterima || 0);
      deltaBon = -totalSisaBonDibatalkan;
      deltaTunai = -dpBon;
    }

    await adjustShiftCountersAtomic({
      tokoId,
      shiftId: tx.shift_id,
      deltaTransaksi: -1,
      deltaTunai,
      deltaQris,
      deltaSplit,
      deltaBon,
    });
  }

  return {
    transaksi: updatedTx,
    alasan,
    stok_dikembalikan: true,
    piutang_dibatalkan: totalSisaBonDibatalkan,
  };
}
