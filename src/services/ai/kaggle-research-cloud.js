import fs from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../../lib/supabase.js';
import { STORAGE_BUCKET, parseCsvFile } from './kaggle-config.js';

export const RESEARCH_CLOUD_PREFIX = '_research';
export const RESEARCH_INDEX_PATH = '_research/index.json';
const MAX_CLOUD_RUNS = 20;
const CACHE_TTL_MS = 60_000;
const SUMMARY_ROW_NAMES = new Set(['accuracy', 'macro avg', 'weighted avg', 'micro avg']);

let cloudIndexCache = { data: null, expiresAt: 0 };
const cloudSummaryCache = new Map();

export function invalidateCloudResearchCache() {
  cloudIndexCache = { data: null, expiresAt: 0 };
  cloudSummaryCache.clear();
}

export function normalizeErrorSummaryRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => (r.true_label || r.true_class) && Number(r.total_errors ?? r.count ?? 0) > 0)
    .map((r) => {
      const trueLabel = String(r.true_label || r.true_class || '').trim();
      const predLabel = String(r.most_confused_with || r.predicted_class || '').trim();
      const errCount = Number(r.total_errors ?? r.count ?? 0);
      return {
        true_label: trueLabel,
        true_class: trueLabel,
        total_errors: errCount,
        count: errCount,
        most_confused_with: predLabel,
        predicted_class: predLabel,
        most_confused_count: Number(r.most_confused_count ?? errCount),
        avg_confidence: r.avg_confidence != null && r.avg_confidence !== '' ? Number(r.avg_confidence) : null,
      };
    });
}

function normalizeClassificationReportRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      class_name: String(r.class_name ?? r.Class ?? r.col_0 ?? '').trim(),
      precision: Number(r.precision ?? 0),
      recall: Number(r.recall ?? 0),
      f1_score: Number(r['f1-score'] ?? r.f1_score ?? 0),
      support: Number(r.support ?? 0),
    }))
    .filter((r) => r.class_name && !SUMMARY_ROW_NAMES.has(r.class_name.toLowerCase()));
}

function toNumOrNull(val) {
  return val != null && val !== '' && !Number.isNaN(Number(val)) ? Number(val) : null;
}

/** Ekstrak payload riset ringan dari folder lokal Research_POS (tanpa raw dataset_split.csv). */
export function buildResearchPayloadFromDir(researchDir, { runId = 'default', label = null, plotUrls = {} } = {}) {
  const summaryPath = path.join(researchDir, 'FINAL_MODEL', 'training_summary.json');
  let summary = {};
  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch {}
  }

  const readExp = (expName, fallback = {}) => {
    const expRoot = path.join(researchDir, 'EXPERIMENT', expName);
    const history = parseCsvFile(path.join(expRoot, 'history', 'history.csv'));
    const rawErrors = parseCsvFile(path.join(expRoot, 'confusion_matrix', 'error_summary.csv'));
    const rawReport = parseCsvFile(path.join(expRoot, 'report', 'classification_report.csv'));
    const misclassified = parseCsvFile(path.join(expRoot, 'report', 'misclassified.csv'));
    return {
      history: history.length > 0 ? history : fallback.training_history || [],
      error_summary: normalizeErrorSummaryRows(rawErrors.length > 0 ? rawErrors : fallback.error_summary || []),
      classification_report: normalizeClassificationReportRows(rawReport),
      misclassified: misclassified.length > 0 ? misclassified : fallback.misclassified_samples || [],
    };
  };

  const e1Detail = readExp('E1_MobileNetV3', summary.best_experiment === 'E1_MobileNetV3' ? summary : {});
  const e2Detail = readExp('E2_MobileNetV3_CBAM', summary.best_experiment === 'E2_MobileNetV3_CBAM' ? summary : {});

  const splitRows = parseCsvFile(path.join(researchDir, 'DATA_REPORT', 'dataset_split.csv'));
  const splitCounts = { train: 0, val: 0, test: 0, total: splitRows.length };
  for (const r of splitRows) {
    const s = String(r.split || '').toLowerCase();
    if (s === 'train') splitCounts.train++;
    else if (s === 'val' || s === 'validation') splitCounts.val++;
    else if (s === 'test') splitCounts.test++;
  }

  const rawComparison = parseCsvFile(path.join(researchDir, 'COMPARISON', 'comparison_table.csv'));
  const detailMap = { E1_MobileNetV3: e1Detail, E2_MobileNetV3_CBAM: e2Detail };
  const comparison = rawComparison.map((row) => {
    const expName = String(row.experiment || row.Experiment || '');
    const detail = detailMap[expName] || { classification_report: [], misclassified: [] };
    const reportSupport = detail.classification_report.reduce((acc, r) => acc + (Number(r.support) || 0), 0);
    const testImages = toNumOrNull(row.num_test_images) ?? (reportSupport || splitCounts.test || summary.num_test_images || 0);
    const misclassifiedCount = toNumOrNull(row.num_misclassified) ?? detail.misclassified.length;
    return {
      experiment: expName,
      architecture:
        row.architecture ||
        row.Arsitektur ||
        (expName === 'E2_MobileNetV3_CBAM' ? 'MobileNetV3-Large + CBAM Attention' : 'MobileNetV3-Large (Baseline)'),
      accuracy: toNumOrNull(row.accuracy),
      precision_macro: toNumOrNull(row.precision_macro),
      recall_macro: toNumOrNull(row.recall_macro),
      f1_macro: toNumOrNull(row.f1_macro),
      top5_accuracy: toNumOrNull(row.top5_accuracy),
      inference_time_per_image_ms: toNumOrNull(row.inference_time_per_image_ms),
      inference_single_image_ms: toNumOrNull(row.inference_single_image_ms),
      fps: toNumOrNull(row.fps),
      parameters: toNumOrNull(row.parameters),
      trainable_parameters: toNumOrNull(row.trainable_parameters),
      non_trainable_parameters: toNumOrNull(row.non_trainable_parameters),
      training_time_seconds: toNumOrNull(row.training_time_seconds),
      best_epoch: toNumOrNull(row.best_epoch),
      best_val_accuracy: toNumOrNull(row.best_val_accuracy),
      model_size_mb_keras: toNumOrNull(row.model_size_mb_keras),
      model_size_mb_tflite: toNumOrNull(row.model_size_mb_tflite),
      model_size_mb_tensorflowjs: toNumOrNull(row.model_size_mb_tensorflowjs),
      num_misclassified: misclassifiedCount,
      num_test_images: testImages,
    };
  });

  const numClasses = e1Detail.classification_report.length || e2Detail.classification_report.length || summary.num_classes || 0;
  const bestExperiment = summary.best_experiment || comparison[0]?.experiment || null;
  const generatedAt = summary.generated_at || new Date().toISOString();
  const baseLabel = label || (runId === 'default' ? 'Baseline Riset (Research_POS)' : runId);
  const fullLabel = [numClasses ? `${numClasses} kelas` : null, bestExperiment].filter(Boolean).join(' • ');

  return {
    run_id: runId,
    run_label: fullLabel && !String(baseLabel).includes('kelas') ? `${baseLabel} (${fullLabel})` : baseLabel,
    generated_at: generatedAt,
    num_classes: numClasses,
    best_experiment: bestExperiment,
    dataset_split: splitCounts,
    summary: { ...summary, error_summary: normalizeErrorSummaryRows(summary.error_summary || []) },
    comparison,
    experiments_detail: { E1_MobileNetV3: e1Detail, E2_MobileNetV3_CBAM: e2Detail },
    plot_urls: plotUrls,
  };
}

async function downloadJsonFromStorage(cloudPath, storageClient) {
  try {
    const { data, error } = await storageClient.from(STORAGE_BUCKET).download(cloudPath);
    if (error || !data) return null;
    const text = await data.text();
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function listCloudResearchRuns({ forceRefresh = false, storageClient = supabaseAdmin.storage } = {}) {
  if (!forceRefresh && cloudIndexCache.data && cloudIndexCache.expiresAt > Date.now()) {
    return cloudIndexCache.data;
  }
  const indexData = await downloadJsonFromStorage(RESEARCH_INDEX_PATH, storageClient);
  const runs = Array.isArray(indexData) ? indexData : [];
  cloudIndexCache = { data: runs, expiresAt: Date.now() + CACHE_TTL_MS };
  return runs;
}

export async function fetchCloudResearchSummary(runId = null, { forceRefresh = false, storageClient = supabaseAdmin.storage } = {}) {
  const runs = await listCloudResearchRuns({ forceRefresh, storageClient });
  if (runs.length === 0) return null;
  const target = (runId && runs.find((r) => r.run_id === runId)) || runs[0];
  const cached = !forceRefresh ? cloudSummaryCache.get(target.run_id) : null;
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, available_runs: runs };
  }
  const summaryPath = target.summary_path || `${RESEARCH_CLOUD_PREFIX}/${target.run_id}/summary.json`;
  const summaryData = await downloadJsonFromStorage(summaryPath, storageClient);
  if (!summaryData) return null;
  cloudSummaryCache.set(target.run_id, { data: summaryData, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...summaryData, available_runs: runs };
}

/** Mengunggah metrik evaluasi riset (summary.json + 4 plot PNG) ke Supabase Storage bucket ai-models. */
export async function uploadResearchBundleToCloud(
  researchDir,
  { runId = 'default', label = null, storageClient = supabaseAdmin.storage } = {}
) {
  const safeRunId = String(runId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_') || 'default';
  const plotSpecs = [
    ['E1_MobileNetV3', 'confusion_matrix', path.join('EXPERIMENT', 'E1_MobileNetV3', 'confusion_matrix', 'confusion_matrix.png')],
    ['E1_MobileNetV3', 'training_history', path.join('EXPERIMENT', 'E1_MobileNetV3', 'plots', 'training_history.png')],
    ['E2_MobileNetV3_CBAM', 'confusion_matrix', path.join('EXPERIMENT', 'E2_MobileNetV3_CBAM', 'confusion_matrix', 'confusion_matrix.png')],
    ['E2_MobileNetV3_CBAM', 'training_history', path.join('EXPERIMENT', 'E2_MobileNetV3_CBAM', 'plots', 'training_history.png')],
  ];

  const plotUrls = {};
  for (const [exp, type, relPath] of plotSpecs) {
    const fullPlotPath = path.join(researchDir, relPath);
    if (!fs.existsSync(fullPlotPath)) continue;
    const cloudPlotPath = `${RESEARCH_CLOUD_PREFIX}/${safeRunId}/plots/${exp}_${type}.png`;
    const { error: upErr } = await storageClient
      .from(STORAGE_BUCKET)
      .upload(cloudPlotPath, fs.readFileSync(fullPlotPath), { contentType: 'image/png', cacheControl: '3600', upsert: true });
    if (upErr) throw new Error(`Gagal upload plot ${cloudPlotPath}: ${upErr.message}`);
    const { data: pub } = storageClient.from(STORAGE_BUCKET).getPublicUrl(cloudPlotPath);
    if (!plotUrls[exp]) plotUrls[exp] = {};
    plotUrls[exp][type] = pub?.publicUrl || null;
  }

  const payload = buildResearchPayloadFromDir(researchDir, { runId: safeRunId, label, plotUrls });
  const summaryPath = `${RESEARCH_CLOUD_PREFIX}/${safeRunId}/summary.json`;
  const { error: sumErr } = await storageClient
    .from(STORAGE_BUCKET)
    .upload(summaryPath, Buffer.from(JSON.stringify(payload), 'utf-8'), {
      contentType: 'application/json',
      cacheControl: '60',
      upsert: true,
    });
  if (sumErr) throw new Error(`Gagal upload summary riset: ${sumErr.message}`);

  const { data: sumPub } = storageClient.from(STORAGE_BUCKET).getPublicUrl(summaryPath);
  const existingRuns = await listCloudResearchRuns({ forceRefresh: true, storageClient });
  const nextEntry = {
    run_id: safeRunId,
    label: payload.run_label,
    generated_at: payload.generated_at,
    num_classes: payload.num_classes,
    best_experiment: payload.best_experiment,
    summary_path: summaryPath,
    plot_urls: plotUrls,
  };
  const nextIndex = [nextEntry, ...existingRuns.filter((r) => r.run_id !== safeRunId)].slice(0, MAX_CLOUD_RUNS);
  const { error: idxErr } = await storageClient
    .from(STORAGE_BUCKET)
    .upload(RESEARCH_INDEX_PATH, Buffer.from(JSON.stringify(nextIndex, null, 2), 'utf-8'), {
      contentType: 'application/json',
      cacheControl: '0',
      upsert: true,
    });
  if (idxErr) throw new Error(`Gagal memperbarui indeks riset cloud: ${idxErr.message}`);

  invalidateCloudResearchCache();
  return {
    run_id: safeRunId,
    summary_url: sumPub?.publicUrl || null,
    plot_urls: plotUrls,
    num_classes: payload.num_classes,
    best_experiment: payload.best_experiment,
  };
}
