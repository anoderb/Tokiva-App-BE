export const adminSchema = {
  dashboard: {
    tags: ['Admin Platform'],
    summary: 'Statistik eksekutif seluruh platform Tokiva',
  },
  listToko: {
    tags: ['Admin Platform'],
    summary: 'Daftar seluruh toko tenant di platform',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string', enum: ['aktif', 'nonaktif', 'ditangguhkan'] },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  detailToko: {
    tags: ['Admin Platform'],
    summary: 'Detail satu toko tenant beserta daftar pengguna dan statistiknya',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    },
  },
  createToko: {
    tags: ['Admin Platform'],
    summary: 'Onboarding toko baru sekaligus pembuatan akun Owner',
    body: {
      type: 'object',
      required: ['nama_toko', 'nama_owner', 'email_owner'],
      properties: {
        nama_toko: { type: 'string' },
        kode_toko: { type: 'string' },
        telepon: { type: 'string' },
        alamat: { type: 'string' },
        kota: { type: 'string' },
        nama_owner: { type: 'string' },
        email_owner: { type: 'string', format: 'email' },
        password_owner: { type: 'string', minLength: 6 },
        pin_kasir: { type: 'string', pattern: '^\\d{6}$' },
        require_email_verification: { type: 'boolean', default: false },
      },
    },
  },
  updateStatusToko: {
    tags: ['Admin Platform'],
    summary: 'Aktifkan atau tangguhkan operasional toko tenant',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string', enum: ['aktif', 'nonaktif', 'ditangguhkan'] },
      },
    },
  },
  listPengguna: {
    tags: ['Admin Platform'],
    summary: 'Daftar seluruh pengguna (Owner & Kasir) lintas toko',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        peran: { type: 'string', enum: ['owner', 'kasir', 'superadmin'] },
        toko_id: { type: 'string', format: 'uuid' },
        aktif: { type: 'boolean' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  updateStatusPengguna: {
    tags: ['Admin Platform'],
    summary: 'Aktifkan atau nonaktifkan pengguna platform',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['aktif'],
      properties: {
        aktif: { type: 'boolean' },
      },
    },
  },
  listProdukMaster: {
    tags: ['Admin Produk Master'],
    summary: 'Daftar katalog produk master global EAN-13',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        merek: { type: 'string' },
        kategori_id: { type: 'string', format: 'uuid' },
        terverifikasi: { type: 'boolean' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  createProdukMaster: {
    tags: ['Admin Produk Master'],
    summary: 'Tambah produk ke katalog master global',
    body: {
      type: 'object',
      required: ['nama'],
      properties: {
        nama: { type: 'string' },
        merek: { type: ['string', 'null'] },
        barcode: { type: ['string', 'null'] },
        kategori_id: { type: ['string', 'null'] },
        satuan_dasar: { type: 'string', default: 'pcs' },
        harga_saran: { type: ['number', 'null'], minimum: 0 },
        foto_url: { type: ['string', 'null'] },
        terverifikasi: { type: 'boolean', default: true },
      },
    },
  },
  updateProdukMaster: {
    tags: ['Admin Produk Master'],
    summary: 'Perbarui produk master global',
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
        nama: { type: 'string' },
        merek: { type: ['string', 'null'] },
        barcode: { type: ['string', 'null'] },
        kategori_id: { type: ['string', 'null'] },
        satuan_dasar: { type: 'string' },
        harga_saran: { type: ['number', 'null'], minimum: 0 },
        foto_url: { type: ['string', 'null'] },
        terverifikasi: { type: 'boolean' },
      },
    },
  },
  deleteProdukMaster: {
    tags: ['Admin Produk Master'],
    summary: 'Hapus produk master global',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
};

