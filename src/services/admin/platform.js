import { supabaseAdmin } from '../../lib/supabase.js';
import { invalidateAuthCache, invalidateTokoAuthCache } from '../../plugins/auth.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../utils/errors.js';
import { sanitizeSearchTerm } from '../../utils/postgrest.js';
import { hashPinKasir } from '../auth/pin.js';

export { getDashboardAdmin, listTokoPlatform, getDetailTokoPlatform } from './platform-analytics.js';

/**
 * Onboarding Tenant Toko Baru + Akun Owner Sekaligus
 */
export async function createTokoDanOwner(payload) {
  const {
    nama_toko,
    kode_toko,
    telepon,
    alamat,
    kota,
    nama_owner,
    email_owner,
    password_owner,
    pin_kasir,
    require_email_verification = false,
  } = payload;

  if (!nama_toko || !email_owner || !nama_owner) {
    throw new BadRequest('Nama toko, nama owner, dan email owner wajib diisi');
  }

  if (!password_owner || String(password_owner).length < 6) {
    throw new BadRequest('Password awal owner minimal 6 karakter wajib diisi');
  }

  const pinHash = pin_kasir ? await hashPinKasir(pin_kasir) : null;
  const cleanEmail = String(email_owner).trim().toLowerCase();
  const kode = (kode_toko || `TKV-${Date.now().toString().slice(-6)}`).trim().toUpperCase();

  const [{ data: existEmail }, { data: existKode }] = await Promise.all([
    supabaseAdmin.from('pengguna').select('id').eq('email', cleanEmail).maybeSingle(),
    supabaseAdmin.from('toko').select('id').eq('kode', kode).maybeSingle(),
  ]);

  if (existEmail) throw new Conflict(`Email '${cleanEmail}' sudah terdaftar`);
  if (existKode) throw new Conflict(`Kode toko '${kode}' sudah digunakan`);

  const { data: newToko, error: tokoErr } = await supabaseAdmin
    .from('toko')
    .insert({
      kode,
      nama: nama_toko.trim(),
      pemilik: nama_owner.trim(),
      telepon: telepon || '-',
      alamat: alamat || '-',
      kota: kota || '-',
      status: 'aktif',
    })
    .select()
    .single();

  if (tokoErr) throw tokoErr;

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: cleanEmail,
    password: String(password_owner),
    email_confirm: !require_email_verification,
    user_metadata: { nama_lengkap: nama_owner.trim(), peran: 'owner' },
  });

  if (authErr) {
    await supabaseAdmin.from('toko').delete().eq('id', newToko.id);
    throw new BadRequest(`Gagal membuat akun owner: ${authErr.message}`);
  }

  const { data: newOwner, error: profErr } = await supabaseAdmin
    .from('pengguna')
    .insert({
      id: authData.user.id,
      toko_id: newToko.id,
      nama_lengkap: nama_owner.trim(),
      email: cleanEmail,
      telepon: telepon || null,
      peran: 'owner',
      pin_kasir: pinHash,
      aktif: true,
    })
    .select('id, nama_lengkap, email, peran, toko_id, aktif')
    .single();

  if (profErr) {
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    await supabaseAdmin.from('toko').delete().eq('id', newToko.id);
    throw profErr;
  }

  return { toko: newToko, owner: newOwner };
}

/**
 * Ubah Status Toko Tenant (Aktif / Nonaktif / Ditangguhkan)
 */
export async function updateStatusToko(tokoId, status) {
  if (!['aktif', 'nonaktif', 'ditangguhkan'].includes(status)) {
    throw new BadRequest("Status toko harus 'aktif', 'nonaktif', atau 'ditangguhkan'");
  }

  const { data, error } = await supabaseAdmin
    .from('toko')
    .update({ status, diubah_pada: new Date().toISOString() })
    .eq('id', tokoId)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Toko tidak ditemukan');

  invalidateTokoAuthCache(tokoId);
  return data;
}

/**
 * Daftar Seluruh Pengguna Lintas Toko di Platform (Admin Audit)
 */
export async function listPenggunaPlatform({ search, peran, toko_id, aktif, limit = 50, page = 1 }) {
  const cleanPage = Math.max(1, Number(page) || 1);
  const cleanLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const from = (cleanPage - 1) * cleanLimit;
  const to = from + cleanLimit - 1;

  let query = supabaseAdmin
    .from('pengguna')
    .select(`
      id, nama_lengkap, email, telepon, peran, aktif, login_terakhir, dibuat_pada,
      toko:toko_id(id, kode, nama)
    `, { count: 'exact' });

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(
      `nama_lengkap.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,telepon.ilike.%${cleanSearch}%`
    );
  }
  if (peran) query = query.eq('peran', peran);
  if (toko_id) query = query.eq('toko_id', toko_id);
  if (aktif !== undefined && aktif !== null && aktif !== '') {
    query = query.eq('aktif', aktif === 'true' || aktif === true);
  }

  const { data, count, error } = await query
    .order('dibuat_pada', { ascending: false })
    .range(from, to);

  if (error) throw error;

  const total = count || 0;
  return {
    items: data || [],
    pagination: {
      total,
      page: cleanPage,
      limit: cleanLimit,
      total_pages: Math.max(1, Math.ceil(total / cleanLimit)),
    },
  };
}

/**
 * Aktifkan / Nonaktifkan Pengguna Lintas Platform
 */
export async function updateStatusPenggunaPlatform(userId, aktif, actorId = null) {
  const { data: target, error: findErr } = await supabaseAdmin
    .from('pengguna')
    .select('id, peran')
    .eq('id', userId)
    .maybeSingle();

  if (findErr) throw findErr;
  if (!target) throw new NotFound('Pengguna tidak ditemukan');
  if (actorId && target.id === actorId) {
    throw new BadRequest('Anda tidak dapat menonaktifkan akun Anda sendiri');
  }
  if (target.peran === 'superadmin') {
    throw new Forbidden('Status akun Superadmin tidak dapat diubah');
  }

  const { data, error } = await supabaseAdmin
    .from('pengguna')
    .update({ aktif: Boolean(aktif) })
    .eq('id', userId)
    .select('id, nama_lengkap, email, peran, aktif')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFound('Pengguna tidak ditemukan');

  invalidateAuthCache(userId);
  return data;
}
