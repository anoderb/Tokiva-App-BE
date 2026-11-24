import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/env.js';
import {
  KERNEL_ID,
  KAGGLE_URL,
  SYNC_KERNEL_ID,
  SYNC_KAGGLE_URL,
  DATASET_ID,
  DATASET_KAGGLE_URL,
  parseCsvFile,
  readTrainingState,
} from './kaggle-config.js';
import { listResearchRuns, resolveResearchDir } from './kaggle-artifacts.js';

const SUMMARY_ROW_NAMES = new Set(['accuracy', 'macro avg', 'weighted avg', 'micro avg']);

function normalizeErrorSummaryRows(rows) {
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

export async function getResearchSummary(runId = null) {
  const runs = listResearchRuns();
  const resolved = resolveResearchDir(runId);
  const researchDir = resolved.dir;

  const readExperimentArtifacts = (expName, fallbackSummary = {}) => {
    const expRoot = path.join(researchDir, 'EXPERIMENT', expName);
    const history = parseCsvFile(path.join(expRoot, 'history', 'history.csv'));
    const rawErrors = parseCsvFile(path.join(expRoot, 'confusion_matrix', 'error_summary.csv'));
    const rawReport = parseCsvFile(path.join(expRoot, 'report', 'classification_report.csv'));
    const misclassified = parseCsvFile(path.join(expRoot, 'report', 'misclassified.csv'));

    return {
      history: history.length > 0 ? history : fallbackSummary.training_history || [],
      error_summary: normalizeErrorSummaryRows(rawErrors.length > 0 ? rawErrors : fallbackSummary.error_summary || []),
      classification_report: normalizeClassificationReportRows(rawReport),
      misclassified: misclassified.length > 0 ? misclassified : fallbackSummary.misclassified_samples || [],
    };
  };

  const summaryPath = path.join(researchDir, 'FINAL_MODEL', 'training_summary.json');
  let summary = {};
  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch {}
  }

  const e1Detail = readExperimentArtifacts('E1_MobileNetV3', summary.best_experiment === 'E1_MobileNetV3' ? summary : {});
  const e2Detail = readExperimentArtifacts('E2_MobileNetV3_CBAM', summary.best_experiment === 'E2_MobileNetV3_CBAM' ? summary : {});

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
    const reportSupportSum = detail.classification_report.reduce((acc, r) => acc + (Number(r.support) || 0), 0);
    const testImages =
      row.num_test_images != null && row.num_test_images !== ''
        ? Number(row.num_test_images)
        : reportSupportSum || splitCounts.test || summary.num_test_images || 0;
    const misclassifiedCount =
      row.num_misclassified != null && row.num_misclassified !== '' ? Number(row.num_misclassified) : detail.misclassified.length;

    return {
      experiment: expName,
      architecture:
        row.architecture ||
        row.Arsitektur ||
        (expName === 'E2_MobileNetV3_CBAM' ? 'MobileNetV3-Large + CBAM Attention' : 'MobileNetV3-Large (Baseline)'),
      accuracy: row.accuracy != null ? Number(row.accuracy) : null,
      precision_macro: row.precision_macro != null ? Number(row.precision_macro) : null,
      recall_macro: row.recall_macro != null ? Number(row.recall_macro) : null,
      f1_macro: row.f1_macro != null ? Number(row.f1_macro) : null,
      top5_accuracy: row.top5_accuracy != null && row.top5_accuracy !== '' ? Number(row.top5_accuracy) : null,
      inference_time_per_image_ms: row.inference_time_per_image_ms != null ? Number(row.inference_time_per_image_ms) : null,
      inference_single_image_ms:
        row.inference_single_image_ms != null && row.inference_single_image_ms !== '' ? Number(row.inference_single_image_ms) : null,
      fps: row.fps != null ? Number(row.fps) : null,
      parameters: row.parameters != null ? Number(row.parameters) : null,
      trainable_parameters: row.trainable_parameters != null ? Number(row.trainable_parameters) : null,
      non_trainable_parameters: row.non_trainable_parameters != null ? Number(row.non_trainable_parameters) : null,
      training_time_seconds: row.training_time_seconds != null ? Number(row.training_time_seconds) : null,
      best_epoch: row.best_epoch != null ? Number(row.best_epoch) : null,
      best_val_accuracy: row.best_val_accuracy != null ? Number(row.best_val_accuracy) : null,
      model_size_mb_keras: row.model_size_mb_keras != null ? Number(row.model_size_mb_keras) : null,
      model_size_mb_tflite: row.model_size_mb_tflite != null ? Number(row.model_size_mb_tflite) : null,
      model_size_mb_tensorflowjs: row.model_size_mb_tensorflowjs != null ? Number(row.model_size_mb_tensorflowjs) : null,
      num_misclassified: misclassifiedCount,
      num_test_images: testImages,
    };
  });

  const inferredClasses = e1Detail.classification_report.length || e2Detail.classification_report.length || summary.num_classes || 0;

  return {
    run_id: resolved.run_id,
    run_label: resolved.label,
    available_runs: runs.map(({ run_id, label, generated_at, num_classes, best_experiment }) => ({
      run_id,
      label,
      generated_at,
      num_classes,
      best_experiment,
    })),
    kernel_id: KERNEL_ID,
    kaggle_url: KAGGLE_URL,
    sync_kernel_id: SYNC_KERNEL_ID,
    sync_kaggle_url: SYNC_KAGGLE_URL,
    dataset_id: DATASET_ID,
    dataset_url: DATASET_KAGGLE_URL,
    hf_repo: config.huggingFace.datasetRepo,
    num_classes: inferredClasses,
    best_experiment: summary.best_experiment || comparison[0]?.experiment || null,
    dataset_split: splitCounts,
    summary: { ...summary, error_summary: normalizeErrorSummaryRows(summary.error_summary || []) },
    comparison,
    experiments_detail: { E1_MobileNetV3: e1Detail, E2_MobileNetV3_CBAM: e2Detail },
  };
}

export async function getHistory() {
  const state = readTrainingState();
  const research = await getResearchSummary();
  const expHistory = (research.comparison || []).map((exp, idx) => ({
    id: `EXP-KAGGLE-${idx + 1}`,
    training_id: `EXP-KAGGLE-${idx + 1}`,
    experiment: exp.experiment,
    nama:
      exp.experiment === 'E2_MobileNetV3_CBAM'
        ? 'Enhanced MobileNetV3-Large + CBAM Attention Block'
        : 'Baseline MobileNetV3-Large Transfer Learning',
    arsitektur:
      exp.experiment === 'E2_MobileNetV3_CBAM'
        ? 'MobileNetV3-Large + CBAM (Spatial & Channel Attention)'
        : 'MobileNetV3-Large (Pretrained ImageNet)',
    status: 'complete',
    accuracy: exp.accuracy,
    precision_macro: exp.precision_macro,
    recall_macro: exp.recall_macro,
    f1_macro: exp.f1_macro,
    auc_macro_ovr: exp.auc_macro_ovr,
    inference_ms: exp.inference_time_per_image_ms,
    fps: exp.fps,
    parameters: exp.parameters,
    trainable_parameters: exp.trainable_parameters,
    training_time_s: exp.training_time_seconds,
    best_epoch: exp.best_epoch,
    best_val_accuracy: exp.best_val_accuracy,
    model_size_mb_tfjs: exp.model_size_mb_tensorflowjs,
    kaggle_url: KAGGLE_URL,
    created_at: research.summary?.generated_at || '2026-09-12T13:06:34Z',
  }));

  return { current: state.current, runs: state.history || [], experiments: expHistory };
}
