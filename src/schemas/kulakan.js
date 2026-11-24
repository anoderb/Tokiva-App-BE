export const kulakanSchema = {
  listPemasok: {
    tags: ['Pemasok'],
    summary: 'Daftar pemasok toko',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  createPemasok: {
    tags: ['Pemasok'],
    summary: 'Tambah pemasok baru',
    body: {
      type: 'object',
      required: ['nama'],
      additionalProperties: true,
      properties: {
        nama: { type: 'string' },
        kontak: { type: 'string' },
        kontak_person: { type: 'string' },
        telepon: { type: 'string' },
        alamat: { type: 'string' },
      },
    },
  },
  updatePemasok: {
    tags: ['Pemasok'],
    summary: 'Perbarui data pemasok',
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
        nama: { type: 'string' },
        kontak: { type: 'string' },
        kontak_person: { type: 'string' },
        telepon: { type: 'string' },
        alamat: { type: 'string' },
      },
    },
  },
  deletePemasok: {
    tags: ['Pemasok'],
    summary: 'Hapus pemasok',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  listKulakan: {
    tags: ['Kulakan'],
    summary: 'Daftar riwayat belanja kulakan',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        pemasok_id: { type: 'string', format: 'uuid' },
        status: { type: 'string' },
        limit: { type: 'integer', default: 15 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  detailKulakan: {
    tags: ['Kulakan'],
    summary: 'Detail faktur belanja kulakan',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
  },
  createKulakan: {
    tags: ['Kulakan'],
    summary: 'Catat belanja kulakan & penerimaan barang',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        pemasok_id: { type: 'string', format: 'uuid', nullable: true },
        no_faktur: { type: 'string' },
        nomor_faktur: { type: 'string' },
        tgl_beli: { type: 'string' },
        tanggal_kulakan: { type: 'string' },
        tgl_terima: { type: 'string' },
        jenis_bayar: { type: 'string' },
        metode_bayar: { type: 'string' },
        status_bayar: { type: 'string' },
        jatuh_tempo: { type: 'string', nullable: true },
        foto_nota: { type: 'string', nullable: true },
        catatan: { type: 'string', nullable: true },
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['produk_id', 'jumlah'],
            properties: {
              produk_id: { type: 'string', format: 'uuid' },
              nama_satuan: { type: 'string' },
              satuan: { type: 'string' },
              isi_konversi: { type: 'number', default: 1 },
              konversi_ke_dasar: { type: 'number', default: 1 },
              jumlah: { type: 'number', minimum: 0.01 },
              harga_satuan: { type: 'number' },
              harga_beli_satuan: { type: 'number' },
            },
          },
        },
      },
    },
  },
  bayarKulakan: {
    tags: ['Kulakan'],
    summary: 'Catat pembayaran cicilan / pelunasan utang faktur kulakan supplier',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['nominal_bayar'],
      additionalProperties: true,
      properties: {
        nominal_bayar: { type: 'number', minimum: 1 },
        metode: { type: 'string', enum: ['transfer', 'tunai'], default: 'transfer' },
        tgl_bayar: { type: 'string' },
        foto_bukti: { type: 'string', nullable: true },
        catatan: { type: 'string', nullable: true },
      },
    },
  },
  listReturKulakan: {
    tags: ['Kulakan'],
    summary: 'Daftar riwayat retur barang ke pemasok / supplier',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  returKulakan: {
    tags: ['Kulakan'],
    summary: 'Proses retur barang ke pemasok dari faktur kulakan',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['items'],
      additionalProperties: true,
      properties: {
        alasan: { type: 'string' },
        kompensasi: {
          type: 'string',
          enum: ['potong_nota', 'refund_tunai', 'refund_transfer', 'tukar_barang'],
          default: 'potong_nota',
        },
        tgl_retur: { type: 'string' },
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['produk_id', 'jumlah_retur'],
            properties: {
              detail_id: { type: 'string' },
              produk_id: { type: 'string', format: 'uuid' },
              jumlah_retur: { type: 'number', minimum: 0.01 },
            },
          },
        },
      },
    },
  },
};

