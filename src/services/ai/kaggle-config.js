import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const KAGGLE_ROOT = path.join(__dirname, '../../../kaggle');
export const NOTEBOOK_PATH = path.join(KAGGLE_ROOT, 'model-training-fix-mobilenet-cbam.ipynb');
export const KERNEL_PUSH_DIR = path.join(KAGGLE_ROOT, 'kernel-push');
export const KERNEL_OUTPUT_DIR = path.join(KAGGLE_ROOT, 'kernel-output');
export const STATE_FILE = path.join(KAGGLE_ROOT, 'training-state.json');

export const SYNC_NOTEBOOK_PATH = path.join(KAGGLE_ROOT, 'sync-hf-to-kaggle-dataset.ipynb');
export const SYNC_PUSH_DIR = path.join(KAGGLE_ROOT, 'sync-kernel-push');
export const SYNC_OUTPUT_DIR = path.join(KAGGLE_ROOT, 'sync-kernel-output');
export const SYNC_STATE_FILE = path.join(KAGGLE_ROOT, 'dataset-sync-state.json');

const KAGGLE_OWNER = config.kaggle.username || '';
const qualifyKaggleSlug = (slug) => (KAGGLE_OWNER ? `${KAGGLE_OWNER}/${slug}` : '');

export const KERNEL_SLUG = config.kaggle.kernelSlug || 'tokiva-training-mobilenetv3-cbam';
export const KERNEL_ID = qualifyKaggleSlug(KERNEL_SLUG);
export const KAGGLE_URL = KERNEL_ID ? `https://www.kaggle.com/code/${KERNEL_ID}` : '';

export const SYNC_KERNEL_SLUG = config.kaggle.syncKernelSlug || 'tokiva-sync-hf-dataset';
export const SYNC_KERNEL_ID = qualifyKaggleSlug(SYNC_KERNEL_SLUG);
export const SYNC_KAGGLE_URL = SYNC_KERNEL_ID ? `https://www.kaggle.com/code/${SYNC_KERNEL_ID}` : '';

export const DATASET_SLUG = config.kaggle.datasetSlug || 'tokiva-pos-dataset';
export const DATASET_ID = qualifyKaggleSlug(DATASET_SLUG);
export const DATASET_KAGGLE_URL = DATASET_ID ? `https://www.kaggle.com/datasets/${DATASET_ID}` : '';

export const STORAGE_BUCKET = 'ai-models';

export const EXPERIMENT_NAME_MAP = {
  E1_MobileNetV3: 'Tokiva E1_MobileNetV3',
  E2_MobileNetV3_CBAM: 'Tokiva E2_MobileNetV3_CBAM',
  E1_MobileNetV2: 'Tokiva E1_MobileNetV2',
  E2_MobileNetV2_CBAM: 'Tokiva E2_MobileNetV2_CBAM',
};

for (const dir of [KAGGLE_ROOT, KERNEL_PUSH_DIR, KERNEL_OUTPUT_DIR, SYNC_PUSH_DIR, SYNC_OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readJsonState(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {}
  return { current: null, history: [] };
}

export function writeJsonState(filePath, state) {
  try {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn(`Gagal menyimpan ${path.basename(filePath)}:`, err.message);
  }
}

export const readTrainingState = () => readJsonState(STATE_FILE);
export const writeTrainingState = (state) => writeJsonState(STATE_FILE, state);
export const readSyncState = () => readJsonState(SYNC_STATE_FILE);
export const writeSyncState = (state) => writeJsonState(SYNC_STATE_FILE, state);

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
