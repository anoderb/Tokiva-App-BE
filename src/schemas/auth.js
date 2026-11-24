export const authSchema = {
  login: {
    tags: ['Public'],
    summary: 'Login akun kasir, owner, atau superadmin dengan email dan password',
    body: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
      },
    },
  },
  register: {
    tags: ['Public'],
    summary: 'Registrasi mandiri toko baru dan akun Owner',
    body: {
      type: 'object',
      required: ['nama_toko', 'nama_owner', 'email', 'password'],
      properties: {
        nama_toko: { type: 'string', minLength: 2 },
        nama_owner: { type: 'string', minLength: 2 },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        telepon: { type: 'string' },
        kota: { type: 'string' },
        alamat: { type: 'string' },
        pin_kasir: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
  verifyEmail: {
    tags: ['Public'],
    summary: 'Verifikasi email akun dengan token tautan atau kode OTP 6-digit',
    body: {
      type: 'object',
      properties: {
        token: { type: 'string', minLength: 10 },
        email: { type: 'string', format: 'email' },
        otp: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
  resendVerification: {
    tags: ['Public'],
    summary: 'Kirim ulang email verifikasi pendaftaran dengan batas jeda 60 detik',
    body: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
      },
    },
  },
  forgotPassword: {
    tags: ['Public'],
    summary: 'Kirim instruksi reset kata sandi melalui email Resend',
    body: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', format: 'email' },
      },
    },
  },
  resetPassword: {
    tags: ['Public'],
    summary: 'Atur ulang kata sandi menggunakan token tautan atau OTP email',
    body: {
      type: 'object',
      required: ['password_baru'],
      properties: {
        token: { type: 'string', minLength: 10 },
        email: { type: 'string', format: 'email' },
        otp: { type: 'string', pattern: '^\\d{6}$' },
        password_baru: { type: 'string', minLength: 6 },
      },
    },
  },
  getInvite: {
    tags: ['Public'],
    summary: 'Validasi read-only token undangan kasir',
    params: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string', minLength: 10 },
      },
    },
  },
  acceptInvite: {
    tags: ['Public'],
    summary: 'Aktivasi akun kasir via token undangan sekaligus atur password dan PIN pribadi',
    body: {
      type: 'object',
      required: ['token', 'password', 'pin_kasir'],
      properties: {
        token: { type: 'string', minLength: 10 },
        password: { type: 'string', minLength: 6 },
        pin_kasir: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
  me: {
    tags: ['Public'],
    summary: 'Dapatkan profil pengguna dan toko yang sedang login',
    security: [{ bearerAuth: [] }],
  },
  updateProfil: {
    tags: ['Public'],
    summary: 'Perbarui profil pengguna yang sedang login',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      properties: {
        nama_lengkap: { type: 'string' },
        telepon: { type: 'string' },
        foto_url: { type: 'string' },
      },
    },
  },
  updatePassword: {
    tags: ['Public'],
    summary: 'Ubah password pengguna yang sedang login (wajib verifikasi kata sandi lama)',
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['password_lama', 'password_baru'],
      properties: {
        password_lama: { type: 'string', minLength: 1 },
        password_baru: { type: 'string', minLength: 6 },
      },
    },
  },
  logout: {
    tags: ['Public'],
    summary: 'Logout dan bersihkan cookie sesi',
  },
};
