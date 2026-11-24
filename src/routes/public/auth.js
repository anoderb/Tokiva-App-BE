import { loginUser } from '../../services/auth/login.js';
import { getProfil, updateProfil, updatePassword, registerOwner } from '../../services/auth/profil.js';
import {
  acceptKasirInvite,
  getKasirInviteDetails,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailAddress,
} from '../../services/auth/verification.js';
import { authSchema } from '../../schemas/auth.js';
import {
  authenticate,
  extractSessionToken,
  invalidateAuthCache,
} from '../../plugins/auth.js';
import { ok } from '../../utils/response.js';

const COOKIE_NAME = 'tokiva_token';
const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60,
};

export default async function authRoutes(app) {
  // 1. POST /api/auth/login
  app.post('/auth/login', { schema: authSchema.login }, async (req, reply) => {
    const result = await loginUser(req.body);
    reply.setCookie(COOKIE_NAME, result.token.access_token, cookieOptions);
    return ok(reply, result, 'Login berhasil');
  });

  // 2. POST /api/auth/register
  app.post('/auth/register', { schema: authSchema.register }, async (req, reply) => {
    const result = await registerOwner(req.body);
    if (result?.token?.access_token) {
      reply.setCookie(COOKIE_NAME, result.token.access_token, cookieOptions);
      return ok(reply, result, 'Registrasi toko dan akun owner berhasil', 201);
    }
    return ok(
      reply,
      result,
      'Pendaftaran berhasil! Silakan periksa email Anda untuk verifikasi akun sebelum masuk.',
      201
    );
  });

  // 2b. POST /api/auth/verify-email
  app.post('/auth/verify-email', {
    schema: authSchema.verifyEmail,
    config: { rateLimit: { max: 15, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const result = await verifyEmailAddress(req.body || {});
    return ok(reply, result, 'Email berhasil diverifikasi. Anda sekarang dapat masuk.');
  });

  // 2c. POST /api/auth/resend-verification
  app.post('/auth/resend-verification', {
    schema: authSchema.resendVerification,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const result = await resendVerificationEmail(req.body || {});
    return ok(reply, result, result.message || 'Email verifikasi dikirim ulang');
  });

  // 2d. POST /api/auth/forgot-password
  app.post('/auth/forgot-password', {
    schema: authSchema.forgotPassword,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const result = await requestPasswordReset(req.body || {});
    return ok(reply, result, result.message);
  });

  // 2e. POST /api/auth/reset-password
  app.post('/auth/reset-password', {
    schema: authSchema.resetPassword,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const result = await resetPasswordWithToken(req.body || {});
    return ok(reply, result, 'Kata sandi berhasil diatur ulang. Silakan masuk dengan kata sandi baru.');
  });

  // 2f. GET /api/auth/invite/:token
  app.get('/auth/invite/:token', { schema: authSchema.getInvite }, async (req, reply) => {
    const result = await getKasirInviteDetails(req.params.token);
    return ok(reply, result, 'Undangan kasir valid');
  });

  // 2g. POST /api/auth/invite/accept
  app.post('/auth/invite/accept', {
    schema: authSchema.acceptInvite,
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const result = await acceptKasirInvite(req.body || {});
    if (result?.token?.access_token) {
      reply.setCookie(COOKIE_NAME, result.token.access_token, cookieOptions);
    }
    return ok(reply, result, 'Akun kasir berhasil diaktifkan');
  });

  // 3. GET /api/auth/me (Guard: authenticate)
  app.get('/auth/me', {
    schema: authSchema.me,
    preHandler: [authenticate],
  }, async (req, reply) => {
    const result = await getProfil(req.user.id);
    return ok(reply, result, 'Profil pengguna berhasil diambil');
  });

  // 4. PUT /api/auth/profil (Guard: authenticate)
  app.put('/auth/profil', {
    schema: authSchema.updateProfil,
    preHandler: [authenticate],
  }, async (req, reply) => {
    const result = await updateProfil(req.user.id, req.body);
    return ok(reply, result, 'Profil pengguna berhasil diperbarui');
  });

  // 5. PUT /api/auth/password (Guard: authenticate)
  app.put('/auth/password', {
    schema: authSchema.updatePassword,
    preHandler: [authenticate],
  }, async (req, reply) => {
    const result = await updatePassword(req.user.id, req.body);
    return ok(reply, result, 'Password berhasil diperbarui');
  });

  // 6. POST /api/auth/logout
  app.post('/auth/logout', { schema: authSchema.logout }, async (req, reply) => {
    const token = extractSessionToken(req);
    if (token) {
      invalidateAuthCache(token);
    }
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return ok(reply, null, 'Logout berhasil, sesi telah dihapus');
  });
}
