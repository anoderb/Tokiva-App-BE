import { commit, downloadFile, listFiles } from '@huggingface/hub';
import { config } from '../../config/env.js';
import { BadRequest } from '../../utils/errors.js';
import { chunkArray } from './helpers.js';

export const UPLOAD_CHUNK_SIZE = 40;
export const DELETE_CHUNK_SIZE = 80;
export const MOVE_CHUNK_SIZE = 30;
export const MAX_SYNC_ALL_ITERATIONS = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getHfRepo() {
  return { type: 'dataset', name: config.huggingFace.datasetRepo };
}

function isRetryableHfError(err) {
  const status = err?.statusCode ?? err?.status ?? err?.response?.status;
  if ([429, 502, 503, 504].includes(Number(status))) return true;
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout')
  );
}

/** Commit operations batch ke Hugging Face Hub dengan exponential backoff retry */
export async function commitWithRetry({ title, operations }, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await commit({
        repo: getHfRepo(),
        accessToken: config.huggingFace.token,
        title,
        operations,
      });
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryableHfError(err)) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function downloadHfBlobWithFallback(hfPath) {
  const cleanPath = String(hfPath || '').trim().replace(/^\/+/, '');
  if (!cleanPath) return null;

  const repo = getHfRepo();
  const accessToken = config.huggingFace.token;

  let blob = await downloadFile({ repo, accessToken, path: cleanPath }).catch(() => null);
  if (blob) return { blob, resolvedPath: cleanPath };

  const altPath = getAlternativePrefixPath(cleanPath);
  if (altPath) {
    blob = await downloadFile({ repo, accessToken, path: altPath }).catch(() => null);
    if (blob) return { blob, resolvedPath: altPath };
  }

  return null;
}

async function listHfFilesUnderPrefix(prefix) {
  const files = [];
  try {
    for await (const entry of listFiles({
      repo: getHfRepo(),
      accessToken: config.huggingFace.token,
      path: prefix,
      recursive: true,
    })) {
      if (entry.type === 'file' && entry.path) {
        files.push(entry.path);
      }
    }
  } catch {
    // Prefix mungkin belum ada di repo HF
  }
  return files;
}

function getAlternativePrefixPath(filePath) {
  if (filePath.startsWith('dataset/')) return filePath.replace(/^dataset\//, 'data/');
  if (filePath.startsWith('data/')) return filePath.replace(/^data\//, 'dataset/');
  return null;
}

/** Hapus batch file dari repositori Hugging Face Hub (maks 80 file/commit) */
export async function deleteFilesFromHuggingFace(paths = [], commitReason = 'Tokiva Delete Samples') {
  const cleanPaths = [
    ...new Set((paths || []).map((p) => String(p || '').trim().replace(/^\/+/, '')).filter(Boolean)),
  ];

  if (!config.huggingFace.token || cleanPaths.length === 0) {
    return { deleted: 0, commits: 0, commit_oid: null, skipped: true };
  }

  let deleted = 0;
  let commits = 0;
  let lastCommitOid = null;

  for (const chunk of chunkArray(cleanPaths, DELETE_CHUNK_SIZE)) {
    const title = `${commitReason} (${chunk.length} file)`;
    try {
      const res = await commitWithRetry({
        title,
        operations: chunk.map((p) => ({ operation: 'delete', path: p })),
      });
      deleted += chunk.length;
      commits++;
      lastCommitOid = res.commit?.oid || lastCommitOid;
    } catch (err) {
      const parentDirs = [...new Set(chunk.map((p) => p.split('/').slice(0, -1).join('/')).filter(Boolean))];
      const expandedDirs = new Set(parentDirs);
      for (const dir of parentDirs) {
        const altDir = getAlternativePrefixPath(dir);
        if (altDir) expandedDirs.add(altDir);
      }

      const existingSet = new Set();
      for (const dir of expandedDirs) {
        const found = await listHfFilesUnderPrefix(dir);
        for (const f of found) existingSet.add(f);
      }

      const resolvedExisting = [];
      for (const p of chunk) {
        if (existingSet.has(p)) {
          resolvedExisting.push(p);
        } else {
          const alt = getAlternativePrefixPath(p);
          if (alt && existingSet.has(alt)) resolvedExisting.push(alt);
        }
      }

      const uniqueResolved = [...new Set(resolvedExisting)];
      if (uniqueResolved.length > 0) {
        const res = await commitWithRetry({
          title: `${commitReason} (${uniqueResolved.length} file)`,
          operations: uniqueResolved.map((p) => ({ operation: 'delete', path: p })),
        });
        deleted += uniqueResolved.length;
        commits++;
        lastCommitOid = res.commit?.oid || lastCommitOid;
      } else {
        console.warn('Info delete HF (file sudah tidak ditemukan di remote):', err.message);
      }
    }
  }

  return { deleted, commits, commit_oid: lastCommitOid, skipped: false };
}

/** Hapus seluruh folder kelas di Hugging Face Hub */
export async function deleteClassFolderFromHuggingFace(kodeKelas, knownHfPaths = []) {
  const cleanKode = String(kodeKelas || '').trim().replace(/^\/+|\/+$/g, '');
  if (!config.huggingFace.token || !cleanKode) {
    return { deleted: 0, commits: 0, commit_oid: null, skipped: true };
  }

  const [dataFiles, legacyFiles] = await Promise.all([
    listHfFilesUnderPrefix(`data/${cleanKode}`),
    listHfFilesUnderPrefix(`dataset/${cleanKode}`),
  ]);

  const discovered = new Set([...dataFiles, ...legacyFiles]);
  if (discovered.size === 0 && Array.isArray(knownHfPaths)) {
    for (const p of knownHfPaths) {
      const cp = String(p || '').trim().replace(/^\/+/, '');
      if (cp) discovered.add(cp);
    }
  }

  if (discovered.size === 0) {
    return { deleted: 0, commits: 0, commit_oid: null, skipped: false };
  }

  return deleteFilesFromHuggingFace([...discovered], `Tokiva Delete Class: ${cleanKode}`);
}

/** Pindahkan file di Hugging Face Hub secara atomik (maks 30 file/commit) */
export async function moveFilesInHuggingFace(moves = [], commitReason = 'Tokiva Move Samples') {
  const validMoves = (moves || [])
    .map((m) => ({
      id: m.id,
      oldPath: String(m.oldPath || '').trim().replace(/^\/+/, ''),
      newPath: String(m.newPath || '').trim().replace(/^\/+/, ''),
    }))
    .filter((m) => m.oldPath && m.newPath && m.oldPath !== m.newPath);

  if (!config.huggingFace.token || validMoves.length === 0) {
    return { moved: [], commits: 0, skipped: true };
  }

  const movedResults = [];
  let commits = 0;

  for (const chunk of chunkArray(validMoves, MOVE_CHUNK_SIZE)) {
    const downloaded = [];
    for (const dlBatch of chunkArray(chunk, 5)) {
      const results = await Promise.all(
        dlBatch.map(async (m) => {
          const dl = await downloadHfBlobWithFallback(m.oldPath);
          return dl ? { ...m, blob: dl.blob, resolvedPath: dl.resolvedPath } : null;
        })
      );
      for (const r of results) {
        if (r) downloaded.push(r);
      }
    }

    if (downloaded.length === 0) continue;

    const operations = [];
    for (const item of downloaded) {
      operations.push({ operation: 'addOrUpdate', path: item.newPath, content: item.blob });
      if (item.resolvedPath !== item.newPath) {
        operations.push({ operation: 'delete', path: item.resolvedPath });
      }
    }

    let commitResult;
    try {
      commitResult = await commitWithRetry({
        title: `${commitReason} (${downloaded.length} file)`,
        operations,
      });
    } catch (hfErr) {
      throw new BadRequest(`Gagal memindahkan file di Hugging Face Hub: ${hfErr.message}`);
    }

    const commitOid = commitResult.commit?.oid || 'unknown';
    commits++;

    for (const item of downloaded) {
      movedResults.push({ id: item.id, oldPath: item.resolvedPath, newPath: item.newPath, commitOid });
    }
  }

  return { moved: movedResults, commits, skipped: false };
}
