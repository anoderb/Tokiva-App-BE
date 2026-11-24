import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../lib/supabase.js';
import { Unauthorized, NotFound, BadRequest } from '../../utils/errors.js';

const BCRYPT_ROUNDS = 10;

export function isPinHashed(storedPin) {
  return typeof storedPin === 'string' && storedPin.startsWith('$2');
}

export async function hashPinKasir(rawPin) {
  const cleanPin = String(rawPin || '').trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    throw new BadRequest('PIN kasir harus terdiri dari 6 digit angka');
  }
  return bcrypt.hash(cleanPin, BCRYPT_ROUNDS);
}

export async function comparePinKasir(rawPin, storedPin) {
  const cleanPin = String(rawPin || '').trim();
  if (!cleanPin || !storedPin) return false;
  if (isPinHashed(storedPin)) {
    return bcrypt.compare(cleanPin, storedPin);
  }
  return storedPin === cleanPin;
}

/**
 * Verifikasi Otorisasi PIN 6-Digit Kasir untuk Tindakan Sensitif di POS
 */
export async function verifikasiPinKasir(tokoId, kasirId, pin) {
  const cleanPin = String(pin || '').trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    throw new Unauthorized('PIN kasir harus berupa 6 digit angka');
  }

  const { data: kasir, error } = await supabaseAdmin
    .from('pengguna')
    .select('id, nama_lengkap, pin_kasir, peran, aktif')
    .eq('id', kasirId)
    .eq('toko_id', tokoId)
    .maybeSingle();

  if (error) throw error;
  if (!kasir) throw new NotFound('Akun kasir tidak ditemukan');

  if (!kasir.aktif) {
    throw new Unauthorized('Akun kasir sedang dinonaktifkan');
  }

  const valid = await comparePinKasir(cleanPin, kasir.pin_kasir);
  if (!valid) {
    throw new Unauthorized('PIN kasir yang Anda masukkan salah');
  }

  return {
    valid: true,
    kasir: {
      id: kasir.id,
      nama_lengkap: kasir.nama_lengkap,
      peran: kasir.peran,
    },
  };
}
