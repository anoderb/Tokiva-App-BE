import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound } from '../../utils/errors.js';
import { bayarPiutangFifo, bayarPiutang } from './piutang-bayar.js';

export { bayarPiutangFifo, bayarPiutang };

/**
 * Daftar Tagihan Kas Bon (Piutang) Toko
 */
export async function listPiutang(tokoId, { pelanggan_id, status, limit = 50, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('piutang')
    .select(
      `
      *,
      pelanggan:pelanggan_id(id, nama, telepon, batas_bon)
    `,
      { count: 'exact' }
    )
    .eq('toko_id', tokoId);

  if (pelanggan_id) query = query.eq('pelanggan_id', pelanggan_id);
  if (status) query = query.eq('status', status);

  const { data, count, error } = await query
    .order('dibuat_pada', { ascending: false })
    .range(from, to);

  if (error) throw error;

  const txIds = (data || []).map((p) => p.transaksi_id).filter(Boolean);
  let txMap = new Map();
  if (txIds.length > 0) {
    const { data: txList } = await supabaseAdmin
      .from('transaksi')
      .select('id, no_transaksi, total, tgl_transaksi')
      .in('id', txIds);
    txMap = new Map((txList || []).map((t) => [t.id, t]));
  }

  const items = (data || []).map((p) => ({
    ...p,
    transaksi: txMap.get(p.transaksi_id) || null,
  }));

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
 * Kartu Piutang Warga (Buku Catatan Bon Perorangan)
 */
export async function getKartuPiutang(tokoId, pelangganId) {
  const { data: pelanggan, error: pelErr } = await supabaseAdmin
    .from('pelanggan')
    .select('*')
    .eq('id', pelangganId)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (pelErr) throw pelErr;
  if (!pelanggan) throw new NotFound('Pelanggan tidak ditemukan');

  const { data: daftarBon, error: bonErr } = await supabaseAdmin
    .from('piutang')
    .select(
      `
      *,
      pembayaran:piutang_bayar(id, nominal_bayar, metode, no_bukti, tgl_bayar, kasir:kasir_id(nama_lengkap))
    `
    )
    .eq('pelanggan_id', pelangganId)
    .eq('toko_id', tokoId)
    .order('dibuat_pada', { ascending: false });

  if (bonErr) throw bonErr;

  const txIds = (daftarBon || []).map((p) => p.transaksi_id).filter(Boolean);
  let txMap = new Map();
  if (txIds.length > 0) {
    const { data: txList } = await supabaseAdmin
      .from('transaksi')
      .select('id, no_transaksi, tgl_transaksi, subtotal, diskon, total')
      .in('id', txIds);
    txMap = new Map((txList || []).map((t) => [t.id, t]));
  }

  const bonWithTx = (daftarBon || []).map((p) => ({
    ...p,
    transaksi: txMap.get(p.transaksi_id) || null,
  }));

  const totalUtangAktif = Number(pelanggan.total_piutang || 0);
  const batasBon = Number(pelanggan.batas_bon || 500000);

  return {
    pelanggan,
    ringkasan: {
      batas_bon: batasBon,
      total_piutang_berjalan: totalUtangAktif,
      sisa_limit_bon: Math.max(0, batasBon - totalUtangAktif),
      status_limit: totalUtangAktif >= batasBon ? 'limit_penuh' : 'aman',
    },
    daftar_bon: bonWithTx || [],
  };
}
