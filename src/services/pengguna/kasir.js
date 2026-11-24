import crypto from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound, BadRequest, Conflict } from '../../utils/errors.js';
import { hashPinKasir } from '../auth/pin.js';
import { sendKasirInviteEmail } from '../auth/verification.js';
import { invalidateAuthCache } from '../../plugins/auth.js';
import { listKasir, getDetailKasir } from './kasir-queries.js';

  export { listKasir, getDetailKasir };

/**
 * Tambah atau Undang Akun Staf Kasir Baru
 */
export async function createKasir(tokoId, payload) {
  const {
    nama_lengkap,
    email,
    password,
    telepon = null,
    pin_kasir,
    kirim_undangan,
  } = payload || {};

  if (!nama_lengkap || !nama_lengkap.trim()) {
    throw new BadRequest('Nama lengkap kasir wajib diisi');
  }

  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new BadRequest('Email kasir valid wajib diisi');
  }

  const useInviteFlow =
    kirim_undangan === true || (kirim_undangan !== false && !password);

  if (!useInviteFlow) {
    if (!password || String(password).length < 6) {
      throw new BadRequest('Kata sandi awal minimal 6 karakter wajib diisi bila tidak mengirim undangan email');
    }
    if (!pin_kasir || !/^\d{6}$/.test(String(pin_kasir).trim())) {
      throw new BadRequest('PIN kasir wajib diisi tepat 6 digit angka');
    }
  } else if (pin_kasir && !/^\d{6}$/.test(String(pin_kasir).trim())) {
    throw new BadRequest('PIN kasir harus berupa 6 digit angka');
  }

  // 1. Cek apakah email sudah terdaftar di database pengguna
  const { data: existUser } = await supabaseAdmin
    .from('pengguna')
    .select('id')
    .eq('email', cleanEmail)
    .maybeSingle();

  if (existUser) {
    throw new Conflict(`Email '${cleanEmail}' sudah terdaftar di sistem`);
  }

  const pinHash = pin_kasir ? await hashPinKasir(pin_kasir) : null;
  const authPassword = useInviteFlow
    ? `${crypto.randomBytes(24).toString('base64url')}A1!`
    : String(password);

  // 2. Buat akun di Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: cleanEmail,
    password: authPassword,
    email_confirm: !useInviteFlow,
    user_metadata: {
      nama_lengkap: nama_lengkap.trim(),
      peran: 'kasir',
    },
  });

  if (authError) {
    throw new BadRequest(`Gagal membuat akun autentikasi: ${authError.message}`);
  }

  const authUserId = authData.user.id;

  // 3. Simpan data profil ke tabel pengguna (tanpa mengekspos pin_kasir)
  const { data: newProfile, error: profileErr } = await supabaseAdmin
    .from('pengguna')
    .insert({
      id: authUserId,
      toko_id: tokoId,
      nama_lengkap: nama_lengkap.trim(),
      email: cleanEmail,
      telepon: telepon ? telepon.trim() : null,
      peran: 'kasir',
      pin_kasir: pinHash,
      aktif: true,
    })
    .select('id, nama_lengkap, email, telepon, peran, aktif, dibuat_pada')
    .single();

  if (profileErr) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    throw profileErr;
  }

  if (useInviteFlow) {
    const { data: tokoRow } = await supabaseAdmin
      .from('toko')
      .select('nama')
      .eq('id', tokoId)
      .maybeSingle();

    try {
      await sendKasirInviteEmail({
        userId: authUserId,
        tokoId,
        email: cleanEmail,
        nama: nama_lengkap.trim(),
        namaToko: tokoRow?.nama || 'Toko Tokiva',
      });
    } catch (mailErr) {
      await Promise.resolve(supabaseAdmin.from('pengguna').delete().eq('id', authUserId)).catch(() => { });
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => { });
      throw mailErr;
    }
  }

  return {
    ...newProfile,
    undangan_terkirim: useInviteFlow,
  };
}

/**
 * Kirim Ulang Undangan Aktivasi Akun Kasir via Email Resend
 */
export async function resendKasirInvite(tokoId, kasirId) {
  const { data: kasir, error } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, email, aktif, toko:toko_id(nama)')
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .maybeSingle();

  if (error) throw error;
  if (!kasir) throw new NotFound('Data kasir tidak ditemukan');
  if (!kasir.aktif) throw new BadRequest('Akun kasir sedang nonaktif');

  await sendKasirInviteEmail({
    userId: kasir.id,
    tokoId,
    email: kasir.email,
    nama: kasir.nama_lengkap,
    namaToko: kasir.toko?.nama || 'Toko Tokiva',
  });

  return {
    id: kasir.id,
    email: kasir.email,
    message: `Tautan aktivasi kasir telah dikirim ulang ke ${kasir.email}`,
  };
}

/**
 * Perbarui Data Staf Kasir
 */
export async function updateKasir(tokoId, kasirId, payload) {
  const { data: exist } = await supabaseAdmin
    .from('pengguna')
    .select('id')
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .maybeSingle();

  if (!exist) throw new NotFound('Data kasir tidak ditemukan');

  const updateFields = {};
  if (payload.nama_lengkap !== undefined) updateFields.nama_lengkap = payload.nama_lengkap.trim();
  if (payload.telepon !== undefined) updateFields.telepon = payload.telepon ? payload.telepon.trim() : null;
  if (payload.aktif !== undefined) updateFields.aktif = Boolean(payload.aktif);

  const { data, error } = await supabaseAdmin
    .from('pengguna')
    .update(updateFields)
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .select('id, nama_lengkap, email, telepon, peran, aktif, login_terakhir')
    .single();

  if (error) throw error;
  invalidateAuthCache(kasirId);
  return data;
}

/**
 * Reset PIN 6-Digit Kasir (disimpan sebagai hash bcrypt)
 */
export async function resetPinKasir(tokoId, kasirId, { pin_baru }) {
  const pinHash = await hashPinKasir(pin_baru);

  const { data: exist } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap')
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .maybeSingle();

  if (!exist) throw new NotFound('Data kasir tidak ditemukan');

  const { data, error } = await supabaseAdmin
    .from('pengguna')
    .update({ pin_kasir: pinHash })
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .select('id, nama_lengkap')
    .single();

  if (error) throw error;

  invalidateAuthCache(kasirId);
  return {
    kasir: data,
    message: `PIN kasir '${data.nama_lengkap}' berhasil diperbarui dengan aman`,
  };
}

/**
 * Hapus / Nonaktifkan Akun Kasir
 */
export async function deleteKasir(tokoId, kasirId) {
  const { data: exist, error: findErr } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap')
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir')
    .maybeSingle();

  if (findErr) throw findErr;
  if (!exist) throw new NotFound('Data kasir tidak ditemukan');

  // Nonaktifkan profil secara atomik pada kasir toko ini
  const { error: updErr } = await supabaseAdmin
    .from('pengguna')
    .update({ aktif: false })
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .eq('peran', 'kasir');

  if (updErr) throw updErr;

  // Hapus akun dari auth.users
  const { error: delAuthErr } = await supabaseAdmin.auth.admin.deleteUser(kasirId);
  if (delAuthErr && !String(delAuthErr.message || '').toLowerCase().includes('not found')) {
    throw delAuthErr;
  }

  invalidateAuthCache(kasirId);
  return {
    id: kasirId,
    message: `Akun kasir '${exist.nama_lengkap}' berhasil dinonaktifkan dan dihapus dari autentikasi`,
  };
}
