import fs from 'node:fs';
import {
  NOTEBOOK_PATH,
  KERNEL_ID,
  KERNEL_SLUG,
  KAGGLE_URL,
  readTrainingState,
  writeTrainingState,
} from './kaggle-config.js';
import { pushKernelToKaggle, checkKaggleStatusRemote } from './kaggle-cli.js';
import { downloadAndRegister } from './kaggle-artifacts.js';

const finalizationJobs = new Map();

export async function triggerTraining(pengguna = null) {
  if (!fs.existsSync(NOTEBOOK_PATH)) {
    throw new Error(`Notebook tidak ditemukan di ${NOTEBOOK_PATH}`);
  }

  const state = readTrainingState();
  const runId = `TRN-${Date.now()}`;
  const startedAt = new Date().toISOString();

  const currentRun = {
    training_id: runId,
    status: 'starting',
    kernel_id: KERNEL_ID,
    kaggle_url: KAGGLE_URL,
    started_at: startedAt,
    triggered_by: pengguna?.nama_lengkap || 'Super Admin',
  };

  state.current = currentRun;
  writeTrainingState(state);

  try {
    const pushRes = await pushKernelToKaggle();
    currentRun.status = 'running';
    currentRun.kaggle_url = pushRes.url || KAGGLE_URL;
    currentRun.stdout = pushRes.stdout;
    currentRun.dataset_attached = Boolean(pushRes.dataset_attached);
    state.current = currentRun;
    state.history = [currentRun, ...(state.history || []).slice(0, 19)];
    writeTrainingState(state);

    return {
      training_id: runId,
      kernel_id: KERNEL_ID,
      status: 'running',
      kaggle_url: currentRun.kaggle_url,
      dataset_attached: currentRun.dataset_attached,
      started_at: startedAt,
      stdout: pushRes.stdout,
    };
  } catch (err) {
    currentRun.status = 'error';
    currentRun.error_message = err.message || 'Gagal memulai training di Kaggle';
    state.current = currentRun;
    state.history = [currentRun, ...(state.history || []).slice(0, 19)];
    writeTrainingState(state);
    throw err;
  }
}

export async function getStatus(_trainingId = null) {
  const state = readTrainingState();
  const current = state.current;

  if (!current || current.dismissed_at) {
    return { status: 'idle', has_training: false, kernel_id: KERNEL_ID, kaggle_url: KAGGLE_URL };
  }
  if (current.status === 'complete' && current.result) {
    return { ...current, has_training: true, ...current.result };
  }
  if (current.status === 'error') {
    return { ...current, has_training: true };
  }

  const remote = await checkKaggleStatusRemote(KERNEL_SLUG);
  current.last_checked_at = new Date().toISOString();
  current.raw = remote.raw;

  if (remote.status === 'error') {
    current.status = 'error';
    current.error_message = remote.failureMessage || 'Training gagal di Kaggle Kernel. Cek log di Kaggle.';
    state.current = current;
    writeTrainingState(state);
    return { ...current, has_training: true };
  }

  if (remote.status === 'complete') {
    current.status = 'processing';
    state.current = current;
    writeTrainingState(state);

    if (!finalizationJobs.has(current.training_id)) {
      const job = (async () => {
        try {
          const result = await downloadAndRegister(null, current.training_id);
          const freshState = readTrainingState();
          if (freshState.current) {
            freshState.current.status = result.model_registered ? 'complete' : 'error';
            freshState.current.completed_at = new Date().toISOString();
            freshState.current.result = result;
            if (!result.model_registered) {
              freshState.current.error_message = result.message || 'Gagal mendaftarkan artifact model';
            }
            freshState.history = (freshState.history || []).map((h) =>
              h.training_id === freshState.current.training_id ? freshState.current : h
            );
            writeTrainingState(freshState);
          }
        } catch (e) {
          const freshState = readTrainingState();
          if (freshState.current) {
            freshState.current.status = 'error';
            freshState.current.error_message = e.message;
            writeTrainingState(freshState);
          }
        } finally {
          finalizationJobs.delete(current.training_id);
        }
      })();
      finalizationJobs.set(current.training_id, job);
    }

    return { ...current, status: 'processing', has_training: true };
  }

  current.status = 'running';
  state.current = current;
  writeTrainingState(state);
  return { ...current, has_training: true };
}

export async function fetchAndRegisterKaggleOutput(customVersi = null) {
  const remote = await checkKaggleStatusRemote(KERNEL_SLUG);
  if (remote.status === 'error') {
    throw new Error(`Kernel Kaggle saat ini berstatus error: ${remote.failureMessage || remote.raw}`);
  }

  const result = await downloadAndRegister(customVersi, null);
  const state = readTrainingState();
  const run = {
    training_id: `FETCH-${Date.now()}`,
    status: 'complete',
    kernel_id: KERNEL_ID,
    kaggle_url: KAGGLE_URL,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    result,
    triggered_by: 'Super Admin (Instant Fetch)',
  };
  state.current = run;
  state.history = [run, ...(state.history || []).slice(0, 19)];
  writeTrainingState(state);

  return result;
}

export async function resetTraining() {
  const state = readTrainingState();
  if (state.current) state.current.dismissed_at = new Date().toISOString();
  state.current = null;
  writeTrainingState(state);
  return { message: 'Status training berhasil direset ke idle' };
}
