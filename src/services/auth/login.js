import { supabaseAdmin, supabaseAuth } from '../../lib/supabase.js';
import { AppError, Unauthorized, Forbidden, NotFound } from '../../utils/errors.js';

/**
 * Logika Bisnis: Login Akun Pengguna
 */
export async function loginUser({ email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();

  // 1. Verifikasi kredensial via Supabase Auth
  const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
    email: cleanEmail,
    password,
  });

  if (authError) {
    if (authError.name === 'AuthRetryableFetchError' || authError.status === 0) {
      throw new AppError('Koneksi ke server autentikasi Supabase timeout/terputus, silakan coba lagi', 503);
    }
    if (authError.message?.toLowerCase().includes('email not confirmed')) {
      throw new Forbidden('Email akun belum dikonfirmasi');
    }
    throw new Unauthorized('Email atau password salah');
  }

  const authUserId = authData.user?.id;

  // 2. Ambil profil pengguna dan data toko via Supabase Admin (Bypass RLS)
  const { data: userProfile, error: profileError } = await supabaseAdmin
    .from('pengguna')
    .select('*, toko:toko_id(*)')
    .eq('id', authUserId)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!userProfile) {
    throw new NotFound('Data profil pengguna tidak ditemukan di sistem');
  }

  // 3. Cek apakah status akun aktif & status toko aktif (kecuali superadmin)
  if (!userProfile.aktif) {
    throw new Forbidden('Akun Anda dinonaktifkan. Silakan hubungi Owner toko.');
  }
  if (userProfile.peran !== 'superadmin' && userProfile.toko && userProfile.toko.status !== 'aktif') {
    throw new Forbidden('Akses ditolak: Toko Anda sedang ditangguhkan atau dinonaktifkan oleh Administrator.');
  }

  // 4. Perbarui waktu login_terakhir
  await supabaseAdmin
    .from('pengguna')
    .update({ login_terakhir: new Date().toISOString() })
    .eq('id', authUserId);

  const { toko, pin_kasir: _omitPin, ...userData } = userProfile;

  return {
    user: userData,
    toko: toko || null,
    token: {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      expires_in: authData.session.expires_in,
      token_type: authData.session.token_type,
    },
  };
}

