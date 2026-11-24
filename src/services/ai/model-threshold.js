import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const THRESHOLD_FILE = path.join(__dirname, '../../../kaggle/threshold-config.json');
const THRESHOLD_CLOUD_BUCKET = 'ai-models';
const THRESHOLD_CLOUD_PATH = '_config/threshold-config.json';

let thresholdMemoryCache = null;

function defaultThresholdConfig() {
  return {
    high_threshold: 75,
    medium_threshold: 25,
    auto_add_high_confidence: true,
    show_top3_candidates: true,
    fallback_barcode_on_low: true,
    updated_at: new Date().toISOString(),
  };
}

/** Menginisialisasi konfigurasi ambang kepercayaan AI dari file lokal atau cloud storage. */
export async function initThresholdConfigFromCloud() {
  try {
    if (fs.existsSync(THRESHOLD_FILE)) {
      thresholdMemoryCache = JSON.parse(fs.readFileSync(THRESHOLD_FILE, 'utf-8'));
      return thresholdMemoryCache;
    }
    const { data, error } = await supabaseAdmin.storage
      .from(THRESHOLD_CLOUD_BUCKET)
      .download(THRESHOLD_CLOUD_PATH);
    if (!error && data) {
      const text = await data.text();
      if (text.trim()) {
        const parsed = JSON.parse(text);
        thresholdMemoryCache = parsed;
        try {
          fs.mkdirSync(path.dirname(THRESHOLD_FILE), { recursive: true });
          fs.writeFileSync(THRESHOLD_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
        } catch { }
        return parsed;
      }
    }
  } catch { }
  return getThresholdConfig();
}

export function getThresholdConfig() {
  if (thresholdMemoryCache) return thresholdMemoryCache;
  try {
    if (fs.existsSync(THRESHOLD_FILE)) {
      thresholdMemoryCache = JSON.parse(fs.readFileSync(THRESHOLD_FILE, 'utf-8'));
      return thresholdMemoryCache;
    }
  } catch { }
  return defaultThresholdConfig();
}

/** Memperbarui ambang confidence AI dan menyimpannya ke disk & Supabase Storage. */
export function updateThresholdConfig(payload = {}) {
  const current = getThresholdConfig();
  const high =
    payload.high_threshold !== undefined
      ? Math.min(99, Math.max(50, Number(payload.high_threshold)))
      : current.high_threshold;
  const medium =
    payload.medium_threshold !== undefined
      ? Math.min(high - 5, Math.max(5, Number(payload.medium_threshold)))
      : current.medium_threshold;

  const updated = {
    ...current,
    ...payload,
    high_threshold: high,
    medium_threshold: medium,
    updated_at: new Date().toISOString(),
  };
  thresholdMemoryCache = updated;
  try {
    fs.mkdirSync(path.dirname(THRESHOLD_FILE), { recursive: true });
    fs.writeFileSync(THRESHOLD_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch { }

  Promise.resolve(
    supabaseAdmin.storage
      .from(THRESHOLD_CLOUD_BUCKET)
      .upload(THRESHOLD_CLOUD_PATH, Buffer.from(JSON.stringify(updated, null, 2), 'utf-8'), {
        contentType: 'application/json',
        upsert: true,
      })
  ).catch(() => {});

  return updated;
}
