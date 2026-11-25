import { supabaseAdmin } from '../src/lib/supabase.js';
import {
  buildHfSamplePath,
  extractHfFolderFromPath,
  pickDominantHfFolder,
  recountKelasMetrics,
  slugifyKodeKelas,
} from '../src/services/ai/helpers.js';
import { moveFilesInHuggingFace } from '../src/services/ai/huggingface-ops.js';

async function main() {
  console.log('=== 1. PERBAIKI SAMPEL DI FOLDER CLS-xxx PADA HUGGING FACE & SUPABASE ===');
  const { data: clsSamples, error: sErr } = await supabaseAdmin
    .from('ai_sampel')
    .select('id, kelas_id, nama_file, hf_path, kelas:kelas_id(id, kode_kelas, nama)')
    .like('hf_path', '%CLS-%');
  if (sErr) throw sErr;

  const { data: allClasses, error: kErr } = await supabaseAdmin
    .from('ai_kelas')
    .select('id, kode_kelas, nama')
    .order('kode_kelas');
  if (kErr) throw kErr;

  const dominantByKelasId = new Map();
  for (const k of allClasses || []) {
    const { data: samplePaths } = await supabaseAdmin
      .from('ai_sampel')
      .select('hf_path')
      .eq('kelas_id', k.id)
      .not('hf_path', 'is', null)
      .limit(500);
    const paths = (samplePaths || []).map((r) => r.hf_path).filter(Boolean);
    const hasNonClsFolder = paths.some((p) => {
      const f = extractHfFolderFromPath(p);
      return f && !/^CLS-\d+$/i.test(f);
    });
    const canonical = hasNonClsFolder
      ? pickDominantHfFolder(paths, k.kode_kelas)
      : slugifyKodeKelas(k.nama);
    dominantByKelasId.set(k.id, canonical);
  }

  const moves = (clsSamples || [])
    .filter((s) => {
      const folder = extractHfFolderFromPath(s.hf_path);
      return folder && /^CLS-\d+$/i.test(folder);
    })
    .map((s) => {
      const targetFolder = dominantByKelasId.get(s.kelas_id) || slugifyKodeKelas(s.kelas?.nama);
      return {
        id: s.id,
        kelas_id: s.kelas_id,
        oldPath: s.hf_path,
        newPath: buildHfSamplePath(targetFolder, s.nama_file),
      };
    });

  const affectedKelas = new Set();
  if (moves.length > 0) {
    console.log(`Memindahkan ${moves.length} file di Hugging Face:`, moves);
    const moveRes = await moveFilesInHuggingFace(moves, 'Tokiva Fix Misplaced CLS Samples');
    const nowIso = new Date().toISOString();
    for (const moved of moveRes.moved || []) {
      await supabaseAdmin
        .from('ai_sampel')
        .update({ hf_path: moved.newPath, hf_commit: moved.commitOid, tgl_sync: nowIso })
        .eq('id', moved.id);
      const orig = moves.find((m) => m.id === moved.id);
      if (orig?.kelas_id) affectedKelas.add(orig.kelas_id);
      console.log(`  ✓ ${moved.oldPath} -> ${moved.newPath} (commit: ${moved.commitOid})`);
    }
  } else {
    console.log('Tidak ada sampel CLS- yang perlu dipindahkan.');
  }

  console.log('\n=== 2. NORMALISASI ai_kelas.kode_kelas (CLS-xxx -> FOLDER KANONIK) ===');
  const usedCodes = new Set((allClasses || []).map((k) => k.kode_kelas).filter((c) => !/^CLS-\d+$/i.test(c)));
  let updatedClasses = 0;

  for (const k of allClasses || []) {
    if (!/^CLS-\d+$/i.test(k.kode_kelas)) continue;
    const candidate = dominantByKelasId.get(k.id) || slugifyKodeKelas(k.nama);
    if (!candidate || usedCodes.has(candidate)) {
      console.warn(`  ! Lewati ${k.kode_kelas} (${k.nama}) karena kandidat '${candidate}' bentrok/kosong.`);
      continue;
    }
    const { error: updErr } = await supabaseAdmin
      .from('ai_kelas')
      .update({ kode_kelas: candidate, diubah_pada: new Date().toISOString() })
      .eq('id', k.id);
    if (updErr) {
      console.error(`  x Gagal update ${k.kode_kelas} -> ${candidate}:`, updErr.message);
    } else {
      usedCodes.add(candidate);
      affectedKelas.add(k.id);
      updatedClasses++;
      console.log(`  ✓ ${k.kode_kelas} (${k.nama}) -> ${candidate}`);
    }
  }

  await recountKelasMetrics(affectedKelas);
  console.log(`\nSelesai! File HF dipindahkan: ${moves.length}, kelas dinormalisasi: ${updatedClasses}.`);
}

main().catch((err) => {
  console.error('Gagal menjalankan fix-cls-hf-folders:', err);
  process.exit(1);
});
