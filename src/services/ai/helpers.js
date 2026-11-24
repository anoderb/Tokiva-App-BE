import { supabaseAdmin } from '../../lib/supabase.js';

/**
 * Standarisasi kode_kelas ke format slug tanda hubung (-) huruf kecil.
 * Contoh: "Indomie Goreng_85g!" -> "indomie-goreng-85g"
 */
export function slugifyKodeKelas(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Bangun path kanonik dataset di Hugging Face Hub: data/{kode-kelas}/{nama_file}
 */
export function buildHfSamplePath(kodeKelas, fileName) {
  const cleanKode = String(kodeKelas || 'umum').trim().replace(/^\/+|\/+$/g, '') || 'umum';
  const cleanFile = String(fileName || '').trim().replace(/^\/+/, '');
  return `data/${cleanKode}/${cleanFile}`;
}

/**
 * Lindungi file pada folder inferensi-log/ di Supabase Storage agar pratinjau
 * audit ai_log_inferensi.foto_cuplikan tetap utuh setelah sinkronisasi/hapus sampel.
 */
export function isProtectedStagingPath(storagePath) {
  if (!storagePath) return true;
  return String(storagePath).replace(/^\/+/, '').startsWith('inferensi-log/');
}

/**
 * Pecah array menjadi potongan berukuran maksimal `size`
 */
export function chunkArray(items = [], size = 40) {
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Hitung ulang metrik (total_foto, jml_supabase, jml_hf, status) pada ai_kelas
 */
export async function recountKelasMetrics(kelasIds) {
  const uniqueIds = [...new Set([...(kelasIds || [])].filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const nowIso = new Date().toISOString();

  await Promise.all(
    uniqueIds.map(async (kId) => {
      const [
        { count: totalCount },
        { count: sbCount },
        { count: hfCount },
        { data: kelasRow },
      ] = await Promise.all([
        supabaseAdmin.from('ai_sampel').select('id', { count: 'exact', head: true }).eq('kelas_id', kId),
        supabaseAdmin
          .from('ai_sampel')
          .select('id', { count: 'exact', head: true })
          .eq('kelas_id', kId)
          .eq('lokasi_simpan', 'supabase'),
        supabaseAdmin
          .from('ai_sampel')
          .select('id', { count: 'exact', head: true })
          .eq('kelas_id', kId)
          .eq('lokasi_simpan', 'huggingface'),
        supabaseAdmin.from('ai_kelas').select('target_foto').eq('id', kId).maybeSingle(),
      ]);

      const totalFoto = totalCount || 0;
      const jmlSupabase = sbCount || 0;
      const jmlHf = hfCount || 0;
      const target = Number(kelasRow?.target_foto || 100);

      let statusBaru = 'Kurang Data';
      if (jmlHf >= target) {
        statusBaru = 'Siap Training';
      } else if (totalFoto >= target) {
        statusBaru = 'Siap Verifikasi';
      }

      await supabaseAdmin
        .from('ai_kelas')
        .update({
          total_foto: totalFoto,
          jml_supabase: jmlSupabase,
          jml_hf: jmlHf,
          status: statusBaru,
          diubah_pada: nowIso,
        })
        .eq('id', kId);
    })
  );
}
