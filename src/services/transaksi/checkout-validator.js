import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';

/** Memastikan nilai numerik valid (finite) dan tidak bernilai negatif. */
export function assertNonNegativeFinite(val, label) {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) {
    throw new BadRequest(`${label} tidak valid atau tidak boleh bernilai negatif`);
  }
  return num;
}

/** Menguraikan dan memvalidasi nominal input pembayaran dari berbagai field alias payload. */
export function parseCheckoutPaymentInputs(payload) {
  const metodeBayar = payload.metode_bayar || 'tunai';
  const rawUangDiterima = payload.uang_diterima !== undefined && payload.uang_diterima !== null ? Number(payload.uang_diterima) : null;
  const rawBayarTunai = payload.bayar_tunai !== undefined && payload.bayar_tunai !== null ? Number(payload.bayar_tunai) : null;
  const rawCashReceived = payload.cash_received !== undefined && payload.cash_received !== null ? Number(payload.cash_received) : null;

  let uangDiterima = 0;
  if (rawUangDiterima !== null && Number.isFinite(rawUangDiterima) && rawUangDiterima > 0) {
    uangDiterima = rawUangDiterima;
  } else if (rawBayarTunai !== null && Number.isFinite(rawBayarTunai) && rawBayarTunai > 0) {
    uangDiterima = rawBayarTunai;
  } else if (rawCashReceived !== null && Number.isFinite(rawCashReceived) && rawCashReceived > 0) {
    uangDiterima = rawCashReceived;
  } else if (rawUangDiterima !== null && Number.isFinite(rawUangDiterima)) {
    uangDiterima = rawUangDiterima;
  } else if (rawBayarTunai !== null && Number.isFinite(rawBayarTunai)) {
    uangDiterima = rawBayarTunai;
  }
  assertNonNegativeFinite(uangDiterima, 'Uang tunai diterima');

  const splitTunai = assertNonNegativeFinite(payload.split_tunai ?? payload.bayar_tunai ?? 0, 'Split tunai');
  const splitQris = assertNonNegativeFinite(payload.split_qris ?? payload.bayar_qris ?? 0, 'Split QRIS');
  const uangMukaBon = assertNonNegativeFinite(
    payload.uang_muka ?? payload.dp_tunai ?? (metodeBayar === 'bon' ? payload.bayar_tunai : 0) ?? 0,
    'Uang muka kas bon'
  );
  const alokasiBayarBon = assertNonNegativeFinite(payload.alokasi_bayar_bon ?? 0, 'Alokasi bayar kas bon');

  return { uangDiterima, splitTunai, splitQris, uangMukaBon, alokasiBayarBon };
}

/** Memvalidasi item keranjang, agregasi kebutuhan stok per produk, serta menghitung subtotal dan HPP. */
export function prepareCheckoutItems(items, productMap) {
  let kalkulasiSubtotal = 0;
  let kalkulasiTotalHPP = 0;
  const detailItems = [];
  const aggregatedNeedByProduct = new Map();

  for (const item of items) {
    const prod = productMap.get(item.produk_id);
    if (!prod || !prod.aktif) {
      throw new NotFound(`Produk '${item.nama_produk || item.produk_id}' tidak ditemukan atau non-aktif`);
    }

    const qty = Number(item.jumlah);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequest(`Jumlah beli untuk '${prod.nama}' harus lebih besar dari 0`);
    }

    let namaSatuan = prod.satuan_dasar;
    let isiKonversi = 1;
    let hargaSatuan = Number(prod.harga_jual);
    let modalSatuan = Number(prod.harga_modal || 0);

    if (item.satuan_id) {
      const satuanGrosir = (prod.produk_satuan || []).find((s) => s.id === item.satuan_id && s.aktif);
      if (!satuanGrosir) {
        throw new NotFound(`Satuan grosir untuk '${prod.nama}' tidak valid`);
      }
      namaSatuan = satuanGrosir.nama_satuan;
      isiKonversi = Number(satuanGrosir.isi_konversi);
      hargaSatuan = Number(satuanGrosir.harga_jual);
      modalSatuan = modalSatuan * isiKonversi;
    }

    const totalPenguranganStok = qty * isiKonversi;
    const prevAgg = aggregatedNeedByProduct.get(prod.id) || { prod, totalNeed: 0, units: [] };
    prevAgg.totalNeed += totalPenguranganStok;
    prevAgg.units.push(`${qty} ${namaSatuan}`);
    aggregatedNeedByProduct.set(prod.id, prevAgg);

    const diskonItem = assertNonNegativeFinite(item.diskon_item || 0, `Diskon item ${prod.nama}`);
    const subtotalBaris = Math.max(0, hargaSatuan * qty - diskonItem);
    kalkulasiSubtotal += subtotalBaris;
    kalkulasiTotalHPP += modalSatuan * qty;

    detailItems.push({
      produk_id: prod.id,
      satuan_id: item.satuan_id || null,
      nama_produk: prod.nama,
      nama_satuan: namaSatuan,
      isi_konversi: isiKonversi,
      jumlah: qty,
      harga_satuan: hargaSatuan,
      modal_satuan: modalSatuan,
      diskon_item: diskonItem,
      subtotal: subtotalBaris,
      total_pengurangan_stok: totalPenguranganStok,
    });
  }

  for (const { prod, totalNeed } of aggregatedNeedByProduct.values()) {
    if (Number(prod.stok) < totalNeed) {
      throw new BadRequest(
        `Stok '${prod.nama}' tidak mencukupi (Tersedia: ${prod.stok} ${prod.satuan_dasar}, Total dibutuhkan: ${totalNeed} ${prod.satuan_dasar})`
      );
    }
  }

  return { kalkulasiSubtotal, kalkulasiTotalHPP, detailItems, aggregatedNeedByProduct };
}

/** Memvalidasi kecukupan dana, batas kas bon pelanggan, dan alokasi pelunasan piutang. */
export async function validateCheckoutPayment({
  tokoId,
  pelanggan_id,
  metode_bayar,
  totalAkhir,
  uangDiterima,
  splitTunai,
  splitQris,
  uangMukaBon,
  alokasiBayarBon,
}) {
  let bayarTunai = 0;
  let bayarQris = 0;
  let kembalian = 0;
  let pelangganData = null;

  if (alokasiBayarBon > 0) {
    if (!pelanggan_id) {
      throw new BadRequest('Alokasi pelunasan kas bon hanya berlaku untuk pelanggan terdaftar');
    }
    const { data: pelCheck, error: pelCheckErr } = await supabaseAdmin
      .from('pelanggan')
      .select('id, nama, total_piutang')
      .eq('id', pelanggan_id)
      .eq('toko_id', tokoId)
      .maybeSingle();
    if (pelCheckErr || !pelCheck) {
      throw new NotFound('Data pelanggan untuk pelunasan bon tidak ditemukan');
    }
    if (alokasiBayarBon > Number(pelCheck.total_piutang || 0)) {
      throw new BadRequest(
        `Alokasi bayar bon (Rp${alokasiBayarBon.toLocaleString('id-ID')}) melebihi sisa piutang pelanggan (Rp${Number(pelCheck.total_piutang || 0).toLocaleString('id-ID')})`
      );
    }
  }

  if (metode_bayar === 'tunai') {
    bayarTunai = uangDiterima;
    const totalDibutuhkan = totalAkhir + alokasiBayarBon;
    if (bayarTunai < totalDibutuhkan) {
      throw new BadRequest(
        alokasiBayarBon > 0
          ? `Uang tunai kurang. Total belanja (Rp${totalAkhir.toLocaleString('id-ID')}) + Alokasi bayar kas bon (Rp${alokasiBayarBon.toLocaleString('id-ID')}) = Rp${totalDibutuhkan.toLocaleString('id-ID')}, Uang diterima: Rp${bayarTunai.toLocaleString('id-ID')}`
          : `Uang tunai kurang. Total belanja: Rp${totalAkhir.toLocaleString('id-ID')}, Uang diterima: Rp${bayarTunai.toLocaleString('id-ID')}`
      );
    }
    kembalian = bayarTunai - totalDibutuhkan;
  } else if (metode_bayar === 'qris') {
    bayarQris = totalAkhir;
  } else if (metode_bayar === 'split') {
    const totalKombinasi = splitTunai + splitQris;
    if (totalKombinasi < totalAkhir) {
      throw new BadRequest(
        `Total pembayaran kombinasi kurang. Total belanja: ${totalAkhir}, Diterima (Tunai + QRIS): ${totalKombinasi}`
      );
    }
    bayarTunai = splitTunai;
    bayarQris = splitQris;
    kembalian = totalKombinasi - totalAkhir;
  } else if (metode_bayar === 'bon') {
    if (!pelanggan_id) {
      throw new BadRequest('Untuk pembayaran Kas Bon / Utang, data pelanggan wajib dipilih');
    }
    if (uangMukaBon > totalAkhir) {
      throw new BadRequest('Uang muka (DP) kas bon tidak boleh melebihi total tagihan belanja');
    }
    const { data: pel, error: pelErr } = await supabaseAdmin
      .from('pelanggan')
      .select('id, nama, batas_bon, total_piutang')
      .eq('id', pelanggan_id)
      .eq('toko_id', tokoId)
      .maybeSingle();

    if (pelErr || !pel) throw new NotFound('Data pelanggan tidak ditemukan');

    const sisaBonUtang = Math.max(0, totalAkhir - uangMukaBon);
    const currentPiutang = Number(pel.total_piutang || 0);
    const batasBon = Number(pel.batas_bon || 500000);
    if (currentPiutang + sisaBonUtang > batasBon) {
      throw new BadRequest(
        `Batas kas bon terlampaui. Total utang berjalan: Rp${currentPiutang.toLocaleString('id-ID')}, Batas: Rp${batasBon.toLocaleString('id-ID')}, Belanja baru: Rp${sisaBonUtang.toLocaleString('id-ID')}`
      );
    }
    pelangganData = pel;
    bayarTunai = uangMukaBon;
  }

  return { bayarTunai, bayarQris, kembalian, pelangganData };
}
