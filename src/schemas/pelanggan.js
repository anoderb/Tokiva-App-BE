export const pelangganSchema = {
  list: {
    tags: ['Pelanggan'],
    summary: 'Daftar pelanggan toko',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        is_member: { type: 'boolean' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  detail: {
    tags: ['Pelanggan'],
    summary: 'Detail pelanggan dan status kas bon',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  create: {
    tags: ['Pelanggan'],
    summary: 'Tambah pelanggan baru',
    body: {
      type: 'object',
      required: ['nama'],
      properties: {
        nama: { type: 'string' },
        telepon: { type: 'string' },
        alamat: { type: 'string' },
        is_member: { type: 'boolean', default: false },
        batas_bon: { type: 'number', default: 500000 },
      },
    },
  },
  update: {
    tags: ['Pelanggan'],
    summary: 'Perbarui data pelanggan',
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
        telepon: { type: 'string' },
        alamat: { type: 'string' },
        is_member: { type: 'boolean' },
        batas_bon: { type: 'number' },
        poin: { type: 'integer' },
      },
    },
  },
  delete: {
    tags: ['Pelanggan'],
    summary: 'Hapus pelanggan',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  listPiutang: {
    tags: ['Piutang'],
    summary: 'Daftar seluruh piutang toko',
    querystring: {
      type: 'object',
      properties: {
        pelanggan_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['belum_lunas', 'lunas', 'batal'] },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  kartuPiutang: {
    tags: ['Piutang'],
    summary: 'Buku kas bon / kartu piutang pelanggan',
    params: {
      type: 'object',
      required: ['pelangganId'],
      properties: {
        pelangganId: { type: 'string', format: 'uuid' },
      },
    },
  },
  bayarPiutang: {
    tags: ['Piutang'],
    summary: 'Bayar cicilan / pelunasan kas bon',
    body: {
      type: 'object',
      required: ['nominal_bayar'],
      additionalProperties: true,
      properties: {
        piutang_id: { type: 'string', format: 'uuid' },
        pelanggan_id: { type: 'string', format: 'uuid' },
        nominal_bayar: { type: 'number', minimum: 1 },
        metode: { type: 'string', enum: ['tunai', 'transfer', 'qris'], default: 'tunai' },
        shift_id: { type: 'string', format: 'uuid' },
        no_bukti: { type: 'string' },
        catatan: { type: 'string' },
      },
    },
  },
};

