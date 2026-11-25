export const aiAdminSchema = {
  registerModel: {
    tags: ['AI Vision'],
    summary: 'Daftarkan artefak model TFJS manual ke registri model',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        versi: { type: 'string' },
        nama_model: { type: 'string' },
        arsitektur: { type: 'string' },
        model_json_url: { type: 'string' },
        class_json_url: { type: 'string' },
        set_aktif: { type: 'boolean' },
        aktif: { type: 'boolean' },
      },
    },
  },
  deleteById: {
    tags: ['AI Vision'],
    summary: 'Hapus entitas AI berdasarkan ID',
    params: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
  },
  getThreshold: {
    tags: ['AI Vision'],
    summary: 'Ambil konfigurasi threshold keyakinan AI aktif',
  },
  updateThreshold: {
    tags: ['AI Vision'],
    summary: 'Perbarui konfigurasi threshold keyakinan identifikasi AI',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        high_threshold: { type: 'number', minimum: 10, maximum: 100 },
        medium_threshold: { type: 'number', minimum: 1, maximum: 99 },
        auto_add_high_confidence: { type: 'boolean' },
        show_top3_candidates: { type: 'boolean' },
        fallback_barcode_on_low: { type: 'boolean' },
      },
    },
  },
  triggerTrain: { tags: ['AI Training'], summary: 'Picu training pipeline Kaggle GPU' },
  trainStatus: {
    tags: ['AI Training'],
    summary: 'Cek status eksekusi kernel training Kaggle',
    querystring: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' } } },
  },
  trainHistory: { tags: ['AI Training'], summary: 'Riwayat run training Kaggle' },
  trainReset: { tags: ['AI Training'], summary: 'Reset status training Kaggle ke idle' },
  fetchOutput: {
    tags: ['AI Training'],
    summary: 'Tarik artefak output kernel Kaggle terakhir',
    body: { type: 'object', additionalProperties: true, properties: { versi: { type: 'string' } } },
  },
  researchSummary: {
    tags: ['AI Training'],
    summary: 'Ringkasan evaluasi komparatif E1 vs E2 riset',
    querystring: { type: 'object', additionalProperties: true, properties: { run_id: { type: 'string' } } },
  },
  kaggleSyncDataset: { tags: ['AI Training'], summary: 'Picu sync dataset HF ke Kaggle' },
  kaggleSyncStatus: { tags: ['AI Training'], summary: 'Cek status sync dataset Kaggle' },
  kaggleSyncReset: { tags: ['AI Training'], summary: 'Reset status sync dataset Kaggle ke idle' },
  automationConfigGet: { tags: ['AI Automation'], summary: 'Ambil konfigurasi cronjob dan delta AI' },
  automationConfigPut: {
    tags: ['AI Automation'],
    summary: 'Simpan konfigurasi cronjob sync & training otomatis',
    body: { type: 'object', additionalProperties: true },
  },
  automationRunNow: {
    tags: ['AI Automation'],
    summary: 'Jalankan pengecekan sync atau training otomatis sekarang',
    body: { type: 'object', additionalProperties: true, properties: { force: { type: 'boolean' } } },
  },
  automationTick: {
    tags: ['AI Automation'],
    summary: 'Eksekusi tick cronjob eksternal otomatisasi AI',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: { job: { type: 'string' }, force: { type: 'boolean' } },
    },
  },
  automationLogsDelete: { tags: ['AI Automation'], summary: 'Bersihkan riwayat log otomatisasi AI' },
  createKelas: {
    tags: ['AI Dataset'],
    summary: 'Tambah kelas produk AI baru',
    body: {
      type: 'object',
      additionalProperties: true,
      properties: {
        nama: { type: 'string' },
        kode_kelas: { type: 'string' },
        buat_produk_master: { type: 'boolean', default: false },
      },
    },
  },
  updateKelas: {
    tags: ['AI Dataset'],
    summary: 'Perbarui informasi kelas produk AI',
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    body: { type: 'object', additionalProperties: true },
  },
  unmappedProduk: { tags: ['AI Dataset'], summary: 'Daftar produk toko yang belum terpetakan ke kelas AI' },
  mapProduk: {
    tags: ['AI Dataset'],
    summary: 'Petakan produk toko ke kelas AI',
    body: { type: 'object', additionalProperties: true },
  },
  deleteSampelBatch: {
    tags: ['AI Dataset'],
    summary: 'Hapus batch sampel foto dataset secara permanen',
    body: { type: 'object', additionalProperties: true },
  },
  ubahKelasSampel: {
    tags: ['AI Dataset'],
    summary: 'Pindahkan sampel foto ke kelas AI lain',
    body: { type: 'object', additionalProperties: true },
  },
  ringkasanAkurasi: {
    tags: ['AI Inferensi'],
    summary: 'Ringkasan metrik akurasi inferensi lapangan',
    querystring: { type: 'object', additionalProperties: true },
  },
  jadikanSampel: {
    tags: ['AI Inferensi'],
    summary: 'Konversi log inferensi kasir menjadi sampel dataset terverifikasi',
    params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    body: { type: 'object', additionalProperties: true },
  },
};
