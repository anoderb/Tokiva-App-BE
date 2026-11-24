export const penggunaSchema = {
  listKasir: {
    tags: ['Karyawan Kasir'],
    summary: 'Daftar staf kasir toko',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        aktif: { type: 'boolean' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  detailKasir: {
    tags: ['Karyawan Kasir'],
    summary: 'Detail staf kasir dan statistik kinerja',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  createKasir: {
    tags: ['Karyawan Kasir'],
    summary: 'Tambah atau undang akun staf kasir baru',
    body: {
      type: 'object',
      required: ['nama_lengkap', 'email'],
      properties: {
        nama_lengkap: { type: 'string', minLength: 2 },
        email: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 6 },
        telepon: { type: 'string' },
        pin_kasir: { type: 'string', pattern: '^\\d{6}$' },
        kirim_undangan: { type: 'boolean', default: true },
      },
    },
  },
  updateKasir: {
    tags: ['Karyawan Kasir'],
    summary: 'Perbarui data staf kasir',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      properties: {
        nama_lengkap: { type: 'string' },
        telepon: { type: 'string' },
        aktif: { type: 'boolean' },
      },
    },
  },
  resetPinKasir: {
    tags: ['Karyawan Kasir'],
    summary: 'Reset PIN 6 digit kasir',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['pin_baru'],
      properties: {
        pin_baru: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
  resendInvite: {
    tags: ['Karyawan Kasir'],
    summary: 'Kirim ulang tautan undangan aktivasi kasir via Resend',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  deleteKasir: {
    tags: ['Karyawan Kasir'],
    summary: 'Nonaktifkan / hapus akun kasir',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  verifikasiPin: {
    tags: ['Karyawan Kasir'],
    summary: 'Verifikasi otorisasi PIN 6 digit kasir',
    body: {
      type: 'object',
      required: ['pin'],
      properties: {
        pin: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
};
