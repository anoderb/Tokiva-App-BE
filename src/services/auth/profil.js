import { supabaseAdmin, supabaseAuth } from '../../lib/supabase.js';
import { BadRequest, NotFound, Unauthorized } from '../../utils/errors.js';
import { invalidateAuthCache } from '../../plugins/auth.js';
import { createTokoDanOwner } from '../admin/platform.js';
import { sendVerificationEmail } from './verification.js';

function sanitizeUserProfile(profile) {
  if (!profile) return { user: null, toko: null };
  const { toko, pin_kasir: _omitPin, ...userData } = profile;
  return {
    user: userData,
    toko: toko || null,
  };
}

/**
 * Logika Bisnis: Ambil Profil Pengguna & Toko
 */
export async function getProfil(userId) {
  const { data: userProfile, error } = await supabaseAdmin
    .from('pengguna')
    .select('*, toko:toko_id(*)')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!userProfile) {
    throw new NotFound('Profil pengguna tidak ditemukan');
  }

  return sanitizeUserProfile(userProfile);
}

/**
 * Logika Bisnis: Perbarui Profil Pengguna Aktif
 */
export async function updateProfil(userId, payload) {
  const { nama_lengkap, telepon, foto_url } = payload || {};
  const updates = {};
  if (nama_lengkap !== undefined) updates.nama_lengkap = String(nama_lengkap).trim();
  if (telepon !== undefined) updates.telepon = telepon ? String(telepon).trim() : null;
  if (foto_url !== undefined) updates.avatar_url = foto_url || null;

  if (Object.keys(updates).length === 0) {
    throw new BadRequest('Tidak ada data profil yang diubah');
  }

  const { data: updated, error } = await supabaseAdmin
    .from('pengguna')
    .update(updates)
    .eq('id', userId)
    .select('*, toko:toko_id(*)')
    .single();

  if (error) throw error;

  invalidateAuthCache(userId);
  return sanitizeUserProfile(updated);
}

/**
 * Logika Bisnis: Ganti Password Pengguna Aktif (wajib verifikasi kata sandi lama untuk semua peran)
 */
export async function updatePassword(userId, { password_lama, password_baru }) {
  if (!password_baru || String(password_baru).length < 6) {
    throw new BadRequest('Password baru minimal 6 karakter');
  }
  if (!password_lama || !String(password_lama).trim()) {
    throw new BadRequest('Kata sandi saat ini wajib diisi untuk verifikasi');
  }

  const { data: userRow, error: uErr } = await supabaseAdmin
    .from('pengguna')
    .select('email, peran')
    .eq('id', userId)
    .maybeSingle();

  if (uErr) throw uErr;
  if (!userRow) throw new NotFound('Akun pengguna tidak ditemukan');

  const { error: verifyErr } = await supabaseAuth.auth.signInWithPassword({
    email: userRow.email,
    password: String(password_lama),
  });
  if (verifyErr) {
    throw new Unauthorized('Kata sandi saat ini tidak sesuai');
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: String(password_baru),
  });

  if (error) {
    throw new BadRequest(`Gagal mengubah password: ${error.message}`);
  }

  invalidateAuthCache(userId);
  return { updated: true };
}

/**
 * Logika Bisnis: Registrasi Mandiri Toko & Akun Owner Baru (dengan verifikasi email Resend)
 */
export async function registerOwner(payload) {
  const {
    nama_toko,
    telepon,
    alamat,
    kota,
    nama_owner,
    email,
    password,
    pin_kasir,
  } = payload || {};

  const created = await createTokoDanOwner({
    nama_toko,
    telepon,
    alamat,
    kota,
    nama_owner,
    email_owner: email,
    password_owner: password,
    pin_kasir,
    require_email_verification: true,
  });

  try {
    await sendVerificationEmail({
      userId: created.owner.id,
      tokoId: created.toko.id,
      email: created.owner.email,
      nama: created.owner.nama_lengkap,
      namaToko: created.toko.nama,
    });
  } catch (mailErr) {
    // Rollback akun dan toko bila email verifikasi gagal dikirim agar user bisa mencoba lagi tanpa email terblokir
    await supabaseAdmin.auth.admin.deleteUser(created.owner.id).catch(() => {});
    await Promise.resolve(supabaseAdmin.from('toko').delete().eq('id', created.toko.id)).catch(() => {});
    throw mailErr;
  }

  return {
    requires_verification: true,
    email: created.owner.email,
    toko: created.toko,
    owner: created.owner,
  };
}
