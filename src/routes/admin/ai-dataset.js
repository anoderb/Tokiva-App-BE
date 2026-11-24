import {
  listKelasAI,
  getDetailKelasAI,
  createKelasAI,
  updateKelasAI,
  updateTargetKelasAI,
  deleteKelasAI,
  listUnmappedProduk,
  mapProdukKeKelas,
} from '../../services/ai/kelas.js';
import {
  uploadBurstSampel,
  listSampel,
  verifikasiSampel,
  deleteSampelBatch,
  ubahKelasSampel,
} from '../../services/ai/sampel.js';
import { syncDatasetToHuggingFace, getDatasetStats } from '../../services/ai/huggingface.js';
import {
  catatLogInferensi,
  listLogInferensi,
  getRingkasanAkurasi,
  jadikanDataLatihDariLog,
} from '../../services/ai/inferensi.js';
import { aiSchema } from '../../schemas/ai.js';
import { ok } from '../../utils/response.js';

/** Route admin manajemen kelas dataset, sampel citra, Hugging Face sync, dan audit inferensi */
export default async function adminAiDatasetRoutes(app) {
  app.get('/ai/kelas', { schema: aiSchema.listKelas }, async (req, reply) => {
    return ok(reply, await listKelasAI(req.query));
  });

  app.post('/ai/kelas', { schema: aiSchema.createKelas }, async (req, reply) => {
    return ok(reply, await createKelasAI(req.body || {}), 'Kelas produk AI baru berhasil ditambahkan', 201);
  });

  app.get('/ai/kelas/:id', { schema: aiSchema.detailKelas }, async (req, reply) => {
    return ok(reply, await getDetailKelasAI(req.params.id));
  });

  app.put('/ai/kelas/:id', { schema: aiSchema.updateKelas }, async (req, reply) => {
    return ok(reply, await updateKelasAI(req.params.id, req.body || {}), 'Data kelas AI berhasil diperbarui');
  });

  app.put('/ai/kelas/:id/target', { schema: aiSchema.updateTargetKelas }, async (req, reply) => {
    return ok(reply, await updateTargetKelasAI(req.params.id, req.body.target_foto), 'Target kuota foto berhasil diperbarui');
  });

  app.patch('/ai/kelas/:id/target', { schema: aiSchema.updateTargetKelas }, async (req, reply) => {
    return ok(reply, await updateTargetKelasAI(req.params.id, req.body.target_foto), 'Target kuota foto berhasil diperbarui');
  });

  app.delete('/ai/kelas/:id', { schema: aiSchema.deleteById }, async (req, reply) => {
    const data = await deleteKelasAI(req.params.id);
    return ok(reply, data, `Kelas ${data.nama} berhasil dihapus`);
  });

  app.get('/ai/unmapped-produk', { schema: aiSchema.unmappedProduk }, async (req, reply) => {
    return ok(reply, await listUnmappedProduk());
  });

  app.post('/ai/map-produk', { schema: aiSchema.mapProduk }, async (req, reply) => {
    return ok(reply, await mapProdukKeKelas(req.body || {}), 'Produk berhasil dipetakan ke kelas AI');
  });

  app.post('/ai/sampel/burst', { schema: aiSchema.uploadBurst }, async (req, reply) => {
    return ok(reply, await uploadBurstSampel(req.body), 'Burst sampel foto berhasil diunggah', 201);
  });

  app.get('/ai/sampel', { schema: aiSchema.listSampel }, async (req, reply) => {
    return ok(reply, await listSampel(req.query));
  });

  app.post('/ai/sampel/verifikasi', { schema: aiSchema.verifikasiSampel }, async (req, reply) => {
    return ok(reply, await verifikasiSampel(req.body), 'Sampel foto berhasil diverifikasi');
  });

  app.post('/ai/sampel/hapus-batch', { schema: aiSchema.deleteSampelBatch }, async (req, reply) => {
    const data = await deleteSampelBatch(req.body || {});
    return ok(reply, data, `${data.jumlah_dihapus} sampel foto berhasil dihapus`);
  });

  app.put('/ai/sampel/ubah-kelas', { schema: aiSchema.ubahKelasSampel }, async (req, reply) => {
    return ok(reply, await ubahKelasSampel(req.body || {}), 'Kelas sampel foto berhasil diubah');
  });

  app.post('/ai/sync-huggingface', { schema: aiSchema.syncHuggingFace }, async (req, reply) => {
    return ok(reply, await syncDatasetToHuggingFace(req.body || {}));
  });

  app.get('/ai/stats-huggingface', { schema: aiSchema.statsHuggingFace }, async (req, reply) => {
    return ok(reply, await getDatasetStats());
  });

  app.post('/ai/log-inferensi', { schema: aiSchema.catatInferensi }, async (req, reply) => {
    const data = await catatLogInferensi(req.toko_id, req.pengguna?.id, req.body);
    return ok(reply, data, 'Log inferensi berhasil dicatat', 201);
  });

  app.get('/ai/log-inferensi', { schema: aiSchema.listInferensi }, async (req, reply) => {
    return ok(reply, await listLogInferensi(null, req.query));
  });

  app.get('/ai/ringkasan-akurasi', { schema: aiSchema.ringkasanAkurasi }, async (req, reply) => {
    return ok(reply, await getRingkasanAkurasi(null, req.query));
  });

  app.post('/ai/log-inferensi/:id/jadikan-sampel', { schema: aiSchema.jadikanSampel }, async (req, reply) => {
    const data = await jadikanDataLatihDariLog(req.params.id, req.body || {});
    return ok(
      reply,
      data,
      'Log inferensi berhasil ditambahkan ke dataset terverifikasi (siap sinkronisasi HF)'
    );
  });
}
