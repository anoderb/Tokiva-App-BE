import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest } from '../../utils/errors.js';
import { recountKelasMetrics } from './helpers.js';

async function resolveAiKelasIdForProduk(produkRow) {
  if (!produkRow) return null;
  if (produkRow.master_id) {
    const { data: byMaster } = await supabaseAdmin
      .from('ai_kelas')
      .select('id')
      .eq('master_id', produkRow.master_id)
      .limit(1)
      .maybeSingle();
    if (byMaster?.id) return byMaster.id;
  }
  if (produkRow.barcode) {
    const { data: byBarcode } = await supabaseAdmin
      .from('ai_kelas')
      .select('id')
      .eq('barcode', produkRow.barcode)
      .limit(1)
      .maybeSingle();
    if (byBarcode?.id) return byBarcode.id;
  }
  return null;
}

/**
 * Konversi Log Inferensi Kasir menjadi Sampel Latih AI (Langsung Terverifikasi oleh Admin)
 */
export async function jadikanDataLatihDariLog(
  logId,
  { kelas_id = null, terverifikasi = true } = {}
) {
  const { data: logRow, error: lErr } = await supabaseAdmin
    .from('ai_log_inferensi')
    .select('*, kelas:prediksi_kelas_id(id, kode_kelas, nama), produk_asli:produk_id_asli(id, master_id, barcode)')
    .eq('id', logId)
    .maybeSingle();

  if (lErr || !logRow) {
    throw new BadRequest('Log inferensi tidak ditemukan');
  }

  let targetKelasId = null;
  if (kelas_id) {
    const { data: kCheck } = await supabaseAdmin.from('ai_kelas').select('id').eq('id', kelas_id).maybeSingle();
    if (kCheck?.id) {
      targetKelasId = kCheck.id;
    } else {
      const { data: pCheck } = await supabaseAdmin
        .from('produk')
        .select('id, master_id, barcode')
        .eq('id', kelas_id)
        .maybeSingle();
      targetKelasId = await resolveAiKelasIdForProduk(pCheck);
    }
  }

  if (!targetKelasId) {
    targetKelasId =
      (await resolveAiKelasIdForProduk(logRow.produk_asli)) || logRow.prediksi_kelas_id || null;
  }
  if (!targetKelasId) {
    throw new BadRequest('Kelas AI tujuan tidak ditemukan atau belum dipetakan pada produk terkait');
  }

  if (logRow.foto_cuplikan) {
    const { data: dupRow } = await supabaseAdmin
      .from('ai_sampel')
      .select('id')
      .eq('path_supabase', logRow.foto_cuplikan)
      .limit(1)
      .maybeSingle();

    if (dupRow?.id) {
      throw new BadRequest('Foto cuplikan log inferensi ini sudah masuk ke dataset sebelumnya');
    }
  }

  const fileName = `pos_log_${String(logId).slice(0, 8)}_${Date.now()}.jpg`;
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('ai_sampel')
    .insert({
      kelas_id: targetKelasId,
      nama_file: fileName,
      sudut: 'Umum',
      sumber: 'koreksi_kasir',
      resolusi: '224x224',
      ukuran_byte: 45000,
      lokasi_simpan: 'supabase',
      path_supabase: logRow.foto_cuplikan || null,
      split: 'train',
      terverifikasi: Boolean(terverifikasi),
    })
    .select()
    .single();

  if (insErr) throw insErr;

  await recountKelasMetrics(targetKelasId);
  return inserted;
}
