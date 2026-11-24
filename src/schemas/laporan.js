export const laporanSchema = {
  listArusKas: {
    tags: ['Arus Kas'],
    summary: 'Daftar riwayat arus kas masuk dan keluar',
    querystring: {
      type: 'object',
      properties: {
        tipe: { type: 'string', enum: ['masuk', 'keluar'] },
        kategori: { type: 'string' },
        tanggal_awal: { type: 'string', format: 'date' },
        tanggal_akhir: { type: 'string', format: 'date' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  tambahArusKas: {
    tags: ['Arus Kas'],
    summary: 'Catat kas masuk atau keluar operasional',
    body: {
      type: 'object',
      required: ['kategori', 'nominal'],
      additionalProperties: true,
      properties: {
        tipe: { type: 'string', enum: ['masuk', 'keluar'] },
        jenis: { type: 'string', enum: ['masuk', 'keluar'] },
        kategori: { type: 'string' },
        nominal: { type: 'number', minimum: 1 },
        tgl_kas: { type: 'string', format: 'date' },
        foto_nota: { type: 'string' },
        catatan: { type: 'string' },
        keterangan: { type: 'string' },
      },
    },
  },
  ringkasanArusKas: {
    tags: ['Arus Kas'],
    summary: 'Ringkasan saldo bersih bulanan',
    querystring: {
      type: 'object',
      properties: {
        bulan: { type: 'integer', minimum: 1, maximum: 12 },
        tahun: { type: 'integer', minimum: 2020 },
      },
    },
  },
  listMutasiStok: {
    tags: ['Laporan Stok'],
    summary: 'Log audit mutasi dan pergerakan stok barang',
    querystring: {
      type: 'object',
      properties: {
        produk_id: { type: 'string', format: 'uuid' },
        jenis: { type: 'string' },
        limit: { type: 'integer', default: 15 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  opnameStok: {
    tags: ['Laporan Stok'],
    summary: 'Penyesuaian stok fisik (stok opname) tunggal atau batch',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        produk_id: { type: 'string', format: 'uuid' },
        stok_fisik: { type: 'number', minimum: 0 },
        catatan: { type: 'string' },
        alasan: { type: 'string' },
        jenis: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['produk_id', 'stok_fisik'],
            additionalProperties: true,
            properties: {
              produk_id: { type: 'string', format: 'uuid' },
              stok_fisik: { type: 'number', minimum: 0 },
              catatan: { type: 'string' },
              alasan: { type: 'string' },
              jenis: { type: 'string' },
            },
          },
        },
      },
    },
  },
  stokMenipis: {
    tags: ['Laporan Stok'],
    summary: 'Daftar produk aktif dengan stok <= batas minimum',
  },
  dashboardOwner: {
    tags: ['Laporan Owner'],
    summary: 'Ringkasan dashboard harian, piutang, stok menipis, grafik 7 hari & produk terlaris',
  },
  laporanPenjualan: {
    tags: ['Laporan Owner'],
    summary: 'Laporan analitik penjualan per rentang tanggal & metode pembayaran',
    querystring: {
      type: 'object',
      properties: {
        tanggal_awal: { type: 'string', format: 'date' },
        tanggal_mulai: { type: 'string', format: 'date' },
        tanggal_akhir: { type: 'string', format: 'date' },
      },
    },
  },
  laporanLabaRugi: {
    tags: ['Laporan Owner'],
    summary: 'Laporan laba rugi (omzet, HPP, laba kotor, beban operasional, laba bersih)',
    querystring: {
      type: 'object',
      properties: {
        tanggal_awal: { type: 'string', format: 'date' },
        tanggal_mulai: { type: 'string', format: 'date' },
        tanggal_akhir: { type: 'string', format: 'date' },
      },
    },
  },
};

