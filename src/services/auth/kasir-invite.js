import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase.js';
import { config } from '../../config/env.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { invalidateAuthCache } from '../../plugins/auth.js';
import { sendEmail } from '../email/resend.js';
import { buildKasirInviteEmail } from '../email/templates.js';
import { loginUser } from './login.js';
import {
  INVITE_TTL_HOURS,
  findActiveTokenRow,
  issueAuthEmailToken,
  validateAndConsumeToken,
} from './email-tokens.js';

/**
 * Kirim Undangan Aktivasi Akun Kasir via Email Resend
 */
export async function sendKasirInviteEmail({ userId, tokoId, email, nama, namaToko }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const { tokenId, rawToken } = await issueAuthEmailToken({
    userId,
    tokoId,
    email: cleanEmail,
    purpose: 'invite_kasir',
    ttlMs: INVITE_TTL_HOURS * 3600_000,
    withOtp: false,
  });

  const inviteUrl = `${config.email.appUrl}/auth/invite?token=${encodeURIComponent(rawToken)}`;
  const emailContent = buildKasirInviteEmail({
    nama,
    namaToko,
    inviteUrl,
    expiresHours: INVITE_TTL_HOURS,
  });

  try {
    await sendEmail({ to: cleanEmail, ...emailContent });
  } catch (err) {
    await Promise.resolve(supabaseAdmin.from('auth_email_tokens').delete().eq('id', tokenId)).catch(() => {});
    throw err;
  }

  return { invited: true, email: cleanEmail, expires_in_hours: INVITE_TTL_HOURS };
}

/**
 * Validasi Read-Only Token Undangan Kasir (Anti-Spoofing URL Query)
 */
export async function getKasirInviteDetails(token) {
  if (!token || !String(token).trim()) {
    throw new BadRequest('Token undangan tidak ditemukan');
  }

  const row = await findActiveTokenRow({ purpose: 'invite_kasir', token });
  if (!row) {
    throw new NotFound('Undangan kasir tidak valid atau sudah digunakan');
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new BadRequest('Tautan undangan kasir telah kedaluwarsa. Hubungi pemilik toko untuk mengirim ulang.');
  }

  const { data: userRow } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, email, toko:toko_id(id, nama)')
    .eq('id', row.user_id)
    .maybeSingle();

  return {
    valid: true,
    email: userRow?.email || row.email,
    nama_lengkap: userRow?.nama_lengkap || 'Kasir',
    nama_toko: userRow?.toko?.nama || 'Toko Tokiva',
    expires_at: row.expires_at,
  };
}

/**
 * Terima Undangan Kasir: Set Password + PIN Pribadi lalu Aktivasi & Login
 */
export async function acceptKasirInvite({ token, password, pin_kasir }) {
  if (!password || String(password).length < 6) {
    throw new BadRequest('Kata sandi baru minimal 6 karakter');
  }
  const cleanPin = String(pin_kasir || '').trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    throw new BadRequest('PIN otorisasi kasir harus terdiri dari 6 digit angka');
  }

  const claimed = await validateAndConsumeToken({ purpose: 'invite_kasir', token });
  const pinHash = await bcrypt.hash(cleanPin, 10);

  const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(claimed.user_id, {
    password: String(password),
    email_confirm: true,
  });
  if (authErr) throw new BadRequest(`Gagal mengaktifkan akun kasir: ${authErr.message}`);

  const { error: profErr } = await supabaseAdmin
    .from('pengguna')
    .update({ pin_kasir: pinHash, aktif: true })
    .eq('id', claimed.user_id);
  if (profErr) throw profErr;

  invalidateAuthCache(claimed.user_id);
  return loginUser({ email: claimed.email, password: String(password) });
}
