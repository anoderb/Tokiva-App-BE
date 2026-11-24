export const shiftSchema = {
  buka: {
    tags: ['Kasir Operations'],
    summary: 'Buka shift baru kasir & input uang modal awal laci',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        nomor_shift: { type: 'integer', minimum: 1, default: 1 },
        kas_awal: { type: 'number', minimum: 0 },
        modal_awal: { type: 'number', minimum: 0 },
        catatan_buka: { type: 'string' },
      },
    },
  },
  aktif: {
    tags: ['Kasir Operations'],
    summary: 'Cek shift aktif kasir yang sedang bertugas',
  },
  tutup: {
    tags: ['Kasir Operations'],
    summary: 'Tutup shift kasir & audit selisih uang fisik laci',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        kas_fisik: { type: 'number', minimum: 0 },
        uang_fisik_akhir: { type: 'number', minimum: 0 },
        catatan_selisih: { type: 'string', nullable: true },
        catatan_tutup: { type: 'string', nullable: true },
      },
    },
  },
  riwayat: {
    tags: ['Owner Operations'],
    summary: 'Rekapitulasi riwayat seluruh shift toko (audit owner)',
    querystring: {
      type: 'object',
      additionalProperties: true,
      properties: {
        kasir_id: { type: 'string', format: 'uuid' },
        page: { type: 'integer', default: 1 },
        limit: { type: 'integer', default: 20 },
      },
    },
  },
  detail: {
    tags: ['Kasir Operations'],
    summary: 'Ringkasan detail 1 sesi shift kasir',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
};
