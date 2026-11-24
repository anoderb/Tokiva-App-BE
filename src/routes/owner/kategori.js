import { listKategori, createKategori, updateKategori, deleteKategori } from '../../services/kategori/kategori.js';
import { kategoriSchema } from '../../schemas/kategori.js';
import { ok } from '../../utils/response.js';

export default async function ownerKategoriRoutes(app) {
  // 1. List Kategori
  app.get('/kategori', { schema: kategoriSchema.list }, async (req, reply) => {
    const data = await listKategori(req.toko_id);
    return ok(reply, data);
  });

  // 2. Tambah Kategori
  app.post('/kategori', { schema: kategoriSchema.create }, async (req, reply) => {
    const data = await createKategori(req.toko_id, req.body);
    return ok(reply, data, 'Kategori berhasil ditambahkan', 201);
  });

  // 3. Update Kategori
  app.put('/kategori/:id', { schema: kategoriSchema.update }, async (req, reply) => {
    const data = await updateKategori(req.toko_id, req.params.id, req.body);
    return ok(reply, data, 'Kategori berhasil diperbarui');
  });

  // 4. Hapus Kategori
  app.delete('/kategori/:id', { schema: kategoriSchema.delete }, async (req, reply) => {
    const data = await deleteKategori(req.toko_id, req.params.id);
    return ok(reply, data, 'Kategori berhasil dihapus');
  });
}

