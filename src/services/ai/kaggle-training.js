import fs from 'node:fs';
import {
  getTrackConfig,
  readTrainingState,
  writeTrainingState,
} from './kaggle-config.js';
import { pushKernelToKaggle, checkKaggleStatusRemote } from './kaggle-cli.js';
import { downloadAndRegister } from './kaggle-artifacts.js';

const finalizationJobs = new Map();

    export async function triggerTraining(pengguna = null, track = 'v1') {
      const trackCfg = getTrackConfig(track);
      if (!fs.existsSync(trackCfg.notebookPath)) {
        throw new Error(`Notebook tidak ditemukan di ${trackCfg.notebookPath}`);
      }

      const state = readTrainingState(trackCfg.track);
      const runId = `TRN-${trackCfg.track.toUpperCase()}-${Date.now()}`;
      const startedAt = new Date().toISOString();

      const currentRun = {
        training_id: runId,
        track: trackCfg.track,
        status: 'starting',
        kernel_id: trackCfg.kernelId,
        kaggle_url: trackCfg.kaggleUrl,
        started_at: startedAt,
        triggered_by: pengguna?.nama_lengkap || 'Super Admin',
      };

      state.current = currentRun;
      writeTrainingState(state, trackCfg.track);

      try {
        const pushRes = await pushKernelToKaggle(trackCfg.track);
        currentRun.status = 'running';
        currentRun.kaggle_url = pushRes.url || trackCfg.kaggleUrl;
        currentRun.stdout = pushRes.stdout;
        currentRun.dataset_attached = Boolean(pushRes.dataset_attached);
        state.current = currentRun;
        state.history = [currentRun, ...(state.history || []).slice(0, 19)];
        writeTrainingState(state, trackCfg.track);

        return {
          training_id: runId,
          track: trackCfg.track,
          kernel_id: trackCfg.kernelId,
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
        writeTrainingState(state, trackCfg.track);
        throw err;
      }
    }

      export async function getStatus(_trainingId = null, track = 'v1') {
        const trackCfg = getTrackConfig(track);
        const state = readTrainingState(trackCfg.track);
        const current = state.current;

        if (!current || current.dismissed_at) {
          return {
            status: 'idle',
            track: trackCfg.track,
            has_training: false,
            kernel_id: trackCfg.kernelId,
            kaggle_url: trackCfg.kaggleUrl,
          };
        }
        if (current.status === 'complete' && current.result) {
          return { ...current, track: trackCfg.track, has_training: true, ...current.result };
        }
        if (current.status === 'error') {
          return { ...current, track: trackCfg.track, has_training: true };
        }

        const remote = await checkKaggleStatusRemote(trackCfg.kernelSlug);
        current.last_checked_at = new Date().toISOString();
        current.raw = remote.raw;

        if (remote.status === 'error') {
          current.status = 'error';
          current.error_message = remote.failureMessage || 'Training gagal di Kaggle Kernel. Cek log di Kaggle.';
          state.current = current;
          writeTrainingState(state, trackCfg.track);
          return { ...current, track: trackCfg.track, has_training: true };
        }

        if (remote.status === 'complete') {
          current.status = 'processing';
          state.current = current;
          writeTrainingState(state, trackCfg.track);

            const jobKey = `${trackCfg.track}:${current.training_id}`;
            if (!finalizationJobs.has(jobKey)) {
              const job = (async () => {
                try {
                  const result = await downloadAndRegister(null, current.training_id, trackCfg.track);
                  const freshState = readTrainingState(trackCfg.track);
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
                    writeTrainingState(freshState, trackCfg.track);
                  }
                } catch (e) {
                  const freshState = readTrainingState(trackCfg.track);
                  if (freshState.current) {
                    freshState.current.status = 'error';
                    freshState.current.error_message = e.message;
                    writeTrainingState(freshState, trackCfg.track);
                  }
                } finally {
                  finalizationJobs.delete(jobKey);
                }
              })();
              finalizationJobs.set(jobKey, job);
            }

            return { ...current, track: trackCfg.track, status: 'processing', has_training: true };
          }

          current.status = 'running';
          state.current = current;
          writeTrainingState(state, trackCfg.track);
          return { ...current, track: trackCfg.track, has_training: true };
        }

          export async function fetchAndRegisterKaggleOutput(customVersi = null, track = 'v1') {
            const trackCfg = getTrackConfig(track);
            const remote = await checkKaggleStatusRemote(trackCfg.kernelSlug);
            if (remote.status === 'error') {
              throw new Error(`Kernel Kaggle (${trackCfg.track}) saat ini berstatus error: ${remote.failureMessage || remote.raw}`);
            }

            const fetchRunId = `FETCH-${trackCfg.track.toUpperCase()}-${Date.now()}`;
            const result = await downloadAndRegister(customVersi, fetchRunId, trackCfg.track);
            const state = readTrainingState(trackCfg.track);
            const succeeded = Boolean(result?.model_registered);
            const run = {
              training_id: fetchRunId,
              track: trackCfg.track,
              status: succeeded ? 'complete' : 'error',
              kernel_id: trackCfg.kernelId,
              kaggle_url: trackCfg.kaggleUrl,
              started_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
              result,
              ...(succeeded ? {} : { error_message: result?.message || 'model.json tidak ditemukan di output Kaggle.' }),
              triggered_by: 'Super Admin (Instant Fetch)',
            };
            state.current = run;
            state.history = [run, ...(state.history || []).slice(0, 19)];
            writeTrainingState(state, trackCfg.track);

            if (!succeeded) {
              throw new Error(result?.message || 'model.json tidak ditemukan di output Kaggle.');
            }
            return result;
          }

            export async function resetTraining(track = 'v1') {
              const trackCfg = getTrackConfig(track);
              const state = readTrainingState(trackCfg.track);
              if (state.current) state.current.dismissed_at = new Date().toISOString();
              state.current = null;
              writeTrainingState(state, trackCfg.track);
              return { track: trackCfg.track, message: `Status training track ${trackCfg.track} berhasil direset ke idle` };
            }
