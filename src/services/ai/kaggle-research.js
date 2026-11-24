import { config } from '../../config/env.js';
import {
  KERNEL_ID,
  KAGGLE_URL,
  SYNC_KERNEL_ID,
  SYNC_KAGGLE_URL,
  DATASET_ID,
  DATASET_KAGGLE_URL,
  readTrainingState,
} from './kaggle-config.js';
import { listResearchRuns, resolveResearchDir } from './kaggle-artifacts.js';
import { buildResearchPayloadFromDir, fetchCloudResearchSummary } from './kaggle-research-cloud.js';

function withLiveMeta(payload, source) {
  return {
    ...payload,
    source,
    kernel_id: KERNEL_ID,
    kaggle_url: KAGGLE_URL,
    sync_kernel_id: SYNC_KERNEL_ID,
    sync_kaggle_url: SYNC_KAGGLE_URL,
    dataset_id: DATASET_ID,
    dataset_url: DATASET_KAGGLE_URL,
    hf_repo: config.huggingFace.datasetRepo,
  };
}

/** Membaca ringkasan riset dari Supabase Storage terlebih dahulu dengan fallback disk lokal. */
export async function getResearchSummary(runId = null) {
  const cloud = await fetchCloudResearchSummary(runId);
  if (cloud && (Array.isArray(cloud.comparison) || cloud.summary)) {
    return withLiveMeta(cloud, 'supabase');
  }

  const runs = listResearchRuns();
  const resolved = resolveResearchDir(runId);
  const localPayload = buildResearchPayloadFromDir(resolved.dir, {
    runId: resolved.run_id,
    label: resolved.label,
    plotUrls: {},
  });

  return withLiveMeta(
    {
      ...localPayload,
      available_runs: runs.map(({ run_id, label, generated_at, num_classes, best_experiment }) => ({
        run_id,
        label,
        generated_at,
        num_classes,
        best_experiment,
      })),
    },
    'local'
  );
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
    created_at: research.summary?.generated_at || research.generated_at || '2026-09-12T13:06:34Z',
  }));

  return { current: state.current, runs: state.history || [], experiments: expHistory };
}
