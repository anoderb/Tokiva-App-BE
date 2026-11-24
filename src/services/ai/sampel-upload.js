import { supabaseAdmin } from '../../lib/supabase.js';
import { NotFound, BadRequest } from '../../utils/errors.js';
import { recountKelasMetrics } from './helpers.js';

/**
 * Upload Kumpulan Foto Burst Kamera / HP Kasir ke Supabase Storage & ai_sampel
 */
export async function uploadBurstSampel({
  kelas_id,
  gambar_list = [],
  fotos = [],
  sudut = 'Umum',
  sudut_ambil,
  sumber = 'webcam_burst',
  terverifikasi = false,
}) {
  const normalizedItems =
    Array.isArray(fotos) && fotos.length > 0
      ? fotos
          .map((f) =>
            typeof f === 'string'
              ? { base64: f, sudut: null }
              : { base64: f?.base64, sudut: f?.sudut_ambil || f?.sudut || null }
          )
          .filter((item) => Boolean(item.base64))
      : (gambar_list || []).filter(Boolean).map((b64) => ({ base64: b64, sudut: null }));

  if (normalizedItems.length === 0) {
    throw new BadRequest('Daftar gambar burst tidak boleh kosong');
  }

  const finalSudut = sudut_ambil || sudut || 'Umum';
  const verifiedBool = Boolean(terverifikasi);

  const { data: kelas, error: kErr } = await supabaseAdmin
    .from('ai_kelas')
    .select('id, kode_kelas, nama, target_foto, total_foto, jml_supabase')
    .eq('id', kelas_id)
    .maybeSingle();

  if (kErr) throw kErr;
  if (!kelas) throw new NotFound('Kelas AI tidak ditemukan');

  const insertedSamples = [];
  const timestamp = Date.now();

  for (let i = 0; i < normalizedItems.length; i++) {
    const item = normalizedItems[i];
    const rawImage = item.base64;
    const itemSudut = item.sudut || finalSudut;
    let base64Data = rawImage;
    let mimeType = 'image/jpeg';

    if (rawImage.startsWith('data:')) {
      const match = rawImage.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `${kelas.kode_kelas}_${timestamp}_${String(i + 1).padStart(3, '0')}.${ext}`;
    const storagePath = `${kelas.kode_kelas}/${fileName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from('dataset-raw-temp')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

    if (upErr) {
      console.error(`Gagal upload sampel ${fileName}:`, upErr.message);
      continue;
    }

    const { data: sampleRow, error: dbErr } = await supabaseAdmin
      .from('ai_sampel')
      .insert({
        kelas_id: kelas.id,
        nama_file: fileName,
        sudut: itemSudut,
        sumber,
        resolusi: '224x224',
        ukuran_byte: buffer.length,
        lokasi_simpan: 'supabase',
        path_supabase: storagePath,
        split: 'train',
        terverifikasi: verifiedBool,
      })
      .select()
      .single();

    if (!dbErr && sampleRow) insertedSamples.push(sampleRow);
  }

  const kelasStats = await recountKelasMetrics(kelas.id);

  return {
    kelas: kelasStats || { id: kelas.id, kode_kelas: kelas.kode_kelas },
    jumlah_berhasil: insertedSamples.length,
    berhasil_diunggah: insertedSamples.length,
    sampel: insertedSamples,
  };
}
