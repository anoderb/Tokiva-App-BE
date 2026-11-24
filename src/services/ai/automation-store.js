import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_CONFIG_PATH = path.resolve(__dirname, '../../../kaggle/automation-config.json');
const CLOUD_BUCKET = 'ai-models';
const CLOUD_CONFIG_PATH = 'config/automation-config.json';
const MAX_LOGS = 50;

export const DEFAULT_AUTOMATION_CONFIG = {
  dataset_sync: {
    enabled: false,
    mode: 'daily', // 'daily' | 'interval'
    hour: 1,
    minute: 0,
    interval_hours: 6,
    auto_sync_supabase_to_hf: true,
    last_checked_at: null,
    last_synced_at: null,
    last_synced_hf_commit: null,
    last_dataset_action: null,
    last_num_classes: null,
    last_num_images: null,
  },
  training: {
    enabled: false,
    mode: 'on_new_dataset', // 'daily' | 'interval' | 'on_new_dataset'
    hour: 2,
    minute: 0,
    interval_hours: 24,
    min_new_samples: 5,
    auto_activate_if_better: false,
    last_checked_at: null,
    last_triggered_at: null,
    last_trained_hf_commit: null,
    last_trained_sample_count: 0,
    last_registered_version: null,
  },
  logs: [],
  updated_at: null,
};

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clampInt(value, fallback, min, max) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function normalizeConfig(raw = {}) {
  const base = cloneDeep(DEFAULT_AUTOMATION_CONFIG);
  const src = raw && typeof raw === 'object' ? raw : {};

  const dsSrc = src.dataset_sync && typeof src.dataset_sync === 'object' ? src.dataset_sync : {};
  const trSrc = src.training && typeof src.training === 'object' ? src.training : {};

  base.dataset_sync = {
    ...base.dataset_sync,
    ...dsSrc,
    enabled: Boolean(dsSrc.enabled ?? base.dataset_sync.enabled),
    mode: ['daily', 'interval'].includes(dsSrc.mode) ? dsSrc.mode : base.dataset_sync.mode,
    hour: clampInt(dsSrc.hour, base.dataset_sync.hour, 0, 23),
    minute: clampInt(dsSrc.minute, base.dataset_sync.minute, 0, 59),
    interval_hours: clampInt(dsSrc.interval_hours, base.dataset_sync.interval_hours, 1, 24),
    auto_sync_supabase_to_hf: Boolean(
      dsSrc.auto_sync_supabase_to_hf ?? base.dataset_sync.auto_sync_supabase_to_hf
    ),
  };

  base.training = {
    ...base.training,
    ...trSrc,
    enabled: Boolean(trSrc.enabled ?? base.training.enabled),
    mode: ['daily', 'interval', 'on_new_dataset'].includes(trSrc.mode)
      ? trSrc.mode
      : base.training.mode,
    hour: clampInt(trSrc.hour, base.training.hour, 0, 23),
    minute: clampInt(trSrc.minute, base.training.minute, 0, 59),
    interval_hours: clampInt(trSrc.interval_hours, base.training.interval_hours, 1, 24),
    min_new_samples: clampInt(trSrc.min_new_samples, base.training.min_new_samples, 0, 100000),
    auto_activate_if_better: Boolean(
      trSrc.auto_activate_if_better ?? base.training.auto_activate_if_better
    ),
    last_trained_sample_count: Math.max(
      0,
      Number.parseInt(trSrc.last_trained_sample_count ?? 0, 10) || 0
    ),
  };

  base.logs = Array.isArray(src.logs) ? src.logs.slice(0, MAX_LOGS) : [];
  base.updated_at = src.updated_at || null;
  return base;
}

let memoryConfig = null;

function readLocalConfig(targetPath = LOCAL_CONFIG_PATH) {
  try {
    if (!fs.existsSync(targetPath)) return null;
    const raw = fs.readFileSync(targetPath, 'utf8');
    if (!raw.trim()) return null;
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    console.warn('⚠️ Gagal membaca automation-config.json lokal:', err.message);
    return null;
  }
}

export function writeLocalAtomic(cfg, targetPath = LOCAL_CONFIG_PATH) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

async function uploadConfigToCloud(cfg) {
  try {
    const buffer = Buffer.from(JSON.stringify(cfg, null, 2), 'utf8');
    const { error } = await supabaseAdmin.storage
      .from(CLOUD_BUCKET)
      .upload(CLOUD_CONFIG_PATH, buffer, {
        contentType: 'application/json',
        upsert: true,
      });

    if (error) {
      return { synced: false, error: error.message };
    }
    return { synced: true, error: null };
  } catch (err) {
    return { synced: false, error: err?.message || 'Cloud upload error' };
  }
}

async function downloadConfigFromCloud() {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(CLOUD_BUCKET)
      .download(CLOUD_CONFIG_PATH);

    if (error || !data) return null;
    const text = await data.text();
    if (!text.trim()) return null;
    return normalizeConfig(JSON.parse(text));
  } catch {
    return null;
  }
}

export function getAutomationConfig() {
  if (!memoryConfig) {
    memoryConfig = readLocalConfig() || normalizeConfig();
  }
  return cloneDeep(memoryConfig);
}

export async function initAutomationStore() {
  const localCfg = readLocalConfig();
  const cloudCfg = await downloadConfigFromCloud();

  let selected = null;
  let source = 'default';
  let shouldPushCloud = false;

  const localTs = localCfg?.updated_at ? Date.parse(localCfg.updated_at) : 0;
  const cloudTs = cloudCfg?.updated_at ? Date.parse(cloudCfg.updated_at) : 0;

  if (cloudCfg && (!localCfg || cloudTs > localTs)) {
    selected = cloudCfg;
    source = 'supabase_storage_restore';
  } else if (localCfg) {
    selected = localCfg;
    source = 'local';
    if (!cloudCfg || localTs > cloudTs) {
      shouldPushCloud = true;
    }
  } else {
    selected = normalizeConfig();
    selected.updated_at = new Date().toISOString();
    source = 'default_initialized';
    shouldPushCloud = true;
  }

  memoryConfig = normalizeConfig(selected);
  writeLocalAtomic(memoryConfig);

  if (shouldPushCloud) {
    await uploadConfigToCloud(memoryConfig).catch(() => {});
  }

  return {
    config: cloneDeep(memoryConfig),
    source,
  };
}

export async function updateAutomationConfig(patch = {}, { syncCloud = true } = {}) {
  const current = getAutomationConfig();

  const merged = normalizeConfig({
    ...current,
    dataset_sync: {
      ...current.dataset_sync,
      ...(patch.dataset_sync && typeof patch.dataset_sync === 'object' ? patch.dataset_sync : {}),
    },
    training: {
      ...current.training,
      ...(patch.training && typeof patch.training === 'object' ? patch.training : {}),
    },
    logs: Array.isArray(patch.logs) ? patch.logs : current.logs,
    updated_at: new Date().toISOString(),
  });

  memoryConfig = merged;
  writeLocalAtomic(memoryConfig);

  let cloudResult = { synced: false, error: null };
  if (syncCloud) {
    cloudResult = await uploadConfigToCloud(memoryConfig);
  }

  return {
    config: cloneDeep(memoryConfig),
    cloud_synced: cloudResult.synced,
    cloud_error: cloudResult.error,
  };
}

export async function appendAutomationLog({ job, trigger, status, message, meta = null }) {
  const current = getAutomationConfig();
  const entry = {
    id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    job: job || 'system',
    trigger: trigger || 'cron',
    status: status || 'INFO',
    message: String(message || ''),
    meta,
  };

  const nextLogs = [entry, ...(current.logs || [])].slice(0, MAX_LOGS);
  const { config: updated } = await updateAutomationConfig({ logs: nextLogs }, { syncCloud: true });

  return {
    entry,
    logs: updated.logs,
  };
}

export async function clearAutomationLogs() {
  const { config: updated, cloud_synced } = await updateAutomationConfig(
    { logs: [] },
    { syncCloud: true }
  );
  return {
    config: updated,
    cloud_synced,
  };
}
