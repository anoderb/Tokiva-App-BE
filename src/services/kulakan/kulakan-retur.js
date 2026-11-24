import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';
import { applyAggregatedStockBatch } from '../../utils/atomic-db.js';
import {
  buildValidatedReturActions,
  parseReturCurrencyValue,
  parseReturMutasiRow,
  resolveEffectivePaidKulakan,
} from './kulakan-retur-helpers.js';

export { parseReturCurrencyValue, parseReturMutasiRow };

/**
 * Daftar Riwayat Retur Barang ke Pemasok / Supplier
 */
export async function listReturKulakan(tokoId, { search, limit = 50, page = 1 } = {}) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('mutasi_stok')
    .select(
      `
      *,
      produk:produk_id(id, nama, barcode, satuan_dasar)
    `,
      { count: 'exact' }
    )
    .eq('toko_id', tokoId)
    .eq('jenis', 'retur');

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.ilike('catatan', `%${cleanSearch}%`);
  }

  const { data: rows, count, error } = await query
    .order('waktu', { ascending: false })
    .range(from, to);

  if (error) throw error;

  const kulakanIds = Array.from(new Set((rows || []).map((r) => r.ref_id).filter(Boolean)));
  let kulakanMap = new Map();
  if (kulakanIds.length > 0) {
    const { data: kList } = await supabaseAdmin
      .from('kulakan')
      .select('id, no_faktur, tgl_beli, pemasok:pemasok_id(id, nama, telepon)')
      .in('id', kulakanIds);

    kulakanMap = new Map((kList || []).map((k) => [k.id, k]));
  }

  const items = (rows || []).map((r) => {
    const parsed = parseReturMutasiRow(r);
    const kInfo = r.ref_id ? kulakanMap.get(r.ref_id) : null;
    return {
      ...parsed,
      no_faktur: kInfo?.no_faktur || '-',
      tgl_beli: kInfo?.tgl_beli || null,
      nama_pemasok: kInfo?.pemasok?.nama || 'Grosir Umum / Tanpa Pemasok',
    };
  });

  return {
    items,
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * Proses Retur Barang ke Supplier dari Faktur Kulakan
 */
export async function returKulakan(tokoId, userId, kulakanId, payload) {
  const {
    alasan = 'Barang rusak / tidak sesuai pesanan',
    kompensasi = 'potong_nota',
    tgl_retur,
    items = [],
  } = payload;

  const validItems = (Array.isArray(items) ? items : []).filter((it) => Number(it.jumlah_retur) > 0);
  if (validItems.length === 0) {
    throw new BadRequest('Pilih minimal 1 barang dengan jumlah retur lebih dari 0');
  }

  const { data: header, error: headErr } = await supabaseAdmin
    .from('kulakan')
    .select('*, pemasok:pemasok_id(id, nama)')
    .eq('id', kulakanId)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (headErr) throw headErr;
  if (!header) throw new NotFound('Faktur kulakan tidak ditemukan');

  const { data: details, error: detErr } = await supabaseAdmin
    .from('kulakan_detail')
    .select('*')
    .eq('kulakan_id', kulakanId);
  if (detErr) throw detErr;

  const prodIds = Array.from(new Set(validItems.map((it) => it.produk_id)));
  const { data: dbProducts, error: pErr } = await supabaseAdmin
    .from('produk')
    .select('id, nama, stok, satuan_dasar')
    .eq('toko_id', tokoId)
    .in('id', prodIds);

  if (pErr) throw pErr;
  const prodMap = new Map((dbProducts || []).map((p) => [p.id, p]));

  const { totalNilaiRetur, actions } = buildValidatedReturActions({
    validItems,
    details,
    prodMap,
    kompensasi,
  });

  const effectivePaid = await resolveEffectivePaidKulakan(tokoId, kulakanId, header);
  if ((kompensasi === 'refund_tunai' || kompensasi === 'refund_transfer') && totalNilaiRetur > effectivePaid) {
    throw new BadRequest(
      `Nilai refund (Rp${totalNilaiRetur.toLocaleString('id-ID')}) melebihi nominal yang sudah dibayar ke pemasok (Rp${effectivePaid.toLocaleString('id-ID')}). Gunakan opsi 'Potong Nota' untuk mengurangi sisa utang faktur.`
    );
  }

  const mutasiInserted = [];
  const stockBatchEntries = [];

  for (const act of actions) {
    const cleanAlasan = String(alasan || 'Barang rusak').replace(/\|/g, '/').slice(0, 70);
    const catatanMutasi = `Retur ${header.no_faktur} | Qty: ${act.qtyRetur} ${act.detRow.nama_satuan} (${act.totalPcsRetur} ${act.prod.satuan_dasar}) | Nilai: Rp${Math.round(act.nilaiBaris)} | Kompensasi: ${kompensasi} | Alasan: ${cleanAlasan}`.slice(0, 250);

    if (kompensasi !== 'tukar_barang') {
      stockBatchEntries.push({
        produk_id: act.prod.id,
        delta: -act.totalPcsRetur,
        jenis: 'retur',
        ref_id: kulakanId,
        catatan: catatanMutasi,
      });

      const sisaQtyFaktur = Math.max(0, Number(act.detRow.jumlah) - act.qtyRetur);
      await supabaseAdmin
        .from('kulakan_detail')
        .update({ jumlah: sisaQtyFaktur, subtotal: Math.round(sisaQtyFaktur * act.hargaSatuan) })
        .eq('id', act.detRow.id);
    } else {
      const stokVal = Number(act.prod.stok);
      const { data: mutRow, error: mutErr } = await supabaseAdmin
        .from('mutasi_stok')
        .insert({
          toko_id: tokoId,
          produk_id: act.prod.id,
          jenis: 'retur',
          ref_id: kulakanId,
          perubahan: 0,
          stok_sebelum: stokVal,
          stok_sesudah: stokVal,
          catatan: catatanMutasi,
        })
        .select()
        .single();
      if (mutErr) throw mutErr;
      mutasiInserted.push(mutRow);
    }
  }

  if (stockBatchEntries.length > 0) {
    await applyAggregatedStockBatch(tokoId, stockBatchEntries, { allowNegative: false });
  }

  let totalBeliBaru = Number(header.total_beli || 0);
  let statusLunasBaru = Boolean(header.lunas);

  if (kompensasi === 'potong_nota') {
    totalBeliBaru = Math.max(0, totalBeliBaru - totalNilaiRetur);
    if (effectivePaid >= totalBeliBaru) statusLunasBaru = true;
    await supabaseAdmin
      .from('kulakan')
      .update({ total_beli: totalBeliBaru, lunas: statusLunasBaru })
      .eq('id', kulakanId);
  } else if (kompensasi === 'refund_tunai' || kompensasi === 'refund_transfer') {
    totalBeliBaru = Math.max(0, totalBeliBaru - totalNilaiRetur);
    statusLunasBaru = effectivePaid - totalNilaiRetur >= totalBeliBaru;
    await supabaseAdmin
      .from('kulakan')
      .update({ total_beli: totalBeliBaru, lunas: statusLunasBaru })
      .eq('id', kulakanId);

    const metodeLabel = kompensasi === 'refund_tunai' ? 'Tunai' : 'Transfer';
    await supabaseAdmin.from('arus_kas').insert({
      toko_id: tokoId,
      tipe: 'masuk',
      kategori: 'retur_kulakan',
      nominal: totalNilaiRetur,
      tgl_kas: tgl_retur || new Date().toISOString().slice(0, 10),
      ref_id: kulakanId,
      kasir_id: userId,
      catatan: `Refund Retur Faktur ${header.no_faktur} dari ${header.pemasok?.nama || 'Pemasok'} (${metodeLabel}) - ${alasan}`,
    });
  }

  return {
    kulakan_id: kulakanId,
    no_faktur: header.no_faktur,
    kompensasi,
    total_nilai_retur: totalNilaiRetur,
    total_beli_baru: totalBeliBaru,
    lunas: statusLunasBaru,
    item_diretur: Math.max(actions.length, mutasiInserted.length),
  };
}
