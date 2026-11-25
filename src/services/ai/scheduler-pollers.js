import { kaggleService } from './kaggle.js';
import { getModelAktif, activateModel } from './model.js';
import {
  getAutomationConfig,
  updateAutomationConfig,
  appendAutomationLog,
} from './automation-store.js';
import { getLatestHfHeadCommit, getSupabaseSampleCounts } from './scheduler-metrics.js';

const SYNC_POLL_INTERVAL_MS = 25_000;
const SYNC_POLL_MAX_ATTEMPTS = 96;
const TRAIN_POLL_INTERVAL_MS = 30_000;
const TRAIN_POLL_MAX_ATTEMPTS = 240;

let syncPollTimer = null;
const trainPollTimers = { v1: null, v2: null };

function normalizePollerTrack(track = 'v1') {
  return String(track || 'v1').trim().toLowerCase() === 'v2' ? 'v2' : 'v1';
}

/** Menghentikan timer polling sync dataset Kaggle jika aktif. */
export function clearDatasetSyncPoller() {
  if (syncPollTimer) {
    clearTimeout(syncPollTimer);
    syncPollTimer = null;
  }
}

    /** Menghentikan timer polling training GPU Kaggle jika aktif (per track atau semua track). */
    export function clearTrainingPoller(track = null) {
      if (track) {
        const key = normalizePollerTrack(track);
        if (trainPollTimers[key]) {
          clearTimeout(trainPollTimers[key]);
          trainPollTimers[key] = null;
        }
        return;
      }
      for (const key of ['v1', 'v2']) {
        if (trainPollTimers[key]) {
          clearTimeout(trainPollTimers[key]);
          trainPollTimers[key] = null;
        }
      }
    }

    export function hasActiveSyncPoller() {
      return Boolean(syncPollTimer);
    }

      export function hasActiveTrainPoller(track = null) {
        if (track) {
          return Boolean(trainPollTimers[normalizePollerTrack(track)]);
        }
        return Boolean(trainPollTimers.v1 || trainPollTimers.v2);
      }

      /** Menjalankan polling status sinkronisasi dataset HF -> Kaggle. */
      export function startDatasetSyncPoller(expectedHfCommit = null, attempt = 0, onNewDatasetTrigger = null) {
        clearDatasetSyncPoller();
        if (attempt >= SYNC_POLL_MAX_ATTEMPTS) {
          appendAutomationLog({
            job: 'dataset_sync',
            trigger: 'poller',
            status: 'ERROR',
            message: 'Polling sync dataset timeout (>40 menit). Cek status langsung di Kaggle.',
          }).catch(() => { });
          return;
        }

        syncPollTimer = setTimeout(async () => {
          syncPollTimer = null;
          try {
            const state = await kaggleService.getDatasetSyncStatus();
            if (state.status === 'running' || state.status === 'starting' || state.status === 'processing') {
              startDatasetSyncPoller(expectedHfCommit, attempt + 1, onNewDatasetTrigger);
              return;
            }

            if (state.status === 'complete') {
              const result = state.result || {};
              const headCommit = expectedHfCommit || (await getLatestHfHeadCommit())?.oid || null;
              await updateAutomationConfig({
                dataset_sync: {
                  last_synced_at: new Date().toISOString(),
                  last_synced_hf_commit: headCommit,
                  last_dataset_action: result.action || 'updated',
                  last_num_classes: result.num_classes ?? null,
                  last_num_images: result.num_images ?? null,
                },
              });

              await appendAutomationLog({
                job: 'dataset_sync',
                trigger: 'poller',
                status: 'SYNCED',
                message: `Kaggle Dataset berhasil diperbarui (${result.num_classes ?? '?'} kelas, ${result.num_images ?? '?'} citra, action: ${result.action || 'updated'}).`,
                meta: {
                  hf_commit: headCommit,
                  sync_id: state.sync_id,
                  num_classes: result.num_classes ?? null,
                  num_images: result.num_images ?? null,
                },
              });

              const freshCfg = getAutomationConfig();
              if (freshCfg.training.enabled && freshCfg.training.mode === 'on_new_dataset' && typeof onNewDatasetTrigger === 'function') {
                onNewDatasetTrigger().catch((err) => {
                  console.warn('⚠️ Event trigger training gagal:', err?.message || err);
                });
              }
              return;
            }

            if (state.status === 'error') {
              await appendAutomationLog({
                job: 'dataset_sync',
                trigger: 'poller',
                status: 'ERROR',
                message: state.error_message || 'Sinkronisasi dataset HF ke Kaggle gagal.',
                meta: { sync_id: state.sync_id },
              });
            }
          } catch (err) {
            await appendAutomationLog({
              job: 'dataset_sync',
              trigger: 'poller',
              status: 'ERROR',
              message: `Poller sync dataset error: ${err?.message || err}`,
            }).catch(() => { });
          }
        }, SYNC_POLL_INTERVAL_MS);
      }

      /** Menjalankan polling status training GPU Kaggle beserta auto-aktivasi model terbaik. */
      export function startTrainingPoller(expectedHfCommit = null, expectedSampleCount = 0, attempt = 0, track = null) {
        const cfg = getAutomationConfig();
        const targetTrack = normalizePollerTrack(track || cfg.training.target_track || 'v1');
        clearTrainingPoller(targetTrack);
        if (attempt >= TRAIN_POLL_MAX_ATTEMPTS) {
          appendAutomationLog({
            job: 'training',
            trigger: 'poller',
            status: 'ERROR',
            message: `Polling training GPU (${targetTrack}) timeout (>120 menit). Cek status langsung di Kaggle.`,
          }).catch(() => { });
          return;
        }

          trainPollTimers[targetTrack] = setTimeout(async () => {
            trainPollTimers[targetTrack] = null;
            try {
              const state = await kaggleService.getStatus(null, targetTrack);
              if (state.status === 'running' || state.status === 'starting' || state.status === 'processing') {
                startTrainingPoller(expectedHfCommit, expectedSampleCount, attempt + 1, targetTrack);
                return;
              }

              if (state.status === 'complete') {
                const result = state.result || state;
                const registeredVersion = result.versi || null;
                const headCommit = expectedHfCommit || (await getLatestHfHeadCommit())?.oid || null;
                const counts = await getSupabaseSampleCounts();
                const trainedCount = Math.max(expectedSampleCount || 0, counts.total_hf_samples || 0);

                await updateAutomationConfig({
                  training: {
                    last_trained_hf_commit: headCommit,
                    last_trained_sample_count: trainedCount,
                    last_registered_version: registeredVersion,
                  },
                });

                await appendAutomationLog({
                  job: 'training',
                  trigger: 'poller',
                  status: 'COMPLETE',
                  message: `Training GPU selesai. Model ${registeredVersion || '-'} terdaftar (akurasi: ${result.akurasi ?? '-'}).`,
                  meta: {
                    training_id: state.training_id,
                    versi: registeredVersion,
                    akurasi: result.akurasi ?? null,
                    hf_commit: headCommit,
                  },
                });

                const freshCfg = getAutomationConfig();
                if (freshCfg.training.auto_activate_if_better && registeredVersion) {
                  try {
                    const activeModel = await getModelAktif().catch(() => null);
                    const activeAcc = Number(activeModel?.akurasi_top1 ?? 0);
                    const newAcc = Number(result.akurasi ?? result.accuracy ?? 0);
                    if (newAcc > 0 && newAcc >= activeAcc) {
                      await activateModel(registeredVersion);
                      await appendAutomationLog({
                        job: 'training',
                        trigger: 'poller',
                        status: 'AUTO_ACTIVATED',
                        message: `Model ${registeredVersion} otomatis diaktifkan ke POS (akurasi ${newAcc} >= model aktif ${activeAcc}).`,
                      });
                    }
                  } catch (actErr) {
                    await appendAutomationLog({
                      job: 'training',
                      trigger: 'poller',
                      status: 'ERROR',
                      message: `Gagal auto-aktivasi model ${registeredVersion}: ${actErr?.message || actErr}`,
                    });
                  }
                }
                return;
              }

              if (state.status === 'error') {
                await appendAutomationLog({
                  job: 'training',
                  trigger: 'poller',
                  status: 'ERROR',
                  message: state.error_message || 'Training GPU di Kaggle gagal.',
                  meta: { training_id: state.training_id },
                });
              }
            } catch (err) {
              await appendAutomationLog({
                job: 'training',
                trigger: 'poller',
                status: 'ERROR',
                message: `Poller training GPU error: ${err?.message || err}`,
              }).catch(() => { });
            }
          }, TRAIN_POLL_INTERVAL_MS);
        }
