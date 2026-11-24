import crypto from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';
import { AppError, BadRequest } from '../../utils/errors.js';

export const COOLDOWN_MS = 60_000;
export const MAX_OTP_ATTEMPTS = 5;
export const VERIFY_TTL_MINUTES = 30;
export const RESET_TTL_MINUTES = 15;
export const INVITE_TTL_HOURS = 24;

export function hashSecret(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function timingSafeHexEqual(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hexA, 'hex'), Buffer.from(hexB, 'hex'));
}

export function generateTokenAndOtp(withOtp = true) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const rawOtp = withOtp ? String(crypto.randomInt(100_000, 1_000_000)) : null;
  return {
    rawToken,
    rawOtp,
    tokenHash: hashSecret(rawToken),
    otpHash: rawOtp ? hashSecret(rawOtp) : null,
  };
}

/** Memastikan permintaan pengiriman email tidak melanggar batas jeda cooldown. */
export async function assertNotInCooldown(cleanEmail, purpose) {
  const cutoffIso = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: recent, error } = await supabaseAdmin
    .from('auth_email_tokens')
    .select('id, dibuat_pada')
    .eq('email', cleanEmail)
    .eq('purpose', purpose)
    .gte('dibuat_pada', cutoffIso)
    .order('dibuat_pada', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01' || error.message?.includes('auth_email_tokens')) {
      throw new AppError(
        'Tabel auth_email_tokens belum dibuat di database Supabase. Jalankan migrasi SQL terlebih dahulu.',
        500
      );
    }
    throw error;
  }

  if (recent) {
    const elapsedSec = Math.floor((Date.now() - new Date(recent.dibuat_pada).getTime()) / 1000);
    const waitSec = Math.max(1, 60 - elapsedSec);
    throw new AppError(`Mohon tunggu ${waitSec} detik sebelum mengirim ulang email.`, 429);
  }
}

/** Menerbitkan token verifikasi/OTP baru dan menonaktifkan token aktif sebelumnya. */
export async function issueAuthEmailToken({ userId, tokoId = null, email, purpose, ttlMs, withOtp = true }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const { rawToken, rawOtp, tokenHash, otpHash } = generateTokenAndOtp(withOtp);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  await supabaseAdmin
    .from('auth_email_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .is('used_at', null);

  const { data: inserted, error } = await supabaseAdmin
    .from('auth_email_tokens')
    .insert({
      user_id: userId,
      toko_id: tokoId || null,
      email: cleanEmail,
      purpose,
      token_hash: tokenHash,
      otp_hash: otpHash,
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single();

  if (error) throw error;

  return { tokenId: inserted.id, rawToken, rawOtp, expiresAt: inserted.expires_at };
}

/** Mencari baris token aktif berdasarkan secret token atau email+OTP terbaru. */
export async function findActiveTokenRow({ purpose, token, email, otp }) {
  let query = supabaseAdmin
    .from('auth_email_tokens')
    .select('*')
    .eq('purpose', purpose)
    .is('used_at', null);

  if (token) {
    query = query.eq('token_hash', hashSecret(String(token).trim()));
  } else if (email && otp) {
    query = query.eq('email', String(email).trim().toLowerCase()).order('dibuat_pada', { ascending: false }).limit(1);
  } else {
    throw new BadRequest('Token verifikasi atau pasangan email & kode OTP wajib diisi');
  }

  const { data: row, error } = await query.maybeSingle();
  if (error) throw error;
  return row;
}

/** Memvalidasi masa berlaku, batas percobaan OTP, serta mengklaim token secara atomik. */
export async function validateAndConsumeToken({ purpose, token, email, otp }) {
  const row = await findActiveTokenRow({ purpose, token, email, otp });
  if (!row) {
    throw new BadRequest('Token atau kode verifikasi tidak valid atau sudah digunakan');
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await supabaseAdmin.from('auth_email_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id);
    throw new BadRequest('Token atau kode verifikasi telah kedaluwarsa. Silakan kirim ulang.');
  }

  if (Number(row.attempt_count || 0) >= MAX_OTP_ATTEMPTS) {
    throw new BadRequest('Terlalu banyak percobaan kode yang salah. Silakan minta kode baru.');
  }

  if (!token && otp) {
    const providedOtpHash = hashSecret(String(otp).trim());
    if (!timingSafeHexEqual(row.otp_hash, providedOtpHash)) {
      const nextAttempts = Number(row.attempt_count || 0) + 1;
      const attemptUpdate = { attempt_count: nextAttempts };
      if (nextAttempts >= MAX_OTP_ATTEMPTS) attemptUpdate.used_at = new Date().toISOString();
      await supabaseAdmin.from('auth_email_tokens').update(attemptUpdate).eq('id', row.id);
      throw new BadRequest('Kode OTP verifikasi tidak cocok');
    }
  }

  const usedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from('auth_email_tokens')
    .update({ used_at: usedAt })
    .eq('id', row.id)
    .is('used_at', null)
    .select('*')
    .maybeSingle();

  if (claimErr) throw claimErr;
  if (!claimed) {
    throw new BadRequest('Token verifikasi sudah digunakan sebelumnya');
  }

  return claimed;
}
