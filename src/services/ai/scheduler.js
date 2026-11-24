import cron from 'node-cron';
import { initThresholdConfigFromCloud } from './model.js';
import { initAutomationStore, getAutomationConfig } from './automation-store.js';
import {
  buildCronExpression,
  validateCronExpression,
  getLatestHfHeadCommit,
  getDeltaMetrics,
} from './scheduler-metrics.js';
import {
  clearDatasetSyncPoller,
  clearTrainingPoller,
  hasActiveSyncPoller,
  hasActiveTrainPoller,
  ensureTrainingPollerRunning,
  runDatasetSyncCheck,
  runTrainingCheck,
} from './scheduler-runner.js';

export {
  buildCronExpression,
  validateCronExpression,
  getLatestHfHeadCommit,
  getDeltaMetrics,
  runDatasetSyncCheck,
  runTrainingCheck,
  ensureTrainingPollerRunning,
};

const TIMEZONE = 'Asia/Jakarta';
let syncCronTask = null;
let trainCronTask = null;
let activeSyncCronExpr = null;
let activeTrainCronExpr = null;

function stopCronTask(task) {
  if (!task) return;
  try {
    if (typeof task.stop === 'function') task.stop();
    if (typeof task.destroy === 'function') task.destroy();
  } catch {}
}

export function getSchedulerStatus() {
  const cfg = getAutomationConfig();
  return {
    timezone: TIMEZONE,
    dataset_sync_scheduled: Boolean(syncCronTask),
    dataset_sync_cron: activeSyncCronExpr,
    training_scheduled: Boolean(trainCronTask),
    training_cron: activeTrainCronExpr,
    training_event_mode: Boolean(cfg.training.enabled && cfg.training.mode === 'on_new_dataset'),
    sync_poller_active: hasActiveSyncPoller(),
    train_poller_active: hasActiveTrainPoller(),
  };
}

export function reloadSchedules() {
  stopCronTask(syncCronTask);
  stopCronTask(trainCronTask);
  syncCronTask = null;
  trainCronTask = null;
  activeSyncCronExpr = null;
  activeTrainCronExpr = null;

  const cfg = getAutomationConfig();

  if (cfg.dataset_sync.enabled) {
    const expr = buildCronExpression(cfg.dataset_sync);
    if (validateCronExpression(expr)) {
      syncCronTask = cron.schedule(
        expr,
        () => {
          runDatasetSyncCheck({ trigger: 'cron', force: false }).catch((err) => {
            console.error('❌ Cron dataset sync error:', err?.message || err);
          });
        },
        { timezone: TIMEZONE }
      );
      activeSyncCronExpr = expr;
    }
  }

  if (cfg.training.enabled && cfg.training.mode !== 'on_new_dataset') {
    const expr = buildCronExpression(cfg.training);
    if (validateCronExpression(expr)) {
      trainCronTask = cron.schedule(
        expr,
        () => {
          runTrainingCheck({ trigger: 'cron', force: false }).catch((err) => {
            console.error('❌ Cron training error:', err?.message || err);
          });
        },
        { timezone: TIMEZONE }
      );
      activeTrainCronExpr = expr;
    }
  }

  const status = getSchedulerStatus();
  console.log(
    `⏱️ AI Automation Scheduler reloaded [${TIMEZONE}] -> Sync: ${status.dataset_sync_cron || 'OFF'} | Train: ${status.training_event_mode ? 'ON_NEW_DATASET' : status.training_cron || 'OFF'}`
  );
  return status;
}

export async function initAiAutomationScheduler() {
  const [{ source }] = await Promise.all([
    initAutomationStore(),
    initThresholdConfigFromCloud(),
  ]);
  const status = reloadSchedules();
  return { source, scheduler: status };
}

export function stopAiAutomationScheduler() {
  stopCronTask(syncCronTask);
  stopCronTask(trainCronTask);
  syncCronTask = null;
  trainCronTask = null;
  activeSyncCronExpr = null;
  activeTrainCronExpr = null;
  clearDatasetSyncPoller();
  clearTrainingPoller();
}

export async function handleExternalCronTick({ job = 'all', force = false } = {}) {
  const results = {};
  if (job === 'all' || job === 'dataset_sync') {
    results.dataset_sync = await runDatasetSyncCheck({ trigger: 'external', force: Boolean(force) });
  }
  if (job === 'all' || job === 'training') {
    results.training = await runTrainingCheck({ trigger: 'external', force: Boolean(force) });
  }
  return results;
}
