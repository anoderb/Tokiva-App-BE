import { supabaseAdmin } from '../../lib/supabase.js';
import { config } from '../../config/env.js';
import { NotFound, BadRequest } from '../../utils/errors.js';

/**
 * Daftarkan / Sinkronkan Model dari Folder Storage Supabase ke Tabel ai_model
 */
export async function syncStorageModel(versi = 'v1.2.20260912', setAktif = false) {
  const publicBase = `${config.supabase.url}/storage/v1/object/public/ai-models/${versi}`;
  const modelJsonUrl = `${publicBase}/model.json`;
  const classJsonUrl = `${publicBase}/class.json`;
  const summaryJsonUrl = `${publicBase}/training_summary.json`;
  const embMetaUrl = `${publicBase}/embedding_meta.json`;
  const centroidsUrl = `${publicBase}/class_centroids.json`;

  let summary = {};
  try {
    const sumRes = await fetch(summaryJsonUrl);
    if (sumRes.ok) summary = await sumRes.json();
  } catch { }

  let embMeta = null;
  try {
    const embRes = await fetch(embMetaUrl);
    if (embRes.ok) embMeta = await embRes.json();
  } catch { }

  let hasCentroids = false;
  try {
    const centRes = await fetch(centroidsUrl, { method: 'HEAD' });
    hasCentroids = centRes.ok;
  } catch { }

  let classCount = 24;
  try {
    const clsRes = await fetch(classJsonUrl);
    if (clsRes.ok) classCount = Object.keys(await clsRes.json()).length;
  } catch { }

  const isV2 =
    String(versi).toLowerCase().startsWith('v2.') ||
    summary.model_family === 'v2' ||
    Boolean(summary.mendukung_embedding) ||
    Boolean(embMeta?.mendukung_embedding) ||
    hasCentroids;

  const modelPayload = {
    versi,
    nama_model: summary.best_experiment
      ? `Tokiva ${isV2 ? 'v2 ' : ''}${summary.best_experiment}`
      : `Tokiva MobileNetV3 ${versi}`,
    arsitektur: summary.best_experiment ? summary.best_experiment.replace(/^E\d+_/, '') : 'MobileNetV3-Large',
    model_family: isV2 ? 'v2' : 'v1',
    mendukung_embedding: isV2,
    dimensi_embedding: isV2 ? Number(embMeta?.dimensi_embedding || summary.dimensi_embedding || 256) : null,
    path_centroids: hasCentroids ? centroidsUrl : null,
    path_embedding_meta: embMeta ? embMetaUrl : null,
    path_model_json: modelJsonUrl,
    path_bobot_bin: `${publicBase}/group1-shard1of3.bin,${publicBase}/group1-shard2of3.bin,${publicBase}/group1-shard3of3.bin`,
    path_label: classJsonUrl,
    ukuran_model_mb: 11.6,
    jml_kelas: summary.num_classes || classCount,
    akurasi_top1: summary.accuracy ? Number(summary.accuracy.toFixed(4)) : 0.9944,
    akurasi_top5: summary.auc_macro_ovr ? Number(summary.auc_macro_ovr.toFixed(4)) : 0.9995,
    f1_score: summary.f1_macro ? Number(summary.f1_macro.toFixed(4)) : 0.9944,
    latensi_ms: summary.inference_ms ? Number(summary.inference_ms.toFixed(2)) : 5.62,
    aktif: setAktif,
    tgl_rilis: new Date().toISOString(),
  };

  if (setAktif) {
    await supabaseAdmin.from('ai_model').update({ aktif: false }).neq('versi', versi);
  }

  const { data: existing } = await supabaseAdmin.from('ai_model').select('id').eq('versi', versi).maybeSingle();
  const query = existing
    ? supabaseAdmin.from('ai_model').update(modelPayload).eq('id', existing.id)
    : supabaseAdmin.from('ai_model').insert(modelPayload);

  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

/**
 * Register / Upload Model TFJS Baru Secara Manual
 */
export async function registerManualModel(payload = {}) {
  const {
    versi,
    nama_model,
    arsitektur = 'MobileNetV3-Large + CBAM',
    akurasi_top1 = 0.99,
    f1_score = 0.99,
    ukuran_model_mb = 12.5,
    jml_kelas = 24,
    latensi_ms = 5.6,
    path_model_json,
    path_bobot_bin,
    path_label,
    model_family,
    mendukung_embedding,
    dimensi_embedding,
    path_centroids,
    path_embedding_meta,
    setAktif = false,
    aktif = false,
  } = payload;

  if (!versi || !String(versi).trim()) {
    throw new BadRequest('Versi model wajib diisi');
  }

  const shouldActivate = Boolean(setAktif || aktif);
  const versiClean = String(versi).trim();
  const publicBase = `${config.supabase.url}/storage/v1/object/public/ai-models/${versiClean}`;
  const isV2 =
    String(model_family || '').toLowerCase() === 'v2' ||
    Boolean(mendukung_embedding) ||
    versiClean.toLowerCase().startsWith('v2.');

  const insertPayload = {
    versi: versiClean,
    nama_model: nama_model || `Tokiva ${arsitektur} (${versiClean})`,
    arsitektur,
    model_family: isV2 ? 'v2' : 'v1',
    mendukung_embedding: isV2,
    dimensi_embedding: isV2 ? Number(dimensi_embedding) || 256 : null,
    path_centroids: path_centroids || (isV2 ? `${publicBase}/class_centroids.json` : null),
    path_embedding_meta: path_embedding_meta || (isV2 ? `${publicBase}/embedding_meta.json` : null),
    path_model_json: path_model_json || `${publicBase}/model.json`,
    path_bobot_bin: path_bobot_bin || `${publicBase}/group1-shard1of3.bin`,
    path_label: path_label || `${publicBase}/class.json`,
    ukuran_model_mb: Number(ukuran_model_mb) || 12.0,
    jml_kelas: Number(jml_kelas) || 24,
    akurasi_top1: Number(akurasi_top1) > 1 ? Number(akurasi_top1) / 100 : Number(akurasi_top1),
    akurasi_top5: 0.999,
    f1_score: Number(f1_score) > 1 ? Number(f1_score) / 100 : Number(f1_score),
    latensi_ms: Number(latensi_ms) || 5.8,
    aktif: shouldActivate,
    tgl_rilis: new Date().toISOString(),
  };

  if (shouldActivate) {
    await supabaseAdmin.from('ai_model').update({ aktif: false }).neq('versi', versiClean);
  }

  const { data: existing } = await supabaseAdmin.from('ai_model').select('id').eq('versi', versiClean).maybeSingle();
  const query = existing
    ? supabaseAdmin.from('ai_model').update(insertPayload).eq('id', existing.id)
    : supabaseAdmin.from('ai_model').insert(insertPayload);

  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

/**
 * Hapus Versi Model Non-Aktif
 */
export async function deleteModel(idOrVersi) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(idOrVersi || ''));
  let query = supabaseAdmin.from('ai_model').select('*');
  query = isUuid ? query.eq('id', idOrVersi) : query.eq('versi', idOrVersi);
  const { data: target, error: findErr } = await query.maybeSingle();

  if (findErr) throw findErr;
  if (!target) throw new NotFound('Model AI tidak ditemukan');
  if (target.aktif) {
    throw new BadRequest('Model yang sedang LIVE AKTIF tidak dapat dihapus. Aktifkan versi lain terlebih dahulu.');
  }

  const { error: delErr } = await supabaseAdmin.from('ai_model').delete().eq('id', target.id);
  if (delErr) throw delErr;

  return { deleted: true, versi: target.versi };
}
