import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';

/**
 * Daftar Seluruh Staf Kasir Toko
 */
export async function listKasir(tokoId, { search, aktif, limit = 50, page = 1 }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, email, telepon, peran, avatar_url, aktif, login_terakhir, dibuat_pada', { count: 'exact' })
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir');

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(`nama_lengkap.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,telepon.ilike.%${cleanSearch}%`);
  }
  if (aktif !== undefined && aktif !== null && aktif !== '') {
    query = query.eq('aktif', aktif === 'true' || aktif === true);
  }

  const { data, count, error } = await query.order('dibuat_pada', { ascending: false }).range(from, to);
  if (error) throw error;

  return {
    items: data || [],
    pagination: {
      total: count || 0,
      page: Number(page),
      limit: Number(limit),
      total_pages: Math.ceil((count || 0) / limit),
    },
  };
}

/**
 * Detail Profil Staf Kasir & Statistik Kinerja
 */
export async function getDetailKasir(tokoId, kasirId) {
  const { data: kasir, error: kErr } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, email, telepon, peran, avatar_url, aktif, login_terakhir, dibuat_pada')
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .maybeSingle();

  if (kErr) throw kErr;
  if (!kasir) throw new NotFound('Data kasir tidak ditemukan');

  const { count: totalShift } = await supabaseAdmin
    .from('shift_kasir')
    .select('id', { count: 'exact', head: true })
    .eq('kasir_id', kasirId);

  const { data: txSummary } = await supabaseAdmin
    .from('transaksi')
    .select('total')
    .eq('kasir_id', kasirId)
    .eq('status', 'selesai');

  const totalTransaksi = (txSummary || []).length;
  const totalOmzet = (txSummary || []).reduce((acc, curr) => acc + Number(curr.total || 0), 0);

  return {
    ...kasir,
    statistik: {
      total_shift: totalShift || 0,
      total_transaksi: totalTransaksi,
      total_omzet: totalOmzet,
    },
  };
}
