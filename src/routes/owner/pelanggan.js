import {
  listPelanggan,
  getDetailPelanggan,
  createPelanggan,
  updatePelanggan,
  deletePelanggan,
} from '../../services/pelanggan/pelanggan.js';
import {
  listPiutang,
  getKartuPiutang,
  bayarPiutang,
} from '../../services/pelanggan/piutang.js';
import { pelangganSchema } from '../../schemas/pelanggan.js';
import { ok } from '../../utils/response.js';

export default async function ownerPelangganRoutes(app) {
  // 1. Kelola Data Pelanggan Toko
  app.get('/pelanggan', { schema: pelangganSchema.list }, async (req, reply) => {
    const data = await listPelanggan(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.get('/pelanggan/:id', { schema: pelangganSchema.detail }, async (req, reply) => {
    const data = await getDetailPelanggan(req.toko_id, req.params.id);
    return ok(reply, data);
  });

  app.post('/pelanggan', { schema: pelangganSchema.create }, async (req, reply) => {
    const data = await createPelanggan(req.toko_id, req.body);
    return ok(reply, data, 'Pelanggan berhasil ditambahkan', 201);
  });

  app.put('/pelanggan/:id', { schema: pelangganSchema.update }, async (req, reply) => {
    const data = await updatePelanggan(req.toko_id, req.params.id, req.body);
    return ok(reply, data, 'Data pelanggan berhasil diperbarui');
  });

  app.delete('/pelanggan/:id', { schema: pelangganSchema.delete }, async (req, reply) => {
    const data = await deletePelanggan(req.toko_id, req.params.id);
    return ok(reply, data, 'Pelanggan berhasil dihapus');
  });

  // 2. Kelola Kas Bon & Kartu Piutang
  app.get('/piutang', { schema: pelangganSchema.listPiutang }, async (req, reply) => {
    const data = await listPiutang(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.get('/piutang/kartu/:pelangganId', { schema: pelangganSchema.kartuPiutang }, async (req, reply) => {
    const data = await getKartuPiutang(req.toko_id, req.params.pelangganId);
    return ok(reply, data);
  });

  app.post('/piutang/bayar', { schema: pelangganSchema.bayarPiutang }, async (req, reply) => {
    const data = await bayarPiutang(req.toko_id, req.pengguna.id, req.body);
    return ok(reply, data, 'Pembayaran kas bon berhasil dicatat');
  });
}

