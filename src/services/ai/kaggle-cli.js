import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config/env.js';
import {
  getTrackConfig,
  KERNEL_SLUG,
  SYNC_NOTEBOOK_PATH,
  SYNC_PUSH_DIR,
  SYNC_OUTPUT_DIR,
  SYNC_KERNEL_SLUG,
  SYNC_KERNEL_ID,
  SYNC_KAGGLE_URL,
  DATASET_SLUG,
  DATASET_ID,
  ensureDir,
  cleanupTempDir,
  getKaggleBasicAuth,
  findArtifact,
  normalizeKaggleUrl,
} from './kaggle-config.js';

const execFileAsync = promisify(execFile);

/**
 * Sisipkan konfigurasi non-rahasia saja ke notebook; kredensial sensitif (HF_TOKEN, KAGGLE_KEY)
 * dibaca langsung dari Kaggle Secrets (kaggle_secrets.UserSecretsClient) di runner Kaggle.
 */
export function injectNotebookNonSecretConfig(notebookPath, replacements = {}) {
  const forbiddenKeys = new Set(['HF_TOKEN', 'KAGGLE_KEY']);
  const nb = JSON.parse(fs.readFileSync(notebookPath, 'utf-8'));
  for (const cell of nb.cells || []) {
    let src = (cell.source || []).join('');
    let modified = false;
    for (const [varName, value] of Object.entries(replacements)) {
      if (!value || forbiddenKeys.has(varName)) continue;
      const pattern = new RegExp(`os\\.environ\\.get\\(["']${varName}["'],\\s*["'][^"']*["']\\)`, 'g');
      if (pattern.test(src)) {
        src = src.replace(pattern, JSON.stringify(String(value)));
        modified = true;
      }
    }
    if (modified) cell.source = src.split(/(?<=\n)/);
  }
  fs.writeFileSync(notebookPath, JSON.stringify(nb, null, 1), 'utf-8');
}

function prepareNotebookWorkspace({ srcNotebook, pushDir, fileName, kernelId, kernelSlug, enableGpu, attachDataset }) {
  ensureDir(pushDir);
  const nbDest = path.join(pushDir, fileName);
  fs.copyFileSync(srcNotebook, nbDest);
  try {
    injectNotebookNonSecretConfig(nbDest, {
      HF_REPO_ID: config.huggingFace.datasetRepo || '',
      KAGGLE_USERNAME: config.kaggle.username || '',
      KAGGLE_DATASET_SLUG: DATASET_SLUG,
    });
  } catch (err) {
    console.warn(`Gagal menyuntikkan konfigurasi ke notebook ${kernelSlug}:`, err.message);
  }

  const metadata = {
    id: kernelId,
    title: kernelSlug,
    code_file: fileName,
    language: 'python',
    kernel_type: 'notebook',
    is_private: true,
    enable_gpu: Boolean(enableGpu),
    enable_tpu: false,
    enable_internet: true,
    dataset_sources: attachDataset ? [DATASET_ID] : [],
    kernel_sources: [],
    competition_sources: [],
    model_sources: [],
  };
  fs.writeFileSync(path.join(pushDir, 'kernel-metadata.json'), JSON.stringify(metadata, null, 2));
  return fs.readFileSync(nbDest, 'utf-8');
}

async function pushNotebookViaRestOrCli({
  notebookText,
  kernelId,
  kernelSlug,
  enableGpu,
  attachDataset,
  pushDir,
  defaultUrl,
  formatRestStdout,
}) {
  const authHeader = `Basic ${getKaggleBasicAuth()}`;
  let restRejection = null;
  try {
    try {
      const res = await fetch('https://www.kaggle.com/api/v1/kernels/push', {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: kernelId, newTitle: kernelSlug, text: notebookText,
          language: 'python', kernelType: 'notebook', isPrivate: true,
          enableGpu: Boolean(enableGpu), enableTpu: false, enableInternet: true,
          datasetDataSources: attachDataset ? [DATASET_ID] : [],
          competitionDataSources: [], kernelDataSources: [],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.error) restRejection = new Error(`Kaggle menolak push kernel (${kernelSlug}): ${json.error}`);
        else return { stdout: formatRestStdout(json), url: normalizeKaggleUrl(json.url, defaultUrl) };
      }
    } catch (apiErr) {
      console.warn(`Kaggle REST push fallback ke CLI (${kernelSlug}):`, apiErr.message);
    }
    if (restRejection) throw restRejection;

    const env = { ...process.env, KAGGLE_USERNAME: config.kaggle.username, KAGGLE_KEY: config.kaggle.key };
    const { stdout } = await execFileAsync('python', ['-m', 'kaggle', 'kernels', 'push', '-p', pushDir], {
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, url: defaultUrl };
  } finally {
    cleanupTempDir(pushDir);
  }
}

export async function checkKaggleDatasetExists() {
  try {
    const authHeader = `Basic ${getKaggleBasicAuth()}`;
    const url = `https://www.kaggle.com/api/v1/datasets/view/${encodeURIComponent(
      config.kaggle.username
    )}/${encodeURIComponent(DATASET_SLUG)}`;
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushKernelToKaggle(track = 'v1') {
  const trackCfg = getTrackConfig(track);
  const datasetReady = await checkKaggleDatasetExists();
  const notebookText = prepareNotebookWorkspace({
    srcNotebook: trackCfg.notebookPath,
    pushDir: trackCfg.pushDir,
    fileName: trackCfg.notebookFileName,
    kernelId: trackCfg.kernelId,
    kernelSlug: trackCfg.kernelSlug,
    enableGpu: true,
    attachDataset: datasetReady,
  });

  const pushed = await pushNotebookViaRestOrCli({
    notebookText,
    kernelId: trackCfg.kernelId,
    kernelSlug: trackCfg.kernelSlug,
    enableGpu: true,
    attachDataset: datasetReady,
    pushDir: trackCfg.pushDir,
    defaultUrl: trackCfg.kaggleUrl,
    formatRestStdout: (json) =>
      `Kernel ${trackCfg.kernelId} (${trackCfg.track}) berhasil di-push ke Kaggle (version ${json.versionNumber || 'latest'})`,
  });
  return { ...pushed, dataset_attached: datasetReady };
}

export async function pushSyncKernelToKaggle() {
  const notebookText = prepareNotebookWorkspace({
    srcNotebook: SYNC_NOTEBOOK_PATH,
    pushDir: SYNC_PUSH_DIR,
    fileName: 'sync-hf-to-kaggle-dataset.ipynb',
    kernelId: SYNC_KERNEL_ID,
    kernelSlug: SYNC_KERNEL_SLUG,
    enableGpu: false,
    attachDataset: false,
  });

  return pushNotebookViaRestOrCli({
    notebookText,
    kernelId: SYNC_KERNEL_ID,
    kernelSlug: SYNC_KERNEL_SLUG,
    enableGpu: false,
    attachDataset: false,
    pushDir: SYNC_PUSH_DIR,
    defaultUrl: SYNC_KAGGLE_URL,
    formatRestStdout: (json) => `Sync Kernel ${SYNC_KERNEL_ID} berhasil di-push ke Kaggle (CPU, version ${json.versionNumber || 'latest'})`,
  });
}

export async function checkKaggleStatusRemote(kernelSlug = KERNEL_SLUG) {
  const targetKernelId = `${config.kaggle.username}/${kernelSlug}`;
  const authHeader = `Basic ${getKaggleBasicAuth()}`;
  try {
    const url = `https://www.kaggle.com/api/v1/kernels/status?userName=${encodeURIComponent(
      config.kaggle.username
    )}&kernelSlug=${encodeURIComponent(kernelSlug)}`;
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    if (res.ok) {
      const data = await res.json();
      const rawStatus = String(data.status || '').toUpperCase();
      let status = 'running';
      if (rawStatus.includes('COMPLETE')) status = 'complete';
      else if (rawStatus.includes('ERROR') || rawStatus.includes('CANCEL')) status = 'error';
      return { status, raw: `${targetKernelId} has status "${data.status || rawStatus}"`, failureMessage: data.failureMessage || null };
    }
  } catch (err) {
    console.warn('Kaggle status REST fallback:', err.message);
  }

  const env = { ...process.env, KAGGLE_USERNAME: config.kaggle.username, KAGGLE_KEY: config.kaggle.key };
  const { stdout } = await execFileAsync('python', ['-m', 'kaggle', 'kernels', 'status', targetKernelId], {
    env,
    timeout: 30000,
  });
  let status = 'running';
  if (stdout.includes('COMPLETE')) status = 'complete';
  else if (stdout.includes('ERROR') || stdout.includes('CANCELLED')) status = 'error';
  return { status, raw: stdout.trim(), failureMessage: null };
}

export async function downloadKernelOutputIfNeeded(runId = null, forceRemote = false, track = 'v1') {
  const trackCfg = getTrackConfig(track);
  const stagedId = runId || `fetch-${Date.now()}`;
  const targetDir = path.join(trackCfg.outputDir, stagedId);
  if (!forceRemote && !runId) {
    const existingLocal = findArtifact(trackCfg.outputDir, 'model.json', 'FINAL_MODEL');
    if (existingLocal) return { modelJsonLocal: existingLocal, searchRoot: trackCfg.outputDir };
  }

  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const authHeader = `Basic ${getKaggleBasicAuth()}`;
  try {
    const url = `https://www.kaggle.com/api/v1/kernels/output?userName=${encodeURIComponent(config.kaggle.username)}&kernelSlug=${encodeURIComponent(trackCfg.kernelSlug)}`;
            const res = await fetch(url, { headers: { Authorization: authHeader } });
            if (res.ok) {
              const data = await res.json();
              for (const f of data.files || []) {
                const fileName = f.fileName || f.name || '';
                const fileUrl = f.url;
                if (!fileName || !fileUrl) continue;
                if (
                  !/(model\.json|class\.json|class_centroids\.json|embedding_meta\.json|conversion_log\.txt|training_summary\.json|\.bin$|comparison_table\.csv|metrics\.csv|classification_report\.csv|error_summary\.csv|misclassified\.csv|history\.csv|dataset_split\.csv|confusion_matrix\.png|training_history\.png)$/i.test(
                    fileName
                  )
                ) {
                  continue;
                }
                const safeRoot = path.resolve(targetDir);
                const destPath = path.resolve(safeRoot, String(fileName).replace(/^[/\\]+/, ''));
                if (!destPath.startsWith(safeRoot + path.sep)) continue;
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                const dlRes = await fetch(fileUrl);
                if (dlRes.ok) fs.writeFileSync(destPath, Buffer.from(await dlRes.arrayBuffer()));
              }
            }
          } catch (err) {
            console.warn('Gagal mengunduh output via REST Kaggle:', err.message);
          }

          return { modelJsonLocal: findArtifact(targetDir, 'model.json', 'FINAL_MODEL'), searchRoot: targetDir };
        }

        export async function downloadSyncSummary(_syncId = 'latest') {
          const authHeader = `Basic ${getKaggleBasicAuth()}`;
          try {
            const url = `https://www.kaggle.com/api/v1/kernels/output?userName=${encodeURIComponent(config.kaggle.username)}&kernelSlug=${encodeURIComponent(SYNC_KERNEL_SLUG)}`;
const res = await fetch(url, { headers: { Authorization: authHeader } });
if (!res.ok) return null;

const data = await res.json();
const targetFile = (data.files || []).find(
  (f) => path.basename(f.fileName || f.name || '').toLowerCase() === 'sync_summary.json'
);
if (!targetFile?.url) return null;

const dlRes = await fetch(targetFile.url);
if (!dlRes.ok) return null;

const text = await dlRes.text();
return JSON.parse(text);
          } catch (err) {
  console.warn('Gagal mengunduh sync_summary.json dari Kaggle:', err.message);
  return null;
}
        }
