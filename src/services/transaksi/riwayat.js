import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';

function formatTxRow(row) {
  if (!row) return null;
  return {
    ...row,
    nomor_faktur: row.no_transaksi,
    dibuat_pada: row.tgl_transaksi,
    bayar_tunai: row.uang_diterima,
    bayar_qris: row.split_qris || (row.metode_bayar === 'qris' ? row.total : 0),
  };
}

function applyRiwayatFilters(query, tokoId, filters) {
  const {
    kasir_id,
    metode_bayar,
    tanggal,
    tanggal_mulai,
    tanggal_akhir,
    status,
    shift_id,
    search,
  } = filters;

  let filtered = query.eq('toko_id', tokoId);

  if (kasir_id) {
    filtered = filtered.eq('kasir_id', kasir_id);
  }
  if (shift_id) {
    filtered = filtered.eq('shift_id', shift_id);
  }
  if (status) {
    filtered = filtered.eq('status', status);
  }
  if (metode_bayar) {
    filtered = filtered.eq('metode_bayar', metode_bayar);
  }

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    filtered = filtered.or(`no_transaksi.ilike.%${cleanSearch}%`);
  }

  if (tanggal_mulai) {
    filtered = filtered.gte('tgl_transaksi', `${tanggal_mulai}T00:00:00+07:00`);
  }
  if (tanggal_akhir) {
    filtered = filtered.lte('tgl_transaksi', `${tanggal_akhir}T23:59:59+07:00`);
  }
  if (tanggal) {
    filtered = filtered
      .gte('tgl_transaksi', `${tanggal}T00:00:00+07:00`)
      .lte('tgl_transaksi', `${tanggal}T23:59:59+07:00`);
  }

  return filtered;
}

/**
 * Riwayat Transaksi Toko
 */
export async function getRiwayatTransaksi(tokoId, queryParams = {}) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko tidak tersedia pada sesi ini');
  }

  const {
    limit = 50,
    page = 1,
  } = queryParams;

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const dataQuery = applyRiwayatFilters(
    supabaseAdmin
      .from('transaksi')
      .select(`
        *,
        kasir:kasir_id(id, nama_lengkap),
        pelanggan:pelanggan_id(id, nama, telepon)
      `, { count: 'exact' }),
    tokoId,
    queryParams
  );

  const summaryQuery = applyRiwayatFilters(
    supabaseAdmin
      .from('transaksi')
      .select('status, total, laba_kotor'),
    tokoId,
    queryParams
  );

  const [{ data, count, error }, { data: summaryRows, error: summaryErr }] = await Promise.all([
    dataQuery.order('tgl_transaksi', { ascending: false }).range(from, to),
    summaryQuery.range(0, 9999),
  ]);

  if (error) {
    throw error;
  }
  if (summaryErr) {
    throw summaryErr;
  }

  let totalSelesai = 0;
  let totalBatal = 0;
  let totalOmzet = 0;
  let totalLabaKotor = 0;
  for (const row of summaryRows || []) {
    if (row.status === 'selesai') {
      totalSelesai += 1;
      totalOmzet += Number(row.total || 0);
      totalLabaKotor += Number(row.laba_kotor || 0);
    } else if (row.status === 'batal') {
      totalBatal += 1;
    }
  }

  const formattedItems = (data || []).map(formatTxRow);

  return {
    items: formattedItems,
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
    ringkasan: {
      total_faktur: count || 0,
      total_selesai: totalSelesai,
      total_batal: totalBatal,
      total_omzet: totalOmzet,
      total_laba_kotor: totalLabaKotor,
    },
  };
}

/**
 * Detail Transaksi Lengkap (Read-only tanpa mutasi DB)
 */
export async function getDetailTransaksi(tokoId, transaksiId, kasirIdGuard = null) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko tidak tersedia pada sesi ini');
  }

  let txQuery = supabaseAdmin
    .from('transaksi')
    .select(`
      *,
      toko:toko_id(nama, alamat, telepon, kota, struk_header, struk_footer, lebar_kertas),
      kasir:kasir_id(id, nama_lengkap),
      pelanggan:pelanggan_id(id, nama, telepon)
    `)
    .eq('id', transaksiId)
    .eq('toko_id', tokoId);

  if (kasirIdGuard) {
    txQuery = txQuery.eq('kasir_id', kasirIdGuard);
  }

  const { data: tx, error: txErr } = await txQuery.maybeSingle();

  if (txErr) {
    throw txErr;
  }

  if (!tx) {
    throw new NotFound('Transaksi tidak ditemukan');
  }

  const { data: detail, error: detailErr } = await supabaseAdmin
    .from('transaksi_detail')
    .select('*')
    .eq('transaksi_id', transaksiId);

  if (detailErr) {
    throw detailErr;
  }

  const formattedHeader = formatTxRow(tx);

  return {
    ...formattedHeader,
    items: detail || [],
    transaksi_item: detail || [],
  };
}

/**
 * Catat Cetak Ulang Struk secara Eksplisit (POST /transaksi/:id/cetak)
 */
export async function incrementCetakStruk(tokoId, transaksiId, kasirIdGuard = null) {
  if (!tokoId) {
    throw new BadRequest('Konteks toko tidak tersedia pada sesi ini');
  }

  let txQuery = supabaseAdmin
    .from('transaksi')
    .select('id, cetak_ke')
    .eq('id', transaksiId)
    .eq('toko_id', tokoId);

  if (kasirIdGuard) {
    txQuery = txQuery.eq('kasir_id', kasirIdGuard);
  }

  const { data: tx, error: findErr } = await txQuery.maybeSingle();
  if (findErr) throw findErr;
  if (!tx) throw new NotFound('Transaksi tidak ditemukan');

  const nextCount = Number(tx.cetak_ke || 0) + 1;
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('transaksi')
    .update({ cetak_ke: nextCount })
    .eq('id', transaksiId)
    .eq('toko_id', tokoId)
    .select('id, no_transaksi, cetak_ke')
    .single();

  if (updErr) throw updErr;
  return updated;
}
