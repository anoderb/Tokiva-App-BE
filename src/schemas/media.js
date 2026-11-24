export const mediaSchema = {
  uploadBase64: {
    tags: ['Media'],
    summary: 'Unggah gambar (produk, logo toko, QRIS, nota) via Base64 JSON',
    body: {
      type: 'object',
      anyOf: [{ required: ['gambar'] }, { required: ['file_base64'] }],
      properties: {
        gambar: { type: 'string' },
        file_base64: { type: 'string' },
        nama_file: { type: 'string', default: 'upload.jpg' },
        kategori: {
          type: 'string',
          enum: ['produk', 'logo', 'toko', 'qris', 'bukti', 'nota', 'avatar'],
        },
        folder: {
          type: 'string',
          enum: ['produk', 'logo', 'toko', 'qris', 'bukti', 'nota', 'avatar'],
          default: 'produk',
        },
      },
    },
  },
  uploadMultipart: {
    tags: ['Media'],
    summary: 'Unggah file gambar via multipart/form-data atau base64 ke Supabase Storage',
    querystring: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          enum: ['produk', 'logo', 'toko', 'qris', 'bukti', 'nota', 'avatar'],
          default: 'produk',
        },
      },
    },
  },
};

