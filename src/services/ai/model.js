import { supabaseAdmin } from '../../lib/supabase.js';
import { config } from '../../config/env.js';
import { NotFound, Conflict } from '../../utils/errors.js';
import { kaggleService } from './kaggle.js';
import { promoteTrainedEmbeddings } from './embedding.js';
import {
  getThresholdConfig,
  initThresholdConfigFromCloud,
  updateThresholdConfig,
} from './model-threshold.js';
import { deleteModel, registerManualModel, syncStorageModel } from './model-registry.js';

export {
  initThresholdConfigFromCloud,
  getThresholdConfig,
  updateThresholdConfig,
  syncStorageModel,
  registerManualModel,
  deleteModel,
};

let ensuredExperimentModels = false;

/**
 * Ambil Model AI MobileNet yang Sedang Aktif untuk Inferensi Client TFJS di Kasir
 */
export async function getModelAktif() {
  let { data: activeModel, error } = await supabaseAdmin
    .from('ai_model')
    .select('*')
    .eq('aktif', true)
    .order('tgl_rilis', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!activeModel) activeModel = await syncStorageModel('v1.2.20260912', true);

  let labels = [];
  try {
    const classUrl =
      activeModel.path_label ||
      `${config.supabase.url}/storage/v1/object/public/ai-models/${activeModel.versi}/class.json`;
    const res = await fetch(classUrl);
    if (res.ok) {
      const classMap = await res.json();
      labels = Object.keys(classMap).sort((a, b) => Number(a) - Number(b)).map((k) => classMap[k]);
    }
  } catch {
    labels = [];
  }

  const thresholdCfg = getThresholdConfig();
  const modelJsonUrl =
    activeModel.path_model_json ||
    `${config.supabase.url}/storage/v1/object/public/ai-models/${activeModel.versi}/model.json`;
  const classJsonUrl =
    activeModel.path_label ||
    `${config.supabase.url}/storage/v1/object/public/ai-models/${activeModel.versi}/class.json`;

  return {
    ...activeModel,
    model_json_url: modelJsonUrl,
    class_json_url: classJsonUrl,
    model_url: modelJsonUrl,
    labels_url: classJsonUrl,
    daftar_kelas: labels,
    labels,
    confidence_threshold: Number((thresholdCfg.high_threshold / 100).toFixed(2)),
    threshold_config: thresholdCfg,
  };
}

/**
 * Daftar Seluruh Model AI yang Pernah Dilatih (Dilengkapi Ringkasan Training Asli)
 */
export async function listModels() {
  if (!ensuredExperimentModels) {
    ensuredExperimentModels = true;
    await kaggleService.ensureExperimentModelsRegistered().catch(() => {});
  }

  const { data, error } = await supabaseAdmin.from('ai_model').select('*').order('tgl_rilis', { ascending: false });
  if (error) throw error;

  const needsResearchFallback = (data || []).some((row) => !row.ringkasan_training);
  const research = needsResearchFallback ? await kaggleService.getResearchSummary().catch(() => null) : null;
  const thresholdCfg = getThresholdConfig();

  return (data || []).map((row) => {
    const isCbam =
      String(row.arsitektur || '').toLowerCase().includes('cbam') ||
      String(row.nama_model || '').toLowerCase().includes('cbam') ||
      String(row.versi || '').toLowerCase().includes('cbam');

    const expKey = isCbam ? 'E2_MobileNetV3_CBAM' : 'E1_MobileNetV3';
    const expComp = research?.comparison?.find((c) => c.experiment === expKey);
    const expDetail = research?.experiments_detail?.[expKey];

    const ringkasan = row.ringkasan_training || {
      best_experiment: expKey,
      accuracy: expComp?.accuracy ?? row.akurasi_top1,
      f1_macro: expComp?.f1_macro ?? row.f1_score,
      precision_macro: expComp?.precision_macro ?? null,
      recall_macro: expComp?.recall_macro ?? row.akurasi_top1,
      inference_ms: expComp?.inference_time_per_image_ms ?? row.latensi_ms,
      fps: expComp?.fps ?? null,
      parameters: expComp?.parameters ?? null,
      trainable_parameters: expComp?.trainable_parameters ?? null,
      best_epoch: expComp?.best_epoch ?? null,
      best_val_accuracy: expComp?.best_val_accuracy ?? null,
      training_time_s: expComp?.training_time_seconds ?? null,
      num_classes: row.jml_kelas || research?.num_classes || null,
      num_test_images: expComp?.num_test_images ?? research?.dataset_split?.test ?? null,
      num_misclassified: expComp?.num_misclassified ?? expDetail?.misclassified?.length ?? null,
      error_summary: expDetail?.error_summary || research?.summary?.error_summary || [],
      misclassified_samples: expDetail?.misclassified || research?.summary?.misclassified_samples || [],
      training_history: expDetail?.history || research?.summary?.training_history || [],
      classification_report: expDetail?.classification_report || [],
    };

    const modelJsonUrl =
      row.path_model_json ||
      `${config.supabase.url}/storage/v1/object/public/ai-models/${row.versi}/model.json`;
    const classJsonUrl =
      row.path_label ||
      `${config.supabase.url}/storage/v1/object/public/ai-models/${row.versi}/class.json`;

    return {
      ...row,
      model_json_url: modelJsonUrl,
      class_json_url: classJsonUrl,
      model_url: modelJsonUrl,
      labels_url: classJsonUrl,
      confidence_threshold: Number((thresholdCfg.high_threshold / 100).toFixed(2)),
      ringkasan_training: ringkasan,
    };
  });
}

/**
 * Aktifkan Versi Model Tertentu untuk Digunakan di Kasir
 */
export async function activateModel(versiOrId, versiOverride = null) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(versiOrId || ''));
  let query = supabaseAdmin.from('ai_model').select('id, versi');
  query = isUuid ? query.eq('id', versiOrId) : query.eq('versi', versiOrId);
  const { data: target, error: findErr } = await query.maybeSingle();

  if (findErr) throw findErr;
  if (!target) throw new NotFound(`Model '${versiOrId}' tidak ditemukan`);

  const trimmedOverride = versiOverride && String(versiOverride).trim() ? String(versiOverride).trim() : null;
  if (trimmedOverride && trimmedOverride !== target.versi) {
    const { data: clashModel, error: clashErr } = await supabaseAdmin
      .from('ai_model')
      .select('id, versi')
      .eq('versi', trimmedOverride)
      .neq('id', target.id)
      .maybeSingle();
    if (clashErr) throw clashErr;
    if (clashModel) throw new Conflict(`Versi model '${trimmedOverride}' sudah digunakan model lain`);
  }

  await supabaseAdmin.from('ai_model').update({ aktif: false }).neq('id', target.id);

  const updateData = { aktif: true };
  if (trimmedOverride) updateData.versi = trimmedOverride;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('ai_model')
    .update(updateData)
    .eq('id', target.id)
    .select()
    .single();

  if (updateErr) throw updateErr;

  if (updated?.mendukung_embedding || updated?.model_family === 'v2') {
    try {
      const classUrl =
        updated.path_label ||
        `${config.supabase.url}/storage/v1/object/public/ai-models/${updated.versi}/class.json`;
      const clsRes = await fetch(classUrl);
      if (clsRes.ok) {
        const parsed = await clsRes.json();
        const trainedLabels = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
        await promoteTrainedEmbeddings(updated.versi, trainedLabels);
      }
    } catch {
      // promotion is non-blocking
    }
  }

  return updated;
}
