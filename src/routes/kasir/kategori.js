import { listKategori } from '../../services/kategori/kategori.js';
import { kategoriSchema } from '../../schemas/kategori.js';
import { ok } from '../../utils/response.js';

export default async function kasirKategoriRoutes(app) {
  app.get('/kategori', { schema: kategoriSchema.list }, async (req, reply) => {
    const data = await listKategori(req.toko_id);
    return ok(reply, data);
  });
}

