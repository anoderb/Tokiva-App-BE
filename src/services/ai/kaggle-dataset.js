import fs from 'node:fs';
import { config } from '../../config/env.js';
import {
  SYNC_NOTEBOOK_PATH,
  SYNC_KERNEL_ID,
  SYNC_KERNEL_SLUG,
  SYNC_KAGGLE_URL,
  KERNEL_ID,
  KAGGLE_URL,
  DATASET_ID,
  DATASET_KAGGLE_URL,
  readSyncState,
  writeSyncState,
} from './kaggle-config.js';
import {
  checkKaggleDatasetExists,
  pushSyncKernelToKaggle,
  checkKaggleStatusRemote,
  downloadSyncSummary,
} from './kaggle-cli.js';

const syncFinalizationJobs = new Map();

export function getDatasetInfo() {
  return {
    dataset_id: DATASET_ID,
    dataset_url: DATASET_KAGGLE_URL,
    sync_kernel_id: SYNC_KERNEL_ID,
    sync_kaggle_url: SYNC_KAGGLE_URL,
    train_kernel_id: KERNEL_ID,
    train_kaggle_url: KAGGLE_URL,
    hf_repo: config.huggingFace.datasetRepo || '',
  };
}

export async function triggerDatasetSync(pengguna = null) {
  if (!fs.existsSync(SYNC_NOTEBOOK_PATH)) {
    throw new Error(`Notebook syncer tidak ditemukan di ${SYNC_NOTEBOOK_PATH}`);
  }

  const state = readSyncState();
  const syncId = `SYNC-${Date.now()}`;
  const startedAt = new Date().toISOString();

  const currentSync = {
    sync_id: syncId,
    status: 'starting',
    kernel_id: SYNC_KERNEL_ID,
    kaggle_url: SYNC_KAGGLE_URL,
    dataset_id: DATASET_ID,
    dataset_url: DATASET_KAGGLE_URL,
    started_at: startedAt,
    triggered_by: pengguna?.nama_lengkap || 'Super Admin',
  };

  state.current = currentSync;
  writeSyncState(state);

  try {
    const pushRes = await pushSyncKernelToKaggle();
    currentSync.status = 'running';
    currentSync.kaggle_url = pushRes.url || SYNC_KAGGLE_URL;
    currentSync.stdout = pushRes.stdout;
    state.current = currentSync;
    state.history = [currentSync, ...(state.history || []).slice(0, 19)];
    writeSyncState(state);

    return {
      sync_id: syncId,
      kernel_id: SYNC_KERNEL_ID,
      dataset_id: DATASET_ID,
      dataset_url: DATASET_KAGGLE_URL,
      status: 'running',
      kaggle_url: currentSync.kaggle_url,
      started_at: startedAt,
      stdout: pushRes.stdout,
    };
  } catch (err) {
    currentSync.status = 'error';
    currentSync.error_message = err.message || 'Gagal memulai sinkronisasi dataset di Kaggle';
    state.current = currentSync;
    state.history = [currentSync, ...(state.history || []).slice(0, 19)];
    writeSyncState(state);
    throw err;
  }
}

export async function getDatasetSyncStatus() {
  const state = readSyncState();
  const current = state.current;

  if (!current || current.dismissed_at) {
    return {
      status: 'idle',
      has_sync: false,
      kernel_id: SYNC_KERNEL_ID,
      kaggle_url: SYNC_KAGGLE_URL,
      dataset_id: DATASET_ID,
      dataset_url: DATASET_KAGGLE_URL,
      last_sync: (state.history || [])[0] || null,
    };
  }

  if (current.status === 'complete' || current.status === 'error') {
    return { ...current, has_sync: true };
  }

  const remote = await checkKaggleStatusRemote(SYNC_KERNEL_SLUG);
  current.last_checked_at = new Date().toISOString();
  current.raw = remote.raw;

  if (remote.status === 'error') {
    current.status = 'error';
    current.error_message = remote.failureMessage || 'Sinkronisasi HF ke Kaggle gagal. Cek log di Kaggle.';
    state.current = current;
    state.history = (state.history || []).map((h) => (h.sync_id === current.sync_id ? current : h));
    writeSyncState(state);
    return { ...current, has_sync: true };
  }

  if (remote.status === 'complete') {
    current.status = 'processing';
    state.current = current;
    writeSyncState(state);

    if (!syncFinalizationJobs.has(current.sync_id)) {
      const job = (async () => {
        try {
          const summary = await downloadSyncSummary(current.sync_id);
          const freshState = readSyncState();
          if (freshState.current && freshState.current.sync_id === current.sync_id) {
            freshState.current.status = 'complete';
            freshState.current.completed_at = new Date().toISOString();
            freshState.current.result = summary || { status: 'complete', kaggle_dataset_id: DATASET_ID };
            freshState.history = (freshState.history || []).map((h) =>
              h.sync_id === current.sync_id ? freshState.current : h
            );
            writeSyncState(freshState);
          }
        } catch (e) {
          const freshState = readSyncState();
          if (freshState.current && freshState.current.sync_id === current.sync_id) {
            freshState.current.status = 'error';
            freshState.current.error_message = e.message;
            writeSyncState(freshState);
          }
        } finally {
          syncFinalizationJobs.delete(current.sync_id);
        }
      })();
      syncFinalizationJobs.set(current.sync_id, job);
    }

    return { ...current, status: 'processing', has_sync: true };
  }

  current.status = 'running';
  state.current = current;
  writeSyncState(state);
  return { ...current, has_sync: true };
}

export async function resetDatasetSync() {
  const state = readSyncState();
  if (state.current) state.current.dismissed_at = new Date().toISOString();
  state.current = null;
  writeSyncState(state);
  return { message: 'Status sinkronisasi dataset Kaggle berhasil direset ke idle' };
}

export { checkKaggleDatasetExists };
