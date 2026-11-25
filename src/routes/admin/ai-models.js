import {
  getModelAktif,
  listModels,
  activateModel,
  syncStorageModel,
  registerManualModel,
  deleteModel,
  getThresholdConfig,
  updateThresholdConfig,
} from '../../services/ai/model.js';
import {
  listAdminEmbeddings,
  updateAdminEmbeddingStatus,
  deleteAdminEmbedding,
} from '../../services/ai/embedding.js';
import { aiSchema } from '../../schemas/ai.js';
import { ok } from '../../utils/response.js';

/** Route admin manajemen registri model TFJS dan konfigurasi threshold */
export default async function adminAiModelRoutes(app) {
  app.get('/ai/model', { schema: aiSchema.listModels }, async (req, reply) => {
    return ok(reply, await listModels());
  });

  app.get('/ai/model/aktif', { schema: aiSchema.modelAktif }, async (req, reply) => {
    return ok(reply, await getModelAktif());
  });

  app.post('/ai/model/:versi/aktifkan', { schema: aiSchema.activateModel }, async (req, reply) => {
    const data = await activateModel(req.params.versi, req.body?.versi_override || null);
    return ok(reply, data, `Model versi ${data.versi} berhasil diaktifkan ke seluruh terminal POS`);
  });

  app.post('/ai/model/sync', { schema: aiSchema.syncModel }, async (req, reply) => {
    const { versi = 'v1.2.20260912', aktif = false } = req.body || {};
    const data = await syncStorageModel(versi, aktif);
    return ok(reply, data, `Model versi ${versi} berhasil disinkronkan dari storage`);
  });

  app.post('/ai/model/register', { schema: aiSchema.registerModel }, async (req, reply) => {
    const data = await registerManualModel(req.body || {});
    return ok(reply, data, `Model versi ${data.versi} berhasil didaftarkan`, 201);
  });

  app.delete('/ai/model/:id', { schema: aiSchema.deleteById }, async (req, reply) => {
    const data = await deleteModel(req.params.id);
    return ok(reply, data, `Model versi ${data.versi} berhasil dihapus dari registri`);
  });

  app.get('/ai/threshold', { schema: aiSchema.getThreshold }, async (req, reply) => {
    return ok(reply, await getThresholdConfig());
  });

  app.put('/ai/threshold', { schema: aiSchema.updateThreshold }, async (req, reply) => {
    const data = await updateThresholdConfig(req.body || {});
    return ok(reply, data, 'Konfigurasi threshold identifikasi kasir berhasil disimpan');
  });

  // Monitor & Kelola Embedding Sementara Lintas Toko (Model v2 Hybrid)
  app.get('/ai/embeddings', { schema: aiSchema.listAdminEmbeddings }, async (req, reply) => {
    return ok(reply, await listAdminEmbeddings(req.query || {}));
  });

  app.patch('/ai/embeddings/:id/status', { schema: aiSchema.updateEmbeddingStatus }, async (req, reply) => {
    const data = await updateAdminEmbeddingStatus(req.params.id, req.body?.status);
    return ok(reply, data, `Status embedding berhasil diubah ke '${data.status}'`);
  });

  app.delete('/ai/embeddings/:id', { schema: aiSchema.deleteById }, async (req, reply) => {
    const data = await deleteAdminEmbedding(req.params.id);
    return ok(reply, data, 'Embedding produk berhasil dihapus');
  });
}
