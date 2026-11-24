import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_KERNEL_OUTPUT_DIR } from '../src/services/ai/kaggle-config.js';
import { uploadResearchBundleToCloud } from '../src/services/ai/kaggle-research-cloud.js';

function parseArg(prefix, fallback = null) {
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

async function main() {
  const dirArg = parseArg('--dir=');
  const runId = parseArg('--run-id=', 'default');
  const label = parseArg('--label=', runId === 'default' ? 'Baseline Riset (Research_POS)' : runId);
  const targetDir = dirArg
    ? path.resolve(dirArg)
    : path.join(LEGACY_KERNEL_OUTPUT_DIR, 'Research_POS');

  if (!fs.existsSync(targetDir)) {
    console.error(`Direktori Research_POS tidak ditemukan di: ${targetDir}`);
    process.exit(1);
  }

  console.log(`Mengunggah artefak riset dari ${targetDir} ke Supabase Storage (run_id=${runId})...`);
  const result = await uploadResearchBundleToCloud(targetDir, { runId, label });
  console.log('Upload selesai:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Gagal backfill riset ke Supabase Storage:', err?.message || err);
  process.exit(1);
});
