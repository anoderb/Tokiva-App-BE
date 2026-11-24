export const transaksiSchema = {
  checkout: {
    tags: ['Kasir Operations'],
    summary: 'Checkout transaksi penjualan kasir (Tunai, QRIS, Split Payment, Kas Bon)',
    body: {
      type: 'object',
      required: ['items'],
      additionalProperties: true,
      properties: {
        shift_id: { type: 'string', format: 'uuid', nullable: true },
        pelanggan_id: { type: 'string', format: 'uuid', nullable: true },
        metode_bayar: {
          type: 'string',
          enum: ['tunai', 'qris', 'split', 'bon'],
          default: 'tunai',
        },
        diskon: { type: 'number', minimum: 0, default: 0 },
        uang_diterima: { type: 'number', minimum: 0, nullable: true },
        bayar_tunai: { type: 'number', minimum: 0, nullable: true },
        bayar_qris: { type: 'number', minimum: 0, nullable: true },
        cash_received: { type: 'number', minimum: 0, nullable: true },
        split_tunai: { type: 'number', minimum: 0, default: 0 },
        split_qris: { type: 'number', minimum: 0, default: 0 },
        uang_muka: { type: 'number', minimum: 0, default: 0 },
        alokasi_bayar_bon: { type: 'number', minimum: 0, nullable: true },
        qris_ref: { type: 'string', nullable: true },
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['produk_id', 'jumlah'],
            properties: {
              produk_id: { type: 'string', format: 'uuid' },
              satuan_id: { type: 'string', format: 'uuid', nullable: true },
              nama_produk: { type: 'string' },
              jumlah: { type: 'number', minimum: 0.01 },
              diskon_item: { type: 'number', minimum: 0, default: 0 },
            },
          },
        },
      },
    },
  },
  riwayat: {
    tags: ['Kasir Operations'],
    summary: 'Riwayat transaksi penjualan toko',
    querystring: {
      type: 'object',
      additionalProperties: true,
      properties: {
        kasir_id: { type: 'string', format: 'uuid' },
        shift_id: { type: 'string', format: 'uuid' },
        metode_bayar: { type: 'string' },
        status: { type: 'string' },
        search: { type: 'string' },
        tanggal: { type: 'string', description: 'Format YYYY-MM-DD' },
        tanggal_mulai: { type: 'string' },
        tanggal_akhir: { type: 'string' },
        page: { type: 'integer', default: 1 },
        limit: { type: 'integer', default: 50 },
      },
    },
  },
  detail: {
    tags: ['Kasir Operations'],
    summary: 'Detail faktur belanja untuk cetak struk thermal 58mm/80mm',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  void: {
    tags: ['Owner Operations'],
    summary: 'Pembatalan transaksi penjualan (void nota) & kembalikan stok',
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
        alasan: { type: 'string', default: 'Salah input kasir' },
        pin: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
  kasirVoid: {
    tags: ['Kasir Operations'],
    summary: 'Pembatalan transaksi oleh kasir dengan otorisasi PIN wajib di server',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['pin'],
      properties: {
        alasan: { type: 'string', default: 'Salah input kasir' },
        pin: { type: 'string', pattern: '^\\d{6}$' },
      },
    },
  },
};

