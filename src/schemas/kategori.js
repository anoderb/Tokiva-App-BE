export const kategoriSchema = {
  list: {
    tags: ['Katalog & Kategori'],
    summary: 'Daftar seluruh kategori (master global + toko)',
  },
  create: {
    tags: ['Katalog & Kategori'],
    summary: 'Tambah kategori baru milik toko',
    body: {
      type: 'object',
      required: ['nama'],
      properties: {
        nama: { type: 'string', minLength: 2 },
        slug: { type: 'string' },
        urutan: { type: 'number', default: 0 },
      },
    },
  },
  update: {
    tags: ['Katalog & Kategori'],
    summary: 'Update kategori toko',
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
        slug: { type: 'string' },
        urutan: { type: 'number' },
      },
    },
  },
  delete: {
    tags: ['Katalog & Kategori'],
    summary: 'Hapus kategori toko (jika tidak ada produk aktif)',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
};

