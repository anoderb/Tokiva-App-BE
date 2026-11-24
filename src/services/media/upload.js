import { supabaseAdmin } from '../../lib/supabase.js';
import { BadRequest } from '../../utils/errors.js';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_FOLDERS = new Set(['produk', 'toko', 'qris', 'nota', 'avatar']);

/**
 * Unggah Gambar (Produk, Logo Toko, QRIS, Bukti Nota) ke Supabase Storage Bucket 'aset-aplikasi'
 */
export async function uploadMediaGambar(tokoId, { buffer, mimetype, filename, folder = 'produk' }) {
  if (!buffer || buffer.length === 0) {
    throw new BadRequest('File gambar tidak boleh kosong');
  }

  if (!ALLOWED_MIMES.has(mimetype)) {
    throw new BadRequest('Format file harus berupa gambar JPEG, PNG, atau WebP');
  }

  const safeFolder = ALLOWED_FOLDERS.has(folder) ? folder : 'produk';
  const ext = mimetype.includes('png') ? 'png' : (mimetype.includes('webp') ? 'webp' : 'jpg');
  const safeBaseName = (filename || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);

  const storagePath = `${tokoId}/${safeFolder}/${Date.now()}_${safeBaseName}.${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('aset-aplikasi')
    .upload(storagePath, buffer, {
      contentType: mimetype,
      upsert: true,
    });

  if (uploadErr) {
    throw new BadRequest(`Gagal mengunggah media: ${uploadErr.message}`);
  }

  const { data: pubData } = supabaseAdmin.storage
    .from('aset-aplikasi')
    .getPublicUrl(storagePath);

  return {
    bucket: 'aset-aplikasi',
    path: storagePath,
    url: pubData.publicUrl,
    mimetype,
    size: buffer.length,
  };
}

/**
 * Helper parsing Base64 string menjadi buffer + mimetype
 */
export function parseBase64Image(base64Str) {
  if (!base64Str || typeof base64Str !== 'string') {
    throw new BadRequest('Data gambar base64 wajib diisi');
  }

  const match = base64Str.match(/^data:(image\/\w+);base64,(.+)$/);
  const mimetype = match ? match[1] : 'image/jpeg';
  const raw = match ? match[2] : base64Str;

  return {
    mimetype,
    buffer: Buffer.from(raw, 'base64'),
  };
}

