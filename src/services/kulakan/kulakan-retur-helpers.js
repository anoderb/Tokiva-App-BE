import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';

/**
 * Parse nilai rupiah dari string catatan secara aman tanpa melipatgandakan desimal ('.00' -> x100)
 */
export function parseReturCurrencyValue(rawText) {
  if (!rawText) return 0;
  const cleaned = String(rawText).trim();
  const match = cleaned.match(/(\d[\d.,]*)/);
  if (!match) return 0;
  let token = match[1];
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(token)) {
    token = token.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+\.\d{1,2}$/.test(token)) {
    return Math.round(Number(token)) || 0;
  } else if (/^\d+,\d{1,2}$/.test(token)) {
    return Math.round(Number(token.replace(',', '.'))) || 0;
  } else {
    token = token.replace(/[.,]/g, '');
  }
  const num = Number(token);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

/**
 * Helper mem-parsing catatan mutasi retur agar mudah ditampilkan di tabel frontend
 */
export function parseReturMutasiRow(row) {
  const rawCatatan = row.catatan || '';
  const extract = (label) => {
    const regex = new RegExp(`${label}:\\s*([^|]+)`, 'i');
    const m = rawCatatan.match(regex);
    return m ? m[1].trim() : null;
  };

  const qtyText = extract('Qty') || `${Math.abs(Number(row.perubahan || 0))} ${row.produk?.satuan_dasar || 'pcs'}`;
  const nilaiNum = parseReturCurrencyValue(extract('Nilai'));
  const kompensasi = extract('Kompensasi') || 'potong_nota';
  const alasan = extract('Alasan') || rawCatatan;

  return {
    id: row.id,
    kulakan_id: row.ref_id,
    produk_id: row.produk_id,
    nama_produk: row.produk?.nama || 'Produk',
    satuan_dasar: row.produk?.satuan_dasar || 'pcs',
    perubahan_stok: Number(row.perubahan || 0),
    stok_sebelum: Number(row.stok_sebelum || 0),
    stok_sesudah: Number(row.stok_sesudah || 0),
    qty_label: qtyText,
    nilai_retur: nilaiNum,
    kompensasi,
    alasan,
    catatan: rawCatatan,
    waktu: row.waktu,
  };
}

/**
 * Memvalidasi daftar item retur terhadap detail faktur & stok fisik saat ini.
 */
export function buildValidatedReturActions({ validItems, details, prodMap, kompensasi }) {
  let totalNilaiRetur = 0;
  const actions = [];
  const totalOutByProduct = new Map();

  for (const reqItem of validItems) {
    const detRow = (details || []).find(
      (d) => (reqItem.detail_id && d.id === reqItem.detail_id) || d.produk_id === reqItem.produk_id
    );
    if (!detRow) {
      throw new BadRequest('Barang yang diretur tidak ditemukan pada faktur kulakan ini');
    }

    const prod = prodMap.get(reqItem.produk_id);
    if (!prod) {
      throw new NotFound('Data produk tidak ditemukan di katalog toko');
    }

    const qtyRetur = Number(reqItem.jumlah_retur);
    const maxQtyFaktur = Number(detRow.jumlah || 0);
    if (qtyRetur > maxQtyFaktur) {
      throw new BadRequest(
        `Jumlah retur '${prod.nama}' (${qtyRetur} ${detRow.nama_satuan}) melebihi jumlah beli pada faktur (${maxQtyFaktur} ${detRow.nama_satuan})`
      );
    }

    const isiKonversi = Number(detRow.isi_konversi || 1);
    const hargaSatuan = Number(detRow.harga_satuan || 0);
    const totalPcsRetur = qtyRetur * isiKonversi;
    const nilaiBaris = Math.round(qtyRetur * hargaSatuan);

    if (kompensasi !== 'tukar_barang') {
      const nextOut = (totalOutByProduct.get(prod.id) || 0) + totalPcsRetur;
      if (Number(prod.stok) < nextOut) {
        throw new BadRequest(
          `Stok fisik '${prod.nama}' saat ini (${prod.stok} ${prod.satuan_dasar}) tidak mencukupi untuk diretur sebanyak ${nextOut} ${prod.satuan_dasar}`
        );
      }
      totalOutByProduct.set(prod.id, nextOut);
    }

    totalNilaiRetur += nilaiBaris;
    actions.push({ detRow, prod, qtyRetur, isiKonversi, hargaSatuan, totalPcsRetur, nilaiBaris });
  }

  return { totalNilaiRetur, actions };
}

/**
 * Menghitung nominal efektif yang sudah dibayar ke pemasok untuk validasi batas refund.
 */
export async function resolveEffectivePaidKulakan(tokoId, kulakanId, header) {
  const { data: payments } = await supabaseAdmin
    .from('arus_kas')
    .select('nominal')
    .eq('toko_id', tokoId)
    .eq('ref_id', kulakanId)
    .eq('kategori', 'kulakan')
    .eq('tipe', 'keluar');

  const recordedPaid = (payments || []).reduce((s, p) => s + Number(p.nominal || 0), 0);
  return header.lunas ? Math.max(recordedPaid, Number(header.total_beli || 0)) : recordedPaid;
}
