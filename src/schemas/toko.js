export const tokoSchema = {
  getProfil: {
    tags: ['Pengaturan Toko'],
    summary: 'Informasi profil toko, teks struk dan QRIS',
  },
  updateProfil: {
    tags: ['Pengaturan Toko'],
    summary: 'Perbarui informasi dasar toko',
    body: {
      type: 'object',
      properties: {
        nama: { type: 'string' },
        pemilik: { type: 'string' },
        telepon: { type: 'string' },
        alamat: { type: 'string' },
        kota: { type: 'string' },
        logo_url: { type: 'string' },
      },
    },
  },
  updateStruk: {
    tags: ['Pengaturan Toko'],
    summary: 'Perbarui format struk thermal 58mm / 80mm',
    body: {
      type: 'object',
      properties: {
        struk_header: { type: 'string' },
        struk_footer: { type: 'string' },
        lebar_kertas: { type: 'string', enum: ['58mm', '80mm'], default: '58mm' },
        logo_url: { type: 'string' },
      },
    },
  },
  updateQRIS: {
    tags: ['Pengaturan Toko'],
    summary: 'Perbarui konfigurasi QRIS statis toko',
    body: {
      type: 'object',
      properties: {
        qris_string: { type: 'string' },
        qris_foto_url: { type: 'string' },
        qris_mid: { type: 'string' },
      },
    },
  },
  qrisStatus: {
    tags: ['Pengaturan Toko'],
    summary: 'Periksa status aktivasi dan metadata QRIS toko',
  },
  generateQris: {
    tags: ['Pengaturan Toko'],
    summary: 'Buat string dan gambar QRIS dinamis ber-nominal',
    body: {
      type: 'object',
      required: ['nominal'],
      properties: {
        nominal: { type: 'number', minimum: 1 },
      },
    },
  },
};
