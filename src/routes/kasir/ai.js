import { getModelAktif } from '../../services/ai/model.js';
import { listKelasAI } from '../../services/ai/kelas.js';
import { catatLogInferensi } from '../../services/ai/inferensi.js';
import { uploadBurstSampel } from '../../services/ai/sampel.js';
import { listStoreActiveEmbeddings } from '../../services/ai/embedding.js';
import { aiSchema } from '../../schemas/ai.js';
import { ok } from '../../utils/response.js';

export default async function kasirAiRoutes(app) {
  // 1. Ambil URL Model TFJS & Labels untuk Inferensi Real-Time Kamera Kasir
  app.get('/ai/model-aktif', { schema: aiSchema.modelAktif }, async (req, reply) => {
    const data = await getModelAktif();
    return ok(reply, data);
  });

  // 2. Ambil Daftar Kelas AI untuk Pencocokan Produk di Meja Kasir (tanpa terpotong batas 100 kelas)
  app.get('/ai/kelas', { schema: aiSchema.listKelas }, async (req, reply) => {
    const data = await listKelasAI({ limit: 500, ...(req.query || {}) });
    return ok(reply, data);
  });

  // 3. Laporkan Log Inferensi Kamera Kasir (Active Learning Feedback)
  app.post('/ai/log-inferensi', { schema: aiSchema.catatInferensi }, async (req, reply) => {
    const data = await catatLogInferensi(req.toko_id, req.pengguna.id, req.body);
    return ok(reply, data, 'Log inferensi berhasil dicatat', 201);
  });

  // 4. Kasir Bantu Ambil Burst Foto Produk Baru di Meja Kasir (selalu menunggu validasi Admin)
  app.post('/ai/sampel/burst', { schema: aiSchema.uploadBurst }, async (req, reply) => {
    const data = await uploadBurstSampel({
      ...req.body,
      terverifikasi: false,
    });
    return ok(reply, data, 'Burst sampel foto berhasil diunggah', 201);
  });

  // 5. Ambil Embedding Sementara Aktif Milik Toko Ini (Model v2 Hybrid)
  app.get('/ai/embeddings', { schema: aiSchema.listStoreEmbeddings }, async (req, reply) => {
    const data = await listStoreActiveEmbeddings(req.toko_id, req.query?.model_versi || null);
    return ok(reply, data);
  });
}
