import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';

function applyPelangganFilters(query, tokoId, { search, is_member }) {
  let filtered = query.eq('toko_id', tokoId);

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    filtered = filtered.or(`nama.ilike.%${cleanSearch}%,telepon.ilike.%${cleanSearch}%`);
  }

  if (is_member !== undefined && is_member !== null && is_member !== '') {
    filtered = filtered.eq('is_member', is_member === 'true' || is_member === true);
  }

  return filtered;
}

/**
 * Daftar Pelanggan Toko (Warga Sekitar / Langganan)
 */
export async function listPelanggan(tokoId, { search, is_member, limit = 50, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const filters = { search, is_member };

  const dataQuery = applyPelangganFilters(
    supabaseAdmin.from('pelanggan').select('*', { count: 'exact' }),
    tokoId,
    filters
  );
  const summaryQuery = applyPelangganFilters(
    supabaseAdmin.from('pelanggan').select('total_piutang'),
    tokoId,
    filters
  );

  const [{ data, count, error }, { data: summaryRows, error: summaryErr }] = await Promise.all([
    dataQuery.order('nama', { ascending: true }).range(from, to),
    summaryQuery.range(0, 9999),
  ]);

  if (error) {
    throw error;
  }
  if (summaryErr) {
    throw summaryErr;
  }

  let pelangganBerutang = 0;
  let totalPiutangAktif = 0;
  for (const row of summaryRows || []) {
    const piutang = Number(row.total_piutang || 0);
    if (piutang > 0) {
      pelangganBerutang += 1;
      totalPiutangAktif += piutang;
    }
  }

  return {
    items: data || [],
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
    ringkasan: {
      total_pelanggan: count || 0,
      pelanggan_berutang: pelangganBerutang,
      total_piutang_aktif: totalPiutangAktif,
    },
  };
}

/**
 * Detail 1 Pelanggan & Ringkasan Utang Kas Bon
 */
export async function getDetailPelanggan(tokoId, id) {
  const { data: pelanggan, error } = await supabaseAdmin
    .from('pelanggan')
    .select('*')
    .eq('id', id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!pelanggan) {
    throw new NotFound('Data pelanggan tidak ditemukan');
  }

  // Ambil daftar bon aktif (belum lunas)
  const { data: bonList } = await supabaseAdmin
    .from('piutang')
    .select('*')
    .eq('toko_id', tokoId)
    .eq('pelanggan_id', id)
    .eq('status', 'belum_lunas')
    .order('dibuat_pada', { ascending: false });

  const txIds = (bonList || []).map(b => b.transaksi_id).filter(Boolean);
  let txMap = new Map();
  if (txIds.length > 0) {
    const { data: txList } = await supabaseAdmin
      .from('transaksi')
      .select('id, no_transaksi, tgl_transaksi, total')
      .in('id', txIds);
    txMap = new Map((txList || []).map(t => [t.id, t]));
  }

  const bonWithTx = (bonList || []).map(b => ({
    ...b,
    transaksi: txMap.get(b.transaksi_id) || null,
  }));

  return {
    ...pelanggan,
    bon_aktif: bonWithTx,
  };
}

/**
 * Tambah Data Pelanggan Baru
 */
export async function createPelanggan(tokoId, payload) {
  const {
    nama,
    telepon = null,
    alamat = null,
    is_member = false,
    batas_bon = 500000,
  } = payload;

  if (!nama || !nama.trim()) {
    throw new BadRequest('Nama pelanggan wajib diisi');
  }

  const { data, error } = await supabaseAdmin
    .from('pelanggan')
    .insert({
      toko_id: tokoId,
      nama: nama.trim(),
      telepon: telepon ? telepon.trim() : null,
      alamat: alamat ? alamat.trim() : null,
      is_member: Boolean(is_member),
      batas_bon: Number(batas_bon) || 500000,
      total_piutang: 0,
      poin: 0,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Perbarui Data Pelanggan
 */
export async function updatePelanggan(tokoId, id, payload) {
  const { data: exist } = await supabaseAdmin
    .from('pelanggan')
    .select('id')
    .eq('id', id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (!exist) {
    throw new NotFound('Data pelanggan tidak ditemukan');
  }

  const updateFields = {};
  if (payload.nama !== undefined) updateFields.nama = payload.nama.trim();
  if (payload.telepon !== undefined) updateFields.telepon = payload.telepon ? payload.telepon.trim() : null;
  if (payload.alamat !== undefined) updateFields.alamat = payload.alamat ? payload.alamat.trim() : null;
  if (payload.is_member !== undefined) updateFields.is_member = Boolean(payload.is_member);
  if (payload.batas_bon !== undefined) updateFields.batas_bon = Number(payload.batas_bon);
  if (payload.poin !== undefined) updateFields.poin = Number(payload.poin);

  const { data, error } = await supabaseAdmin
    .from('pelanggan')
    .update(updateFields)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Hapus Pelanggan
 */
export async function deletePelanggan(tokoId, id) {
  const { data: exist } = await supabaseAdmin
    .from('pelanggan')
    .select('id, nama, total_piutang')
    .eq('id', id)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (!exist) {
    throw new NotFound('Data pelanggan tidak ditemukan');
  }

  if (Number(exist.total_piutang || 0) > 0) {
    throw new BadRequest(`Pelanggan '${exist.nama}' masih memiliki sisa kas bon sebesar Rp${Number(exist.total_piutang).toLocaleString('id-ID')}. Selesaikan bon terlebih dahulu.`);
  }

  const { error } = await supabaseAdmin
    .from('pelanggan')
    .delete()
    .eq('id', id);

  if (error) {
    throw error;
  }

  return { id, message: 'Pelanggan berhasil dihapus' };
}
