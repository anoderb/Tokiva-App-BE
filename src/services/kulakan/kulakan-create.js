import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { applyAggregatedStockBatch } from '../../utils/atomic-db.js';

/**
 * Catat Pembelian Kulakan Baru (Agregasi per produk_id + Update Stok Atomik & HPP)
 */
export async function createKulakan(tokoId, payload) {
  const pemasok_id = payload.pemasok_id || null;
  const rawNoFaktur = payload.no_faktur || payload.nomor_faktur || '';
  const no_faktur = rawNoFaktur.trim() || `KB-${Date.now().toString().slice(-8)}`;
  const tgl_beli = payload.tgl_beli || payload.tanggal_kulakan || new Date().toISOString().slice(0, 10);
  const tgl_terima = payload.tgl_terima || tgl_beli;
  const rawJenis = String(payload.jenis_bayar || payload.metode_bayar || 'tunai').toLowerCase();
  const jenis_bayar = rawJenis.includes('tempo') || rawJenis.includes('kredit') ? 'kredit' : 'tunai';
  const jatuh_tempo = payload.jatuh_tempo || null;
  const foto_nota = payload.foto_nota || null;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const status_bayar = payload.status_bayar || (jenis_bayar === 'tunai' ? 'lunas' : 'belum_lunas');
  const isLunas = status_bayar === 'lunas' || jenis_bayar === 'tunai';

  if (!items || items.length === 0) {
    throw new BadRequest('Daftar barang kulakan tidak boleh kosong');
  }

  const productIds = Array.from(new Set(items.map((it) => it.produk_id)));
  const { data: dbProducts, error: pErr } = await supabaseAdmin
    .from('produk')
    .select('id, nama, stok, harga_modal, satuan_dasar')
    .eq('toko_id', tokoId)
    .in('id', productIds);

  if (pErr) throw pErr;
  const productMap = new Map((dbProducts || []).map((p) => [p.id, p]));

  let kalkulasiTotalBeli = 0;
  const detailInserts = [];
  const aggregatedByProduct = new Map();

  for (const item of items) {
    const prod = productMap.get(item.produk_id);
    if (!prod) {
      throw new NotFound(`Produk ID '${item.produk_id}' tidak ditemukan`);
    }

    const qty = Number(item.jumlah);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequest(`Jumlah beli untuk '${prod.nama}' harus lebih dari 0`);
    }

    const hargaSatuan = Number(item.harga_satuan ?? item.harga_beli_satuan ?? 0);
    if (!Number.isFinite(hargaSatuan) || hargaSatuan < 0) {
      throw new BadRequest(`Harga beli untuk '${prod.nama}' tidak boleh negatif`);
    }

    const isiKonversi = Number(item.isi_konversi ?? item.konversi_ke_dasar ?? 1);
    if (!Number.isFinite(isiKonversi) || isiKonversi <= 0) {
      throw new BadRequest(`Konversi satuan untuk '${prod.nama}' harus lebih dari 0`);
    }

    const namaSatuan = item.nama_satuan || item.satuan || prod.satuan_dasar;
    const subtotal = Math.round(qty * hargaSatuan);
    kalkulasiTotalBeli += subtotal;

    const hppEceranBaru = Math.round(hargaSatuan / isiKonversi);
    const totalPcsMasuk = qty * isiKonversi;

    detailInserts.push({
      produk_id: item.produk_id,
      nama_satuan: namaSatuan,
      isi_konversi: isiKonversi,
      jumlah: qty,
      harga_satuan: hargaSatuan,
      subtotal: subtotal,
    });

    const prevAgg = aggregatedByProduct.get(item.produk_id) || {
      produk_id: item.produk_id,
      satuan_dasar: prod.satuan_dasar,
      delta: 0,
      hpp_baru: hppEceranBaru,
      labels: [],
    };
    prevAgg.delta += totalPcsMasuk;
    prevAgg.hpp_baru = hppEceranBaru;
    prevAgg.labels.push(`${qty} ${namaSatuan}`);
    aggregatedByProduct.set(item.produk_id, prevAgg);
  }

  const { data: header, error: headErr } = await supabaseAdmin
    .from('kulakan')
    .insert({
      toko_id: tokoId,
      pemasok_id: pemasok_id || null,
      no_faktur: no_faktur,
      tgl_beli: tgl_beli,
      tgl_terima: tgl_terima || tgl_beli,
      total_beli: kalkulasiTotalBeli,
      jenis_bayar: jenis_bayar,
      jatuh_tempo: jenis_bayar === 'kredit' ? jatuh_tempo : null,
      lunas: isLunas,
      foto_nota: foto_nota || null,
      status: 'selesai',
    })
    .select()
    .single();

  if (headErr) throw headErr;

  const detailsWithId = detailInserts.map((d) => ({
    ...d,
    kulakan_id: header.id,
  }));

  const { error: detErr } = await supabaseAdmin
    .from('kulakan_detail')
    .insert(detailsWithId);

  if (detErr) {
    await Promise.resolve(supabaseAdmin.from('kulakan').delete().eq('id', header.id)).catch(() => {});
    throw detErr;
  }

  const batchEntries = Array.from(aggregatedByProduct.values()).map((agg) => ({
    produk_id: agg.produk_id,
    delta: agg.delta,
    jenis: 'kulakan',
    ref_id: header.id,
    harga_modal_baru: agg.hpp_baru,
    catatan: `Kulakan Faktur ${header.no_faktur} (+${agg.delta} ${agg.satuan_dasar} via ${agg.labels.join(' + ')})`,
  }));

  try {
    await applyAggregatedStockBatch(tokoId, batchEntries, { allowNegative: true });
  } catch (stockErr) {
    await Promise.resolve(supabaseAdmin.from('kulakan').delete().eq('id', header.id)).catch(() => {});
    throw stockErr;
  }

  if (isLunas) {
    const { error: kasErr } = await supabaseAdmin.from('arus_kas').insert({
      toko_id: tokoId,
      tipe: 'keluar',
      kategori: 'kulakan',
      nominal: kalkulasiTotalBeli,
      tgl_kas: tgl_beli,
      ref_id: header.id,
      foto_nota: foto_nota || null,
      catatan: `Belanja Kulakan Faktur ${header.no_faktur}`,
    });
    if (kasErr) throw kasErr;
  }

  return {
    ...header,
    items: detailsWithId,
  };
}
