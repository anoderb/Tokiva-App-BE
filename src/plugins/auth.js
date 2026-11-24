import { supabaseAdmin } from '../lib/supabase.js';
import { Unauthorized, Forbidden } from '../utils/errors.js';

const AUTH_CACHE_TTL_MS = 45_000; // 45 detik cache sesi untuk memangkas round-trip berulang ke Supabase Cloud
const MAX_AUTH_CACHE_SIZE = 500;

const authSessionCache = new Map();
const authInFlight = new Map();

/**
 * Bersihkan cache autentikasi (per token, per user ID, atau seluruh cache jika null)
 */
export function invalidateAuthCache(tokenOrUserId = null) {
  if (!tokenOrUserId) {
    authSessionCache.clear();
    return;
  }
  if (authSessionCache.has(tokenOrUserId)) {
    authSessionCache.delete(tokenOrUserId);
    return;
  }
  for (const [k, v] of authSessionCache.entries()) {
    if (v?.user?.id === tokenOrUserId || v?.profil?.id === tokenOrUserId) {
      authSessionCache.delete(k);
    }
  }
}

/**
 * Bersihkan cache autentikasi untuk seluruh pengguna milik toko tertentu
 */
export function invalidateTokoAuthCache(tokoId) {
  if (!tokoId) return;
  for (const [k, v] of authSessionCache.entries()) {
    if (v?.profil?.toko_id === tokoId || v?.profil?.toko?.id === tokoId) {
      authSessionCache.delete(k);
    }
  }
}

/**
 * Decode payload JWT secara ringan untuk mengecek klaim `sub` & `exp` sebelum network call
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function resolveTokenSession(token) {
  const jwtPayload = decodeJwtPayload(token);
  if (jwtPayload?.exp && jwtPayload.exp * 1000 <= Date.now()) {
    throw new Unauthorized('Sesi login telah kedaluwarsa. Silakan login kembali.');
  }

  const subUserId = jwtPayload?.sub;

  let user;
  let profil;

  if (subUserId) {
    // Eksekusi verifikasi Supabase Auth & query tabel `pengguna` secara PARALEL (menghemat ~50% waktu round-trip)
    const [authRes, profRes] = await Promise.all([
      supabaseAdmin.auth.getUser(token),
      supabaseAdmin.from('pengguna').select('*, toko:toko_id(id, status)').eq('id', subUserId).maybeSingle(),
    ]);

    if (authRes.error || !authRes.data?.user) {
      throw new Unauthorized('Sesi login telah kedaluwarsa atau tidak valid. Silakan login kembali.');
    }
    if (profRes.error || !profRes.data) {
      throw new Forbidden('Profil pengguna tidak ditemukan pada sistem');
    }
    user = authRes.data.user;
    profil = profRes.data;
  } else {
    const { data: { user: authUser }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !authUser) {
      throw new Unauthorized('Sesi login telah kedaluwarsa atau tidak valid. Silakan login kembali.');
    }
    const { data: profData, error: profileErr } = await supabaseAdmin
      .from('pengguna')
      .select('*, toko:toko_id(id, status)')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileErr || !profData) {
      throw new Forbidden('Profil pengguna tidak ditemukan pada sistem');
    }
    user = authUser;
    profil = profData;
  }

  if (!profil.aktif) {
    throw new Forbidden('Akun Anda telah dinonaktifkan oleh Owner toko');
  }
  if (profil.peran !== 'superadmin' && profil.toko && profil.toko.status !== 'aktif') {
    throw new Forbidden('Akses ditolak: Toko Anda sedang ditangguhkan atau dinonaktifkan oleh Administrator.');
  }

  const expMs = jwtPayload?.exp ? jwtPayload.exp * 1000 : Date.now() + AUTH_CACHE_TTL_MS;
  const expiresAt = Math.min(Date.now() + AUTH_CACHE_TTL_MS, expMs);

  if (authSessionCache.size >= MAX_AUTH_CACHE_SIZE) {
    const oldestKey = authSessionCache.keys().next().value;
    if (oldestKey) authSessionCache.delete(oldestKey);
  }

  const sessionObj = { user, profil, expiresAt };
  authSessionCache.set(token, sessionObj);
  return sessionObj;
}

/**
 * Ekstrak token Bearer atau Cookie sesi tanpa melempar error
 */
export function extractSessionToken(request) {
  const authHeader = request.headers.authorization;
  const cookieToken = request.cookies?.tokiva_token;
  return authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : cookieToken;
}

/**
 * Middleware untuk memverifikasi JWT Bearer Token atau Cookie sesi
 */
export async function authenticate(request, reply) {
  const token = extractSessionToken(request);

  if (!token) {
    throw new Unauthorized('Akses ditolak: Token autentikasi tidak ditemukan');
  }

  // 1. Cek In-Memory Session Cache (< 0.1ms) — tidak melakukan global cache clear
  const cached = authSessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    request.user = cached.user;
    request.pengguna = cached.profil;
    request.toko_id = cached.profil.toko_id;
    request.authToken = token;
    return;
  }

  // 2. Deduplikasi request paralel dengan token yang sama
  let pending = authInFlight.get(token);
  if (!pending) {
    pending = resolveTokenSession(token).finally(() => {
      authInFlight.delete(token);
    });
    authInFlight.set(token, pending);
  }

  const session = await pending;
  request.user = session.user;
  request.pengguna = session.profil;
  request.toko_id = session.profil.toko_id;
  request.authToken = token;
}

/**
 * Middleware Role Guard (Kasir / Owner / Superadmin)
 * @param {...string} allowedRoles
 */
export function requireRole(...allowedRoles) {
  return async (request, reply) => {
    const peran = request.pengguna?.peran;
    if (!peran || !allowedRoles.includes(peran)) {
      throw new Forbidden(`Akses terlarang: Rute ini khusus untuk peran ${allowedRoles.join('/')}`);
    }
  };
}
