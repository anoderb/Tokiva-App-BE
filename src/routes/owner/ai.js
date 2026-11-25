import { getModelAktif, getThresholdConfig } from '../../services/ai/model.js';
import { listKelasAI, getDetailKelasAI } from '../../services/ai/kelas.js';
import { uploadBurstSampel } from '../../services/ai/sampel.js';
import {
  catatLogInferensi,
  listLogInferensi,
  getRingkasanAkurasi,
} from '../../services/ai/inferensi.js';
import {
  enrollOwnerEmbedding,
  listStoreActiveEmbeddings,
} from '../../services/ai/embedding.js';
import { aiSchema } from '../../schemas/ai.js';
import { ok } from '../../utils/response.js';

export default async function ownerAiRoutes(app) {
  // 1. Model TFJS aktif & threshold kasir (read-only bagi Owner)
  app.get('/ai/model/aktif', { schema: aiSchema.modelAktif }, async (req, reply) => {
    const data = await getModelAktif();
    return ok(reply, data);
  });

  app.get('/ai/threshold', { schema: aiSchema.getThreshold }, async (req, reply) => {
    const data = await getThresholdConfig();
    return ok(reply, data);
  });

  // 2. Kelas AI (read-only untuk pemetaan produk toko)
  app.get('/ai/kelas', { schema: aiSchema.listKelas }, async (req, reply) => {
    const data = await listKelasAI(req.query);
    return ok(reply, data);
  });

  app.get('/ai/kelas/:id', { schema: aiSchema.detailKelas }, async (req, reply) => {
    const data = await getDetailKelasAI(req.params.id);
    return ok(reply, data);
  });

  // 3. Kontribusi burst sampel dari Owner (selalu berstatus menunggu validasi Admin)
  app.post('/ai/sampel/burst', { schema: aiSchema.uploadBurst }, async (req, reply) => {
    const data = await uploadBurstSampel({
      ...req.body,
      terverifikasi: false,
    });
    return ok(reply, data, 'Burst sampel foto berhasil diunggah ke antrean validasi', 201);
  });

  // 4. Log Inferensi & Akurasi khusus tenant toko milik Owner
  app.post('/ai/log-inferensi', { schema: aiSchema.catatInferensi }, async (req, reply) => {
    const data = await catatLogInferensi(req.toko_id, req.pengguna?.id, req.body);
    return ok(reply, data, 'Log inferensi berhasil dicatat', 201);
  });

  app.get('/ai/log-inferensi', { schema: aiSchema.listInferensi }, async (req, reply) => {
    const data = await listLogInferensi(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.get('/ai/ringkasan-akurasi', { schema: aiSchema.ringkasanAkurasi }, async (req, reply) => {
    const data = await getRingkasanAkurasi(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 5. Instant Cold-Start Visual Embedding (Khusus Model v2 & Terisolasi per Toko)
  app.get('/ai/embeddings', { schema: aiSchema.listStoreEmbeddings }, async (req, reply) => {
    const data = await listStoreActiveEmbeddings(req.toko_id, req.query?.model_versi || null);
    return ok(reply, data);
  });

  app.post('/ai/embeddings/enroll', { schema: aiSchema.enrollEmbedding }, async (req, reply) => {
    const data = await enrollOwnerEmbedding(req.toko_id, req.pengguna?.id, req.body || {});
    return ok(reply, data, 'Prototipe visual embedding toko berhasil disimpan', 201);
  });
}
