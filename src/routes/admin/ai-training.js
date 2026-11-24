import { kaggleService } from '../../services/ai/kaggle.js';
import {
  getAutomationConfig,
  updateAutomationConfig,
  clearAutomationLogs,
} from '../../services/ai/automation-store.js';
import {
  getDeltaMetrics,
  getSchedulerStatus,
  reloadSchedules,
  runDatasetSyncCheck,
  runTrainingCheck,
  handleExternalCronTick,
  ensureTrainingPollerRunning,
} from '../../services/ai/scheduler.js';
import { aiSchema } from '../../schemas/ai.js';
import { ok } from '../../utils/response.js';

/** Route admin pipeline training Kaggle, riset eksperimen, dan penjadwal cron AI */
export default async function adminAiTrainingRoutes(app) {
  app.post('/ai/train', { schema: aiSchema.triggerTrain }, async (req, reply) => {
    const data = await kaggleService.triggerTraining(req.pengguna);
    ensureTrainingPollerRunning();
    return ok(reply, data, 'Training berhasil di-trigger di Kaggle GPU T4x2');
  });

  app.get('/ai/train/status', { schema: aiSchema.trainStatus }, async (req, reply) => {
    return ok(reply, await kaggleService.getStatus(req.query?.id));
  });

  app.get('/ai/kaggle/status', { schema: aiSchema.trainStatus }, async (req, reply) => {
    return ok(reply, await kaggleService.getStatus(req.query?.id));
  });

  app.get('/ai/train/history', { schema: aiSchema.trainHistory }, async (req, reply) => {
    return ok(reply, await kaggleService.getHistory());
  });

  app.post('/ai/train/reset', { schema: aiSchema.trainReset }, async (req, reply) => {
    return ok(reply, await kaggleService.resetTraining(), 'Status training berhasil direset');
  });

  app.post('/ai/train/fetch-output', { schema: aiSchema.fetchOutput }, async (req, reply) => {
    const data = await kaggleService.fetchAndRegisterKaggleOutput(req.body?.versi);
    return ok(reply, data, 'Model terbaru berhasil ditarik dari output Kaggle dan didaftarkan');
  });

  app.get('/ai/research-summary', { schema: aiSchema.researchSummary }, async (req, reply) => {
    return ok(reply, await kaggleService.getResearchSummary(req.query?.run_id || null));
  });

  app.post('/ai/kaggle/sync-dataset', { schema: aiSchema.kaggleSyncDataset }, async (req, reply) => {
    const data = await kaggleService.triggerDatasetSync(req.pengguna);
    return ok(reply, data, 'Sinkronisasi dataset HF ke Kaggle berhasil dipicu (CPU)');
  });

  app.get('/ai/kaggle/sync-dataset/status', { schema: aiSchema.kaggleSyncStatus }, async (req, reply) => {
    return ok(reply, await kaggleService.getDatasetSyncStatus());
  });

  app.post('/ai/kaggle/sync-dataset/reset', { schema: aiSchema.kaggleSyncReset }, async (req, reply) => {
    const data = await kaggleService.resetDatasetSync();
    return ok(reply, data, 'Status sinkronisasi dataset Kaggle berhasil direset');
  });

  app.get('/ai/automation/config', { schema: aiSchema.automationConfigGet }, async (req, reply) => {
    const [delta] = await Promise.all([getDeltaMetrics()]);
    return ok(reply, {
      config: getAutomationConfig(),
      delta,
      kaggle_info: kaggleService.getDatasetInfo(),
      scheduler: getSchedulerStatus(),
    });
  });

  app.put('/ai/automation/config', { schema: aiSchema.automationConfigPut }, async (req, reply) => {
    const saved = await updateAutomationConfig(req.body || {});
    const scheduler = reloadSchedules();
    const delta = await getDeltaMetrics();
    return ok(
      reply,
      {
        config: saved.config,
        cloud_synced: saved.cloud_synced,
        cloud_error: saved.cloud_error,
        scheduler,
        delta,
      },
      'Konfigurasi otomatisasi AI berhasil disimpan & jadwal cron diperbarui'
    );
  });

  app.post('/ai/automation/run-sync-now', { schema: aiSchema.automationRunNow }, async (req, reply) => {
    const data = await runDatasetSyncCheck({
      trigger: 'manual',
      force: Boolean(req.body?.force),
      pengguna: req.pengguna,
    });
    return ok(reply, data, data.message || 'Pengecekan sync dataset selesai');
  });

  app.post('/ai/automation/run-train-now', { schema: aiSchema.automationRunNow }, async (req, reply) => {
    const data = await runTrainingCheck({
      trigger: 'manual',
      force: Boolean(req.body?.force),
      pengguna: req.pengguna,
    });
    return ok(reply, data, data.message || 'Pengecekan training GPU selesai');
  });

  app.post('/ai/automation/tick', { schema: aiSchema.automationTick }, async (req, reply) => {
    const data = await handleExternalCronTick(req.body || {});
    return ok(reply, data, 'Tick otomatisasi cron berhasil dieksekusi');
  });

  app.delete('/ai/automation/logs', { schema: aiSchema.automationLogsDelete }, async (req, reply) => {
    const data = await clearAutomationLogs();
    return ok(reply, data, 'Riwayat log otomatisasi berhasil dibersihkan');
  });
}
