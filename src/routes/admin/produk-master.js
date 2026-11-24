import {
  listKategoriGlobal,
  listProdukMaster,
  createProdukMaster,
  updateProdukMaster,
  deleteProdukMaster,
} from '../../services/admin/produk-master.js';
import { adminSchema } from '../../schemas/admin.js';
import { ok } from '../../utils/response.js';

export default async function adminProdukMasterRoutes(app) {
  app.get('/kategori', {
    schema: {
      tags: ['Admin Produk Master'],
      summary: 'Daftar kategori produk global',
    },
  }, async (req, reply) => {
    const data = await listKategoriGlobal();
    return ok(reply, data);
  });

  app.get('/produk-master', { schema: adminSchema.listProdukMaster }, async (req, reply) => {
    const data = await listProdukMaster(req.query);
    return ok(reply, data);
  });

  app.post('/produk-master', { schema: adminSchema.createProdukMaster }, async (req, reply) => {
    const data = await createProdukMaster(req.body);
    return ok(reply, data, 'Produk master berhasil ditambahkan', 201);
  });

  app.put('/produk-master/:id', { schema: adminSchema.updateProdukMaster }, async (req, reply) => {
    const data = await updateProdukMaster(req.params.id, req.body);
    return ok(reply, data, 'Produk master berhasil diperbarui');
  });

  app.delete('/produk-master/:id', { schema: adminSchema.deleteProdukMaster }, async (req, reply) => {
    const data = await deleteProdukMaster(req.params.id);
    return ok(reply, data, data.message);
  });
}

