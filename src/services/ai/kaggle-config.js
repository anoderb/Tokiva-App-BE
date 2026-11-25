import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const KAGGLE_ROOT = path.join(__dirname, '../../../kaggle');
export const NOTEBOOK_PATH = path.join(KAGGLE_ROOT, 'model-training-fix-mobilenet-cbam.ipynb');
export const NOTEBOOK_PATH_V2 = path.join(KAGGLE_ROOT, 'model-training-v2-hybrid-embedding.ipynb');
export const SYNC_NOTEBOOK_PATH = path.join(KAGGLE_ROOT, 'sync-hf-to-kaggle-dataset.ipynb');
export const LEGACY_KERNEL_OUTPUT_DIR = path.join(KAGGLE_ROOT, 'kernel-output');

export const KAGGLE_TEMP_ROOT = process.env.KAGGLE_WORK_DIR
  ? path.resolve(process.env.KAGGLE_WORK_DIR)
  : path.join(os.tmpdir(), 'tokiva-kaggle');
export const KERNEL_PUSH_DIR = path.join(KAGGLE_TEMP_ROOT, 'kernel-push');
export const KERNEL_OUTPUT_DIR = path.join(KAGGLE_TEMP_ROOT, 'kernel-output');
export const STATE_FILE = path.join(KAGGLE_TEMP_ROOT, 'training-state.json');

export const KERNEL_PUSH_DIR_V2 = path.join(KAGGLE_TEMP_ROOT, 'kernel-push-v2');
export const KERNEL_OUTPUT_DIR_V2 = path.join(KAGGLE_TEMP_ROOT, 'kernel-output-v2');
export const STATE_FILE_V2 = path.join(KAGGLE_TEMP_ROOT, 'training-state-v2.json');

export const SYNC_PUSH_DIR = path.join(KAGGLE_TEMP_ROOT, 'sync-kernel-push');
export const SYNC_OUTPUT_DIR = path.join(KAGGLE_TEMP_ROOT, 'sync-kernel-output');
export const SYNC_STATE_FILE = path.join(KAGGLE_TEMP_ROOT, 'dataset-sync-state.json');

const LEGACY_STATE_FILE = path.join(KAGGLE_ROOT, 'training-state.json');
const LEGACY_STATE_FILE_V2 = path.join(KAGGLE_ROOT, 'training-state-v2.json');
const LEGACY_SYNC_STATE_FILE = path.join(KAGGLE_ROOT, 'dataset-sync-state.json');

const KAGGLE_OWNER = config.kaggle.username || '';
const qualifyKaggleSlug = (slug) => (KAGGLE_OWNER ? `${KAGGLE_OWNER}/${slug}` : '');

export const KERNEL_SLUG = config.kaggle.kernelSlug || 'tokiva-training-mobilenetv3-cbam';
export const KERNEL_ID = qualifyKaggleSlug(KERNEL_SLUG);
export const KAGGLE_URL = KERNEL_ID ? `https://www.kaggle.com/code/${KERNEL_ID}` : '';

export const KERNEL_SLUG_V2 = config.kaggle.kernelSlugV2 || 'tokiva-training-mobilenetv3-cbam-v2';
export const KERNEL_ID_V2 = qualifyKaggleSlug(KERNEL_SLUG_V2);
export const KAGGLE_URL_V2 = KERNEL_ID_V2 ? `https://www.kaggle.com/code/${KERNEL_ID_V2}` : '';

export const SYNC_KERNEL_SLUG = config.kaggle.syncKernelSlug || 'tokiva-sync-hf-dataset';
export const SYNC_KERNEL_ID = qualifyKaggleSlug(SYNC_KERNEL_SLUG);
export const SYNC_KAGGLE_URL = SYNC_KERNEL_ID ? `https://www.kaggle.com/code/${SYNC_KERNEL_ID}` : '';

export const DATASET_SLUG = config.kaggle.datasetSlug || 'tokiva-pos-dataset';
export const DATASET_ID = qualifyKaggleSlug(DATASET_SLUG);
export const DATASET_KAGGLE_URL = DATASET_ID ? `https://www.kaggle.com/datasets/${DATASET_ID}` : '';

export const STORAGE_BUCKET = 'ai-models';
const CLOUD_TRAINING_STATE_PATH = 'config/training-state.json';
const CLOUD_TRAINING_STATE_PATH_V2 = 'config/training-state-v2.json';
const CLOUD_SYNC_STATE_PATH = 'config/dataset-sync-state.json';

export const EXPERIMENT_NAME_MAP = {
  E1_MobileNetV3: 'Tokiva E1_MobileNetV3',
  E2_MobileNetV3_CBAM: 'Tokiva E2_MobileNetV3_CBAM',
  E1_MobileNetV3_Embed: 'Tokiva v2 E1_MobileNetV3_Embed',
  E2_MobileNetV3_CBAM_Embed: 'Tokiva v2 E2_MobileNetV3_CBAM_Embed',
  E1_MobileNetV2: 'Tokiva E1_MobileNetV2',
  E2_MobileNetV2_CBAM: 'Tokiva E2_MobileNetV2_CBAM',
};

const trainingStateCacheByTrack = { v1: null, v2: null };
let syncStateCache = null;

/** Normalisasi identifier track model AI ('v1' | 'v2'). */
export function normalizeTrack(track = 'v1') {
  return String(track || 'v1').trim().toLowerCase() === 'v2' ? 'v2' : 'v1';
}

/** Mengembalikan konfigurasi notebook, kernel slug, direktori, dan state terisolasi per track. */
export function getTrackConfig(track = 'v1') {
  const normalized = normalizeTrack(track);
  if (normalized === 'v2') {
    return {
      track: 'v2',
      notebookPath: NOTEBOOK_PATH_V2,
      notebookFileName: 'model-training-v2-hybrid-embedding.ipynb',
      kernelSlug: KERNEL_SLUG_V2,
      kernelId: KERNEL_ID_V2,
      kaggleUrl: KAGGLE_URL_V2,
      pushDir: KERNEL_PUSH_DIR_V2,
      outputDir: KERNEL_OUTPUT_DIR_V2,
      stateFile: STATE_FILE_V2,
      legacyStateFile: LEGACY_STATE_FILE_V2,
      cloudStatePath: CLOUD_TRAINING_STATE_PATH_V2,
      versionPrefix: 'v2',
    };
  }
  return {
    track: 'v1',
    notebookPath: NOTEBOOK_PATH,
    notebookFileName: 'model-training-fix-mobilenet-cbam.ipynb',
    kernelSlug: KERNEL_SLUG,
    kernelId: KERNEL_ID,
    kaggleUrl: KAGGLE_URL,
    pushDir: KERNEL_PUSH_DIR,
    outputDir: KERNEL_OUTPUT_DIR,
    stateFile: STATE_FILE,
    legacyStateFile: LEGACY_STATE_FILE,
    cloudStatePath: CLOUD_TRAINING_STATE_PATH,
    versionPrefix: 'v1',
  };
}

function cloneState(obj) {
  return JSON.parse(JSON.stringify(obj || { current: null, history: [] }));
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

/** Menghapus direktori sementara hanya jika berada aman di dalam KAGGLE_TEMP_ROOT. */
export function cleanupTempDir(dirPath) {
  if (!dirPath) return false;
  const resolvedRoot = path.resolve(KAGGLE_TEMP_ROOT);
  const resolvedTarget = path.resolve(dirPath);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return false;
  }
  try {
    if (fs.existsSync(resolvedTarget)) {
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
      return true;
    }
  } catch (err) {
    console.warn(`Gagal membersihkan direktori sementara ${resolvedTarget}:`, err.message);
  }
  return false;
}

export function readJsonState(filePath, fallbackPath = null) {
  for (const candidate of [filePath, fallbackPath].filter(Boolean)) {
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
    } catch { }
  }
  return { current: null, history: [] };
}

export function writeJsonState(filePath, state) {
  try {
    ensureDir(path.dirname(filePath));
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(`Gagal menyimpan ${path.basename(filePath)}:`, err.message);
  }
}

async function fetchCloudState(cloudPath, storageClient = supabaseAdmin.storage) {
  try {
    const { data, error } = await storageClient.from(STORAGE_BUCKET).download(cloudPath);
    if (!error && data) {
      const text = await data.text();
      if (text.trim()) return JSON.parse(text);
    }
  } catch { }
  return null;
}

function syncCloudStateAsync(cloudPath, state, storageClient = supabaseAdmin.storage) {
  Promise.resolve(
    storageClient
      .from(STORAGE_BUCKET)
      .upload(cloudPath, Buffer.from(JSON.stringify(state, null, 2), 'utf-8'), {
        contentType: 'application/json',
        cacheControl: '0',
        upsert: true,
      })
  ).catch((err) => {
    console.warn(`Gagal sinkronisasi ${cloudPath} ke Supabase Storage:`, err?.message || err);
  });
}

/** Muat status training & sync dataset Kaggle dari Supabase Storage saat startup server. */
export async function initKaggleStatesFromCloud(storageClient = supabaseAdmin.storage) {
  const [cloudTrainV1, cloudTrainV2, cloudSync] = await Promise.all([
    fetchCloudState(CLOUD_TRAINING_STATE_PATH, storageClient),
    fetchCloudState(CLOUD_TRAINING_STATE_PATH_V2, storageClient),
    fetchCloudState(CLOUD_SYNC_STATE_PATH, storageClient),
  ]);
  trainingStateCacheByTrack.v1 = cloudTrainV1 || readJsonState(STATE_FILE, LEGACY_STATE_FILE);
  trainingStateCacheByTrack.v2 = cloudTrainV2 || readJsonState(STATE_FILE_V2, LEGACY_STATE_FILE_V2);
  syncStateCache = cloudSync || readJsonState(SYNC_STATE_FILE, LEGACY_SYNC_STATE_FILE);
  return {
    training: cloneState(trainingStateCacheByTrack.v1),
    training_v2: cloneState(trainingStateCacheByTrack.v2),
    sync: cloneState(syncStateCache),
  };
}

  export function readTrainingState(track = 'v1') {
    const cfg = getTrackConfig(track);
    if (trainingStateCacheByTrack[cfg.track]) return cloneState(trainingStateCacheByTrack[cfg.track]);
    trainingStateCacheByTrack[cfg.track] = readJsonState(cfg.stateFile, cfg.legacyStateFile);
    return cloneState(trainingStateCacheByTrack[cfg.track]);
  }

    export function writeTrainingState(state, track = 'v1') {
      const cfg = getTrackConfig(track);
      const snapshot = cloneState(state);
      trainingStateCacheByTrack[cfg.track] = snapshot;
      writeJsonState(cfg.stateFile, snapshot);
      syncCloudStateAsync(cfg.cloudStatePath, snapshot);
    }

    export function readSyncState() {
      if (syncStateCache) return cloneState(syncStateCache);
      syncStateCache = readJsonState(SYNC_STATE_FILE, LEGACY_SYNC_STATE_FILE);
      return cloneState(syncStateCache);
    }

    export function writeSyncState(state) {
      const snapshot = cloneState(state);
      syncStateCache = snapshot;
      writeJsonState(SYNC_STATE_FILE, snapshot);
      syncCloudStateAsync(CLOUD_SYNC_STATE_PATH, snapshot);
    }

    export function getKaggleBasicAuth() {
      const { username, key } = config.kaggle;
      if (!username || !key) {
        throw new Error('KAGGLE_USERNAME dan KAGGLE_KEY belum dikonfigurasi di .env');
      }
      return Buffer.from(`${username}:${key}`).toString('base64');
    }

    export function listFilesRecursive(rootDir) {
      if (!fs.existsSync(rootDir)) return [];
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(fullPath);
          else files.push(fullPath);
        }
      };
      walk(rootDir);
      return files;
    }

    export function findArtifact(rootDir, filename, preferred = '') {
      const matches = listFilesRecursive(rootDir).filter(
        (filePath) => path.basename(filePath).toLowerCase() === filename.toLowerCase()
      );
      return (
        matches.find((filePath) => filePath.toLowerCase().includes(preferred.toLowerCase())) ||
        matches[0] ||
        null
      );
    }

    export function normalizeKaggleUrl(rawUrl, fallbackUrl) {
      if (!rawUrl) return fallbackUrl;
      const trimmed = String(rawUrl).trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
      return `https://www.kaggle.com${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
    }

    export function formatTimestamp(date = new Date(), withMinutes = true) {
      const d = new Date(date.getTime() + 7 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const base = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
      return withMinutes ? `${base}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}` : base;
    }

    export function parseCsvFile(filePath) {
      if (!filePath || !fs.existsSync(filePath)) return [];
      try {
        const lines = fs
          .readFileSync(filePath, 'utf-8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map((h) => h.trim());
        return lines.slice(1).map((line) => {
          const cols = line.split(',');
          const obj = {};
          headers.forEach((h, idx) => {
            const key = h || `col_${idx}`;
            const raw = cols[idx]?.trim() ?? '';
            const num = Number(raw);
            obj[key] = raw !== '' && !Number.isNaN(num) ? num : raw;
          });
          return obj;
        });
      } catch {
        return [];
      }
    }
