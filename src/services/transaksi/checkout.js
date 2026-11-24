import { supabaseAdmin } from '../../lib/supabase.js';
import { generateInvoiceNumber } from '../../utils/format.js';
import { BadRequest } from '../../utils/errors.js';
import {
  applyAggregatedStockBatch,
  adjustPelangganPiutangAtomic,
  adjustShiftCountersAtomic,
} from '../../utils/atomic-db.js';
import { getShiftAktif } from '../shift/buka-tutup.js';
import { bayarPiutangFifo } from '../pelanggan/piutang.js';
import {
  assertNonNegativeFinite,
  parseCheckoutPaymentInputs,
  prepareCheckoutItems,
  validateCheckoutPayment,
} from './checkout-validator.js';

/**
 * Mesin Checkout POS Kasir (dengan agregasi stok duplikat produk_id & operasi atomik)
 */
export async function checkoutTransaksi(tokoId, kasirId, payload) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko wajib tersedia pada sesi kasir');
  }

  const {
    shift_id: inputShiftId,
    pelanggan_id,
    metode_bayar = 'tunai',
    diskon = 0,
    qris_ref,
    items = [],
  } = payload;

  const { uangDiterima, splitTunai, splitQris, uangMukaBon, alokasiBayarBon } =
    parseCheckoutPaymentInputs(payload);

  if (!items || items.length === 0) {
    throw new BadRequest('Keranjang belanja kasir masih kosong');
  }

  // 1. Tentukan Shift Aktif Kasir
  let activeShiftId = inputShiftId;
  if (!activeShiftId) {
    const shiftAktif = await getShiftAktif(tokoId, kasirId);
    if (shiftAktif) activeShiftId = shiftAktif.id;
  }

  // 2. Ambil seluruh data produk unik yang ada di keranjang belanja
  const productIds = Array.from(new Set(items.map((it) => it.produk_id)));
  const { data: dbProducts, error: prodErr } = await supabaseAdmin
    .from('produk')
    .select('id, nama, barcode, satuan_dasar, harga_jual, harga_modal, stok, aktif, produk_satuan(*)')
    .eq('toko_id', tokoId)
    .in('id', productIds);

  if (prodErr) throw prodErr;

  const productMap = new Map((dbProducts || []).map((p) => [p.id, p]));

  // 3. Validasi item & hitung subtotal + agregasi kebutuhan stok
  const { kalkulasiSubtotal, kalkulasiTotalHPP, detailItems, aggregatedNeedByProduct } =
    prepareCheckoutItems(items, productMap);

  // 4. Kalkulasi Total Akhir & Laba Kotor
  const diskonGlobal = assertNonNegativeFinite(diskon || 0, 'Diskon transaksi');
  const totalAkhir = Math.max(0, kalkulasiSubtotal - diskonGlobal);
  const labaKotor = totalAkhir - kalkulasiTotalHPP;

  // 5. Validasi Pembayaran Sesuai Metode
  const { bayarTunai, bayarQris, kembalian, pelangganData } = await validateCheckoutPayment({
    tokoId,
    pelanggan_id,
    metode_bayar,
    totalAkhir,
    uangDiterima,
    splitTunai,
    splitQris,
    uangMukaBon,
    alokasiBayarBon,
  });

  // 6. Generate Nomor Invoice Unik & Simpan Transaksi Induk
  const noTransaksi = generateInvoiceNumber(Math.floor(1000 + Math.random() * 9000));
  const nominalUangDiterima =
    metode_bayar === 'tunai'
      ? bayarTunai
      : metode_bayar === 'qris'
        ? totalAkhir
        : metode_bayar === 'split'
          ? bayarTunai + bayarQris
          : uangMukaBon;

  const { data: headerTransaksi, error: headerErr } = await supabaseAdmin
    .from('transaksi')
    .insert({
      toko_id: tokoId,
      shift_id: activeShiftId || null,
      kasir_id: kasirId,
      pelanggan_id: pelanggan_id || null,
      no_transaksi: noTransaksi,
      subtotal: kalkulasiSubtotal,
      diskon: diskonGlobal,
      total: totalAkhir,
      total_hpp: kalkulasiTotalHPP,
      laba_kotor: labaKotor,
      metode_bayar,
      uang_diterima: nominalUangDiterima,
      kembalian,
      split_tunai: metode_bayar === 'split' ? bayarTunai : null,
      split_qris: metode_bayar === 'split' ? bayarQris : null,
      qris_ref: qris_ref || null,
      status: 'selesai',
      cetak_ke: 0,
    })
    .select()
    .single();

  if (headerErr) throw headerErr;

  // 7. Simpan Detail & Potong Stok Secara Atomik (dengan Rollback Otomatis jika Gagal)
  const detailInserts = detailItems.map((d) => ({
    transaksi_id: headerTransaksi.id,
    produk_id: d.produk_id,
    satuan_id: d.satuan_id,
    nama_produk: d.nama_produk,
    nama_satuan: d.nama_satuan,
    isi_konversi: d.isi_konversi,
    jumlah: d.jumlah,
    harga_satuan: d.harga_satuan,
    modal_satuan: d.modal_satuan,
    diskon_item: d.diskon_item,
    subtotal: d.subtotal,
  }));

  const { error: detailErr } = await supabaseAdmin.from('transaksi_detail').insert(detailInserts);
  if (detailErr) {
    await Promise.resolve(supabaseAdmin.from('transaksi').delete().eq('id', headerTransaksi.id)).catch(() => { });
    throw detailErr;
  }

  const stockBatchEntries = Array.from(aggregatedNeedByProduct.values()).map(({ prod, totalNeed, units }) => ({
    produk_id: prod.id,
    delta: -totalNeed,
    jenis: 'penjualan',
    ref_id: headerTransaksi.id,
    catatan: `Penjualan ${headerTransaksi.no_transaksi} (${units.join(' + ')})`,
  }));

  try {
    await applyAggregatedStockBatch(tokoId, stockBatchEntries, { allowNegative: false });
  } catch (stockErr) {
    await Promise.resolve(supabaseAdmin.from('transaksi').delete().eq('id', headerTransaksi.id)).catch(() => { });
    throw stockErr;
  }

  // 8. Jika metode bayar Kas Bon, catat piutang & perbarui total_piutang secara atomik
  if (metode_bayar === 'bon' && pelangganData) {
    const sisaBon = Math.max(0, totalAkhir - uangMukaBon);
    const { error: piutangErr } = await supabaseAdmin.from('piutang').insert({
      toko_id: tokoId,
      pelanggan_id,
      transaksi_id: headerTransaksi.id,
      total_bon: totalAkhir,
      terbayar: uangMukaBon,
      sisa_bon: sisaBon,
      status: sisaBon === 0 ? 'lunas' : 'belum_lunas',
    });
    if (piutangErr) throw piutangErr;

    await adjustPelangganPiutangAtomic(tokoId, pelanggan_id, sisaBon);
  }

  // 9. Eksekusi Pelunasan Kas Bon FIFO jika dialokasikan dari kembalian tunai
  let pelunasanBonResult = null;
  if (alokasiBayarBon > 0 && pelanggan_id) {
    pelunasanBonResult = await bayarPiutangFifo(tokoId, kasirId, {
      pelanggan_id,
      nominal_bayar: alokasiBayarBon,
      metode: 'tunai',
      shift_id: activeShiftId,
      catatan: `Potong kas bon dari transaksi belanja ${headerTransaksi.no_transaksi}`,
    });
  }

  // 10. Akumulasi Omzet ke Shift Kasir Secara Atomik
  if (activeShiftId) {
    const sisaBon = Math.max(0, totalAkhir - uangMukaBon);
    await adjustShiftCountersAtomic({
      tokoId,
      shiftId: activeShiftId,
      deltaTransaksi: 1,
      deltaTunai:
        metode_bayar === 'tunai'
          ? totalAkhir
          : metode_bayar === 'split'
            ? Math.max(0, bayarTunai - kembalian)
            : metode_bayar === 'bon'
              ? uangMukaBon
              : 0,
      deltaQris: metode_bayar === 'qris' ? totalAkhir : metode_bayar === 'split' ? bayarQris : 0,
      deltaSplit: metode_bayar === 'split' ? totalAkhir : 0,
      deltaBon: metode_bayar === 'bon' ? sisaBon : 0,
    });
  }

  return {
    ...headerTransaksi,
    transaksi: headerTransaksi,
    detail: detailItems,
    struk: {
      no_transaksi: headerTransaksi.no_transaksi,
      waktu: headerTransaksi.tgl_transaksi,
      total_item: detailItems.length,
      subtotal: kalkulasiSubtotal,
      diskon: diskonGlobal,
      total: totalAkhir,
      metode_bayar,
      uang_diterima: nominalUangDiterima,
      alokasi_bayar_bon: alokasiBayarBon > 0 ? alokasiBayarBon : undefined,
      sisa_kas_bon: pelunasanBonResult ? pelunasanBonResult.sisa_piutang_pelanggan : undefined,
      kembalian,
    },
    pelunasan_bon: pelunasanBonResult,
  };
}
