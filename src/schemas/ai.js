import { aiAdminSchema } from './ai-admin.js';

export const aiSchema = {
  ...aiAdminSchema,
  modelAktif: {
    tags: ['AI Vision'],
    summary: 'Dapatkan model AI aktif beserta URL model.json untuk inferensi client TFJS',
  },
  listModels: {
    tags: ['AI Vision'],
    summary: 'Daftar seluruh riwayat model AI yang tersimpan',
  },
  activateModel: {
    tags: ['AI Vision'],
    summary: 'Aktifkan versi model tertentu untuk kasir',
    params: {
      type: 'object',
      required: ['versi'],
      properties: {
        versi: { type: 'string' },
      },
    },
  },
  syncModel: {
    tags: ['AI Vision'],
    summary: 'Sinkronkan model dari folder storage Supabase',
    body: {
      type: 'object',
      properties: {
        versi: { type: 'string', default: 'v1.2.20260912' },
        aktif: { type: 'boolean', default: false },
      },
    },
  },
  listKelas: {
    tags: ['AI Dataset'],
    summary: 'Daftar kelas AI dan progres kuota dataset',
    querystring: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        status: { type: 'string' },
        kategori: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  detailKelas: {
    tags: ['AI Dataset'],
    summary: 'Detail 1 kelas AI beserta sampel fotonya',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    },
  },
  updateTargetKelas: {
    tags: ['AI Dataset'],
    summary: 'Ubah target kuota foto kelas AI',
    params: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
      },
    },
    body: {
      type: 'object',
      required: ['target_foto'],
      properties: {
        target_foto: { type: 'integer', minimum: 10 },
      },
    },
  },
  uploadBurst: {
    tags: ['AI Dataset'],
    summary: 'Upload sekumpulan foto burst kamera/HP kasir',
    body: {
      type: 'object',
      required: ['kelas_id'],
      properties: {
        kelas_id: { type: 'string', format: 'uuid' },
        gambar_list: {
          type: 'array',
          items: { type: 'string' },
        },
        fotos: {
          type: 'array',
        },
        sudut: { type: 'string', default: 'Umum' },
        sudut_ambil: { type: 'string' },
        sumber: { type: 'string', default: 'webcam_burst' },
        terverifikasi: { type: 'boolean', default: false },
      },
    },
  },
  listSampel: {
    tags: ['AI Dataset'],
    summary: 'Daftar sampel foto dataset',
    querystring: {
      type: 'object',
      additionalProperties: true,
      properties: {
        kelas_id: { type: 'string', format: 'uuid' },
        terverifikasi: { type: 'boolean' },
        status: { type: 'string' },
        sumber: { type: 'string' },
        lokasi_simpan: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
  verifikasiSampel: {
    tags: ['AI Dataset'],
    summary: 'Verifikasi sampel foto sebelum push ke Hugging Face Hub',
    body: {
      type: 'object',
      required: ['sampel_ids'],
      properties: {
        sampel_ids: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
        },
        terverifikasi: { type: 'boolean' },
        status: { type: 'string' },
        alasan_tolak: { type: 'string' },
      },
    },
  },
  syncHuggingFace: {
    tags: ['AI Hugging Face'],
    summary: 'Sinkronisasi batch foto terverifikasi ke Hugging Face Hub',
    body: {
      type: 'object',
      properties: {
        batch_limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
        kelas_id: { type: 'string', format: 'uuid' },
        sync_all: { type: 'boolean', default: false },
      },
    },
  },
  statsHuggingFace: {
    tags: ['AI Hugging Face'],
    summary: 'Statistik progres dataset di Supabase vs Hugging Face Hub',
  },
  catatInferensi: {
    tags: ['AI Inferensi'],
    summary: 'Pencatatan log deteksi kamera kasir (Active Learning)',
    body: {
      type: 'object',
      properties: {
        versi_model: { type: 'string', default: 'v1.2.20260912' },
        prediksi_kelas_id: { type: 'string' },
        skor_yakin: { type: 'number', minimum: 0, maximum: 100 },
        diterima_kasir: { type: 'boolean', default: true },
        produk_id_asli: { type: 'string' },
        butuh_koreksi: { type: 'boolean', default: false },
        foto_cuplikan: { type: 'string' },
      },
      additionalProperties: true,
    },
  },
  listInferensi: {
    tags: ['AI Inferensi'],
    summary: 'Audit riwayat inferensi kasir dan evaluasi akurasi',
    querystring: {
      type: 'object',
      properties: {
        butuh_koreksi: { type: 'boolean' },
        versi_model: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        page: { type: 'integer', default: 1 },
      },
    },
  },
};

