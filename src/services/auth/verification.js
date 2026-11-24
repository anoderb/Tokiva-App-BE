import { supabaseAdmin } from '../../lib/supabase.js';
import { config } from '../../config/env.js';
import { BadRequest } from '../../utils/errors.js';
import { invalidateAuthCache } from '../../plugins/auth.js';
import { sendEmail } from '../email/resend.js';
import { buildResetPasswordEmail, buildVerificationEmail } from '../email/templates.js';
import {
  RESET_TTL_MINUTES,
  VERIFY_TTL_MINUTES,
  assertNotInCooldown,
  issueAuthEmailToken,
  validateAndConsumeToken,
} from './email-tokens.js';
import {
  acceptKasirInvite,
  getKasirInviteDetails,
  sendKasirInviteEmail,
} from './kasir-invite.js';

export { sendKasirInviteEmail, getKasirInviteDetails, acceptKasirInvite };

/**
 * Kirim Email Verifikasi Pendaftaran Toko / Owner
 */
export async function sendVerificationEmail({ userId, tokoId = null, email, nama, namaToko }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const { tokenId, rawToken, rawOtp } = await issueAuthEmailToken({
    userId,
    tokoId,
    email: cleanEmail,
    purpose: 'verify_email',
    ttlMs: VERIFY_TTL_MINUTES * 60_000,
    withOtp: true,
  });

  const verifyUrl = `${config.email.appUrl}/auth/verify-email?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(cleanEmail)}`;
  const emailContent = buildVerificationEmail({
    nama,
    namaToko,
    verifyUrl,
    otp: rawOtp,
    expiresMinutes: VERIFY_TTL_MINUTES,
  });

  try {
    await sendEmail({ to: cleanEmail, ...emailContent });
  } catch (err) {
    await Promise.resolve(supabaseAdmin.from('auth_email_tokens').delete().eq('id', tokenId)).catch(() => {});
    throw err;
  }

  return { sent: true, email: cleanEmail, expires_in_minutes: VERIFY_TTL_MINUTES };
}

/**
 * Verifikasi Email dengan Token Tautan atau OTP 6-Digit
 */
export async function verifyEmailAddress({ token, email, otp }) {
  const claimed = await validateAndConsumeToken({ purpose: 'verify_email', token, email, otp });

  const { error: confirmErr } = await supabaseAdmin.auth.admin.updateUserById(claimed.user_id, {
    email_confirm: true,
  });
  if (confirmErr) throw new BadRequest(`Gagal mengaktifkan verifikasi email: ${confirmErr.message}`);

  invalidateAuthCache(claimed.user_id);
  return { verified: true, email: claimed.email };
}

/**
 * Kirim Ulang Email Verifikasi dengan Cooldown 60 Detik
 */
export async function resendVerificationEmail({ email }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new BadRequest('Alamat email valid wajib diisi');
  }

  await assertNotInCooldown(cleanEmail, 'verify_email');

  const { data: userRow, error: uErr } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, email, toko_id, aktif, toko:toko_id(nama)')
    .eq('email', cleanEmail)
    .maybeSingle();

  if (uErr) throw uErr;

  if (!userRow || !userRow.aktif) {
    return {
      sent: true,
      cooldown_seconds: 60,
      message: 'Jika email terdaftar dan belum diverifikasi, kode baru telah dikirim.',
    };
  }

  const { data: authLookup } = await supabaseAdmin.auth.admin.getUserById(userRow.id);
  if (authLookup?.user?.email_confirmed_at) {
    return {
      sent: true,
      already_verified: true,
      cooldown_seconds: 60,
      message: 'Email akun Anda sudah terverifikasi. Silakan langsung masuk.',
    };
  }

  await sendVerificationEmail({
    userId: userRow.id,
    tokoId: userRow.toko_id,
    email: cleanEmail,
    nama: userRow.nama_lengkap,
    namaToko: userRow.toko?.nama || 'Toko Anda',
  });

  return {
    sent: true,
    cooldown_seconds: 60,
    message: 'Tautan dan kode OTP verifikasi baru telah dikirim ke email Anda.',
  };
}

/**
 * Kirim Email Reset Kata Sandi (Anti-Enumerasi)
 */
export async function requestPasswordReset({ email }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new BadRequest('Alamat email valid wajib diisi');
  }

  await assertNotInCooldown(cleanEmail, 'reset_password');

  const { data: userRow, error: uErr } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, email, toko_id, aktif')
    .eq('email', cleanEmail)
    .maybeSingle();

  if (uErr) throw uErr;

  if (userRow && userRow.aktif) {
    const { tokenId, rawToken, rawOtp } = await issueAuthEmailToken({
      userId: userRow.id,
      tokoId: userRow.toko_id,
      email: cleanEmail,
      purpose: 'reset_password',
      ttlMs: RESET_TTL_MINUTES * 60_000,
      withOtp: true,
    });

    const resetUrl = `${config.email.appUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(cleanEmail)}`;
    const emailContent = buildResetPasswordEmail({
      nama: userRow.nama_lengkap,
      resetUrl,
      otp: rawOtp,
      expiresMinutes: RESET_TTL_MINUTES,
    });

    try {
      await sendEmail({ to: cleanEmail, ...emailContent });
    } catch (err) {
      await Promise.resolve(supabaseAdmin.from('auth_email_tokens').delete().eq('id', tokenId)).catch(() => {});
      throw err;
    }
  }

  return {
    sent: true,
    cooldown_seconds: 60,
    message: 'Jika email terdaftar dan aktif, instruksi reset kata sandi telah dikirim ke inbox Anda.',
  };
}

/**
 * Eksekusi Reset Kata Sandi dengan Token atau OTP Email
 */
export async function resetPasswordWithToken({ token, email, otp, password_baru }) {
  if (!password_baru || String(password_baru).length < 6) {
    throw new BadRequest('Kata sandi baru minimal 6 karakter');
  }

  const claimed = await validateAndConsumeToken({ purpose: 'reset_password', token, email, otp });

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(claimed.user_id, {
    password: String(password_baru),
    email_confirm: true,
  });
  if (updErr) throw new BadRequest(`Gagal mengatur ulang kata sandi: ${updErr.message}`);

  invalidateAuthCache(claimed.user_id);
  return { reset: true, email: claimed.email };
}
