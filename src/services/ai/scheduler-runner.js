import { kaggleService } from './kaggle.js';
import { syncDatasetToHuggingFace } from './huggingface.js';
import {
  getAutomationConfig,
  updateAutomationConfig,
  appendAutomationLog,
} from './automation-store.js';
import {
  getLatestHfHeadCommit,
  getSupabaseSampleCounts,
  getDeltaMetrics,
} from './scheduler-metrics.js';
import {
  clearDatasetSyncPoller,
  clearTrainingPoller,
  hasActiveSyncPoller,
  hasActiveTrainPoller,
  startDatasetSyncPoller,
  startTrainingPoller,
} from './scheduler-pollers.js';

export {
  clearDatasetSyncPoller,
  clearTrainingPoller,
  hasActiveSyncPoller,
  hasActiveTrainPoller,
};

let isSyncCheckRunning = false;
let isTrainCheckRunning = false;

/** Memastikan poller training berjalan jika sebelumnya berhenti atau saat startup. */
export function ensureTrainingPollerRunning() {
    if (!hasActiveTrainPoller()) {
      startTrainingPoller(null, 0);
      return true;
    }
    return false;
  }

  /** Mengecek perubahan dataset Supabase/HF lalu memicu Notebook CPU Sync Kaggle bila diperlukan. */
  export async function runDatasetSyncCheck({ trigger = 'cron', force = false, pengguna = null } = {}) {
    if (isSyncCheckRunning) {
      const msg = 'Pengecekan sync dataset sedang berlangsung. Dilewati agar tidak bertabrakan.';
      await appendAutomationLog({ job: 'dataset_sync', trigger, status: 'SKIPPED_BUSY', message: msg });
      return { executed: false, status: 'SKIPPED_BUSY', message: msg };
    }

    isSyncCheckRunning = true;
    try {
      const cfg = getAutomationConfig();
      const currentStatus = await kaggleService.getDatasetSyncStatus().catch(() => ({ status: 'idle' }));
      if (['running', 'starting', 'processing'].includes(currentStatus.status)) {
        const msg = `Notebook sync Kaggle masih berstatus '${currentStatus.status}'.`;
        await appendAutomationLog({ job: 'dataset_sync', trigger, status: 'SKIPPED_BUSY', message: msg });
        return { executed: false, status: 'SKIPPED_BUSY', message: msg };
      }

      await updateAutomationConfig({ dataset_sync: { last_checked_at: new Date().toISOString() } });
      const counts = await getSupabaseSampleCounts();
      let pushedToHfCount = 0;

      if (counts.pending_verified_supabase_samples > 0 && (cfg.dataset_sync.auto_sync_supabase_to_hf || force)) {
        const hfPush = await syncDatasetToHuggingFace({ sync_all: true });
        pushedToHfCount = hfPush?.synced ?? 0;
      }

      const [latestHfCommit, kaggleDatasetExists] = await Promise.all([
        getLatestHfHeadCommit(),
        kaggleService.checkKaggleDatasetExists().catch(() => false),
      ]);

      const latestOid = latestHfCommit?.oid || null;
      const sameCommit = Boolean(latestOid) && latestOid === cfg.dataset_sync.last_synced_hf_commit;

      if (!force && kaggleDatasetExists && sameCommit && pushedToHfCount === 0) {
        const msg = `Tidak ada commit baru di Hugging Face (${latestOid.slice(0, 7)}). Kaggle Dataset sudah up-to-date.`;
        await appendAutomationLog({
          job: 'dataset_sync',
          trigger,
          status: 'SKIPPED_NO_NEW_DATA',
          message: msg,
          meta: { hf_commit: latestOid },
        });
        return { executed: false, status: 'SKIPPED_NO_NEW_DATA', message: msg, hf_commit: latestOid };
      }

      const syncRun = await kaggleService.triggerDatasetSync(pengguna);
      const msg = `Notebook CPU Syncer dipicu (${syncRun.sync_id})${pushedToHfCount > 0 ? ` setelah push ${pushedToHfCount} foto baru ke HF` : ''}.`;
      await appendAutomationLog({
        job: 'dataset_sync',
        trigger,
        status: 'TRIGGERED',
        message: msg,
        meta: { sync_id: syncRun.sync_id, hf_commit: latestOid, pushed_to_hf: pushedToHfCount, forced: force },
      });

      startDatasetSyncPoller(latestOid, 0, () => runTrainingCheck({ trigger: 'event', force: false }));
      return { executed: true, status: 'TRIGGERED', message: msg, pushed_to_hf: pushedToHfCount, hf_commit: latestOid, sync: syncRun };
    } catch (err) {
      const msg = `Gagal menjalankan sync dataset: ${err?.message || err}`;
      await appendAutomationLog({ job: 'dataset_sync', trigger, status: 'ERROR', message: msg });
      throw err;
    } finally {
      isSyncCheckRunning = false;
    }
  }

  /** Mengecek ambang sampel baru HF lalu memicu training GPU T4x2 Kaggle bila memenuhi syarat. */
  export async function runTrainingCheck({ trigger = 'cron', force = false, pengguna = null } = {}) {
    if (isTrainCheckRunning) {
      const msg = 'Pengecekan jadwal training sedang berlangsung. Dilewati agar tidak duplikat.';
      await appendAutomationLog({ job: 'training', trigger, status: 'SKIPPED_BUSY', message: msg });
      return { executed: false, status: 'SKIPPED_BUSY', message: msg };
    }

    isTrainCheckRunning = true;
    try {
      const cfg = getAutomationConfig();
      const currentStatus = await kaggleService.getStatus().catch(() => ({ status: 'idle' }));
      if (['running', 'starting', 'processing'].includes(currentStatus.status)) {
        const msg = `Notebook GPU training Kaggle masih berstatus '${currentStatus.status}'.`;
        await appendAutomationLog({ job: 'training', trigger, status: 'SKIPPED_BUSY', message: msg });
        return { executed: false, status: 'SKIPPED_BUSY', message: msg };
      }

      await updateAutomationConfig({ training: { last_checked_at: new Date().toISOString() } });
      const delta = await getDeltaMetrics();
      const latestOid = delta.latest_hf_commit?.oid || null;
      const minNew = Number(cfg.training.min_new_samples ?? 5);
      const newSamples = delta.new_samples_since_last_train;
      const commitChanged = delta.hf_commit_changed_for_training;
      const firstRunNeverTracked = !cfg.training.last_trained_hf_commit && delta.total_hf_samples > 0;

      const enoughNewData =
        minNew === 0
          ? commitChanged || newSamples > 0
          : newSamples >= minNew || (commitChanged && firstRunNeverTracked && delta.total_hf_samples >= minNew);

      const commitIdenticalAndBelowThreshold =
        Boolean(latestOid && latestOid === cfg.training.last_trained_hf_commit) && newSamples < Math.max(1, minNew);

      if (!force && (!enoughNewData || commitIdenticalAndBelowThreshold)) {
        const msg = `Training dilewati: tambahan sampel baru (${newSamples}) belum mencapai ambang minimal (${minNew}) atau commit HF sama.`;
        await appendAutomationLog({
          job: 'training',
          trigger,
          status: 'SKIPPED_NO_NEW_DATA',
          message: msg,
          meta: { new_samples: newSamples, min_new_samples: minNew, hf_commit: latestOid },
        });
        return { executed: false, status: 'SKIPPED_NO_NEW_DATA', message: msg, delta };
      }

      const trainRun = await kaggleService.triggerTraining(pengguna);
      await updateAutomationConfig({ training: { last_triggered_at: new Date().toISOString() } });

      const msg = `Training GPU T4x2 dipicu (${trainRun.training_id}) — total sampel HF: ${delta.total_hf_samples}.`;
      await appendAutomationLog({
        job: 'training',
        trigger,
        status: 'TRIGGERED',
        message: msg,
        meta: { training_id: trainRun.training_id, hf_commit: latestOid, total_hf_samples: delta.total_hf_samples, forced: force },
      });

      startTrainingPoller(latestOid, delta.total_hf_samples);
      return { executed: true, status: 'TRIGGERED', message: msg, training: trainRun, delta };
    } catch (err) {
      const msg = `Gagal memicu training GPU: ${err?.message || err}`;
      await appendAutomationLog({ job: 'training', trigger, status: 'ERROR', message: msg });
      throw err;
    } finally {
      isTrainCheckRunning = false;
    }
  }
