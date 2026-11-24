import { uploadMediaGambar, parseBase64Image } from '../../services/media/upload.js';
import { mediaSchema } from '../../schemas/media.js';
import { BadRequest } from '../../utils/errors.js';
import { ok } from '../../utils/response.js';

export default async function mediaRoutes(app) {
  // 1. Endpoint /media/upload (Dukungan Hybrid: Multipart Form & Base64 JSON)
  app.post('/media/upload', { schema: mediaSchema.uploadMultipart }, async (req, reply) => {
    // A. Jika request berupa multipart/form-data
    if (typeof req.isMultipart === 'function' && req.isMultipart()) {
      const file = await req.file();
      if (!file) {
        throw new BadRequest('File multipart gambar wajib dikirim');
      }

      const buffer = await file.toBuffer();
      const folder = req.query?.folder || 'produk';

      const result = await uploadMediaGambar(req.toko_id || 'platform', {
        buffer,
        mimetype: file.mimetype,
        filename: file.filename,
        folder,
      });

      return ok(reply, result, 'Media gambar berhasil diunggah', 201);
    }

    // B. Jika request berupa Base64 JSON
    const body = req.body || {};
    const base64Str = body.gambar || body.file_base64;
    if (!base64Str) {
      throw new BadRequest('File gambar atau data gambar base64 wajib dikirim');
    }

    const { buffer, mimetype } = parseBase64Image(base64Str);
    const folderRaw = body.folder || body.kategori || req.query?.folder || 'produk';
    const folderMap = {
      produk: 'produk',
      logo: 'toko',
      toko: 'toko',
      qris: 'qris',
      bukti: 'nota',
      nota: 'nota',
      avatar: 'avatar',
    };
    const folder = folderMap[folderRaw] || 'produk';
    const filename = body.nama_file || 'upload.jpg';

    const result = await uploadMediaGambar(req.toko_id || 'platform', {
      buffer,
      mimetype,
      filename,
      folder,
    });

    return ok(reply, result, 'Media gambar berhasil diunggah', 201);
  });

  // 2. Endpoint /media/upload-base64 (Eksplisit Base64 JSON)
  app.post('/media/upload-base64', { schema: mediaSchema.uploadBase64 }, async (req, reply) => {
    const body = req.body || {};
    const base64Str = body.gambar || body.file_base64;
    if (!base64Str) {
      throw new BadRequest('Data gambar base64 wajib diisi');
    }

    const { buffer, mimetype } = parseBase64Image(base64Str);
    const folderRaw = body.folder || body.kategori || req.query?.folder || 'produk';
    const folderMap = {
      produk: 'produk',
      logo: 'toko',
      toko: 'toko',
      qris: 'qris',
      bukti: 'nota',
      nota: 'nota',
      avatar: 'avatar',
    };
    const folder = folderMap[folderRaw] || 'produk';
    const filename = body.nama_file || 'upload.jpg';

    const result = await uploadMediaGambar(req.toko_id || 'platform', {
      buffer,
      mimetype,
      filename,
      folder,
    });

    return ok(reply, result, 'Media gambar berhasil diunggah', 201);
  });
}
