import cron from 'node-cron';
import { listCommits } from '@huggingface/hub';
import { config } from '../../config/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { kaggleService } from './kaggle.js';
import { getAutomationConfig } from './automation-store.js';

export function buildCronExpression({ mode, hour = 1, minute = 0, interval_hours = 6 } = {}) {
  const m = Math.min(59, Math.max(0, Number.parseInt(minute, 10) || 0));
  const h = Math.min(23, Math.max(0, Number.parseInt(hour, 10) || 0));
  const ih = Math.min(24, Math.max(1, Number.parseInt(interval_hours, 10) || 6));

  if (mode === 'daily') return `${m} ${h} * * *`;
  if (mode === 'interval') return `${m} */${ih} * * *`;
  return null;
}

export function validateCronExpression(expr) {
  return Boolean(expr && cron.validate(expr));
}

export async function getLatestHfHeadCommit() {
  if (!config.huggingFace.token || !config.huggingFace.datasetRepo) {
    return null;
  }

  try {
    const iterator = listCommits({
      repo: { type: 'dataset', name: config.huggingFace.datasetRepo },
      accessToken: config.huggingFace.token,
    });

    for await (const commit of iterator) {
      if (commit && commit.oid) {
        return {
          oid: commit.oid,
          title: commit.title || '',
          date: commit.date ? new Date(commit.date).toISOString() : null,
        };
      }
      break;
    }
    return null;
  } catch (err) {
    console.warn('⚠️ Gagal mengambil commit HEAD Hugging Face:', err?.message || err);
    return null;
  }
}

export async function getSupabaseSampleCounts() {
  try {
    const [pendingRes, hfRes] = await Promise.all([
      supabaseAdmin
        .from('ai_sampel')
        .select('id', { count: 'exact', head: true })
        .eq('terverifikasi', true)
        .neq('lokasi_simpan', 'huggingface'),
      supabaseAdmin
        .from('ai_sampel')
        .select('id', { count: 'exact', head: true })
        .eq('terverifikasi', true)
        .eq('lokasi_simpan', 'huggingface'),
    ]);

    return {
      pending_verified_supabase_samples: pendingRes.count ?? 0,
      total_hf_samples: hfRes.count ?? 0,
    };
  } catch (err) {
    console.warn('⚠️ Gagal menghitung metrik sampel Supabase:', err?.message || err);
    return {
      pending_verified_supabase_samples: 0,
      total_hf_samples: 0,
    };
  }
}

export async function getDeltaMetrics() {
  const cfg = getAutomationConfig();
  const [counts, latestHfCommit, kaggleDatasetExists] = await Promise.all([
    getSupabaseSampleCounts(),
    getLatestHfHeadCommit(),
    kaggleService.checkKaggleDatasetExists().catch(() => false),
  ]);

  const latestOid = latestHfCommit?.oid || null;
  const lastSyncedOid = cfg.dataset_sync.last_synced_hf_commit || null;
  const lastTrainedOid = cfg.training.last_trained_hf_commit || null;

  const hfCommitChangedForKaggle = Boolean(latestOid && latestOid !== lastSyncedOid);
  const hfCommitChangedForTraining = Boolean(latestOid && latestOid !== lastTrainedOid);
  const newSamplesSinceLastTrain = Math.max(
    0,
    counts.total_hf_samples - Number(cfg.training.last_trained_sample_count || 0)
  );
  const minNewSamples = Number(cfg.training.min_new_samples ?? 5);

  const hasHfChangesForKaggle =
    counts.pending_verified_supabase_samples > 0 ||
    !kaggleDatasetExists ||
    hfCommitChangedForKaggle;

  const hasDatasetChangesForTraining =
    minNewSamples === 0
      ? hfCommitChangedForTraining || newSamplesSinceLastTrain > 0
      : newSamplesSinceLastTrain >= minNewSamples ||
      (hfCommitChangedForTraining && counts.total_hf_samples >= minNewSamples && !lastTrainedOid);

  return {
    pending_verified_supabase_samples: counts.pending_verified_supabase_samples,
    total_hf_samples: counts.total_hf_samples,
    latest_hf_commit: latestHfCommit,
    last_synced_hf_commit: lastSyncedOid,
    last_trained_hf_commit: lastTrainedOid,
    kaggle_dataset_exists: Boolean(kaggleDatasetExists),
    hf_commit_changed_for_kaggle: hfCommitChangedForKaggle,
    hf_commit_changed_for_training: hfCommitChangedForTraining,
    has_hf_changes_for_kaggle: hasHfChangesForKaggle,
    has_dataset_changes_for_training: hasDatasetChangesForTraining,
    new_samples_since_last_train: newSamplesSinceLastTrain,
    min_new_samples: minNewSamples,
  };
}
