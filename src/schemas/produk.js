export const produkSchema = {
  listKasir: {
    tags: ['Kasir Operations'],
    summary: 'List produk aktif untuk POS kasir (HPP modal disembunyikan)',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Pencarian nama atau barcode' },
        kategori_id: { type: 'string', format: 'uuid' },
        page: { type: 'integer', default: 1 },
        limit: { type: 'integer', default: 50 },
      },
    },
  },
  scan: {
    tags: ['Kasir Operations'],
    summary: 'Scanner Barcode Cepat POS (< 30ms) - Eceran & Grosir',
    params: {
      type: 'object',
      required: ['barcode'],
      properties: {
        barcode: { type: 'string' },
      },
    },
  },
  listOwner: {
    tags: ['Owner Operations'],
    summary: 'List produk lengkap untuk owner (HPP modal, margin untung, & filter stok menipis)',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        search: { type: 'string' },
        kategori_id: { type: 'string', format: 'uuid' },
        stok_menipis: { type: 'boolean' },
        status_stok: { type: 'string', enum: ['semua', 'aman', 'menipis', 'habis'] },
        status: { type: 'string' },
        aktif: { type: 'boolean' },
        page: { type: 'integer', default: 1 },
        limit: { type: 'integer', default: 15 },
      },
    },
  },
  detail: {
    tags: ['Owner Operations'],
    summary: 'Detail produk beserta seluruh multi-satuan grosir',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  create: {
    tags: ['Owner Operations'],
    summary: 'Tambah produk toko baru',
    body: {
      type: 'object',
      required: ['nama', 'harga_jual'],
      additionalProperties: true,
      properties: {
        master_id: { type: 'string', format: 'uuid', nullable: true },
        kategori_id: { type: 'string', format: 'uuid', nullable: true },
        nama: { type: 'string', minLength: 2 },
        sku: { type: 'string', nullable: true },
        barcode: { type: 'string', nullable: true },
        foto_url: { type: 'string', nullable: true },
        satuan_dasar: { type: 'string', default: 'pcs' },
        harga_jual: { type: 'number' },
        harga_modal: { type: 'number', default: 0 },
        stok: { type: 'number', default: 0 },
        stok_min: { type: 'number', default: 10 },
        satuan_tambahan: { type: 'array' },
        dataset_fotos: {
          type: 'array',
          items: {
            type: 'object',
            required: ['base64'],
            properties: {
              nama_file: { type: 'string' },
              base64: { type: 'string' },
              sudut: { type: 'string' },
            },
          },
        },
      },
    },
  },
  update: {
    tags: ['Owner Operations'],
    summary: 'Update data produk toko',
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
        kategori_id: { type: 'string', format: 'uuid', nullable: true },
        nama: { type: 'string' },
        sku: { type: 'string', nullable: true },
        barcode: { type: 'string', nullable: true },
        foto_url: { type: 'string', nullable: true },
        satuan_dasar: { type: 'string' },
        harga_jual: { type: 'number' },
        harga_modal: { type: 'number' },
        stok: { type: 'number' },
        stok_min: { type: 'number' },
        aktif: { type: 'boolean' },
      },
    },
  },
  delete: {
    tags: ['Owner Operations'],
    summary: 'Hapus produk toko (soft delete)',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  addSatuan: {
    tags: ['Owner Operations'],
    summary: 'Tambah multi-satuan grosir (misal: 1 Dus = 24 Pcs)',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['nama_satuan', 'isi_konversi', 'harga_jual'],
      properties: {
        nama_satuan: { type: 'string' },
        isi_konversi: { type: 'number', minimum: 2 },
        harga_jual: { type: 'number' },
        barcode: { type: 'string', nullable: true },
      },
    },
  },
  removeSatuan: {
    tags: ['Owner Operations'],
    summary: 'Hapus satuan grosir',
    params: {
      type: 'object',
      required: ['id', 'satuanId'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        satuanId: { type: 'string', format: 'uuid' },
      },
    },
  },
  master: {
    tags: ['Owner Operations'],
    summary: 'Cari barcode EAN-13 di katalog master global',
    params: {
      type: 'object',
      required: ['barcode'],
      properties: {
        barcode: { type: 'string' },
      },
    },
  },
};

