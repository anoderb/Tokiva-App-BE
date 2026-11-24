import {
  listPemasok,
  createPemasok,
  updatePemasok,
  deletePemasok,
} from '../../services/kulakan/pemasok.js';
import {
  listKulakan,
  getDetailKulakan,
  createKulakan,
  bayarUtangKulakan,
  listReturKulakan,
  returKulakan,
} from '../../services/kulakan/kulakan.js';
import { kulakanSchema } from '../../schemas/kulakan.js';
import { ok } from '../../utils/response.js';

export default async function ownerKulakanRoutes(app) {
  // 1. Kelola Data Pemasok / Supplier
  app.get('/pemasok', { schema: kulakanSchema.listPemasok }, async (req, reply) => {
    const data = await listPemasok(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.post('/pemasok', { schema: kulakanSchema.createPemasok }, async (req, reply) => {
    const data = await createPemasok(req.toko_id, req.body);
    return ok(reply, data, 'Pemasok berhasil ditambahkan', 201);
  });

  app.put('/pemasok/:id', { schema: kulakanSchema.updatePemasok }, async (req, reply) => {
    const data = await updatePemasok(req.toko_id, req.params.id, req.body);
    return ok(reply, data, 'Data pemasok berhasil diperbarui');
  });

  app.delete('/pemasok/:id', { schema: kulakanSchema.deletePemasok }, async (req, reply) => {
    const data = await deletePemasok(req.toko_id, req.params.id);
    return ok(reply, data, 'Pemasok berhasil dihapus');
  });

  // 2. Faktur Belanja Kulakan & Stok Masuk
  app.get('/kulakan', { schema: kulakanSchema.listKulakan }, async (req, reply) => {
    const data = await listKulakan(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.get('/kulakan/retur', { schema: kulakanSchema.listReturKulakan }, async (req, reply) => {
    const data = await listReturKulakan(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.get('/kulakan/:id', { schema: kulakanSchema.detailKulakan }, async (req, reply) => {
    const data = await getDetailKulakan(req.toko_id, req.params.id);
    return ok(reply, data);
  });

  app.post('/kulakan', { schema: kulakanSchema.createKulakan }, async (req, reply) => {
    const data = await createKulakan(req.toko_id, req.body);
    return ok(reply, data, 'Faktur kulakan berhasil dicatat dan stok bertambah', 201);
  });

  // 3. Pembayaran Cicilan / Pelunasan Utang Faktur Kulakan Supplier
  app.post('/kulakan/:id/bayar', { schema: kulakanSchema.bayarKulakan }, async (req, reply) => {
    const data = await bayarUtangKulakan(req.toko_id, req.pengguna.id, req.params.id, req.body);
    return ok(reply, data, 'Pembayaran utang kulakan berhasil dicatat');
  });

  // 4. Retur Barang ke Pemasok / Supplier dari Faktur Kulakan
  app.post('/kulakan/:id/retur', { schema: kulakanSchema.returKulakan }, async (req, reply) => {
    const data = await returKulakan(req.toko_id, req.pengguna.id, req.params.id, req.body);
    return ok(reply, data, 'Retur barang ke pemasok berhasil diproses');
  });
}

