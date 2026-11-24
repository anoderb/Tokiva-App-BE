import { listPelanggan, createPelanggan } from '../../services/pelanggan/pelanggan.js';
import { getKartuPiutang, bayarPiutang } from '../../services/pelanggan/piutang.js';
import { pelangganSchema } from '../../schemas/pelanggan.js';
import { ok } from '../../utils/response.js';

export default async function kasirPelangganRoutes(app) {
  // 1. Pencarian Cepat Pelanggan untuk Kas Bon di POS
  app.get('/pelanggan', { schema: pelangganSchema.list }, async (req, reply) => {
    const data = await listPelanggan(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Tambah Cepat Warga Baru dari Meja Kasir
  app.post('/pelanggan', { schema: pelangganSchema.create }, async (req, reply) => {
    const data = await createPelanggan(req.toko_id, req.body);
    return ok(reply, data, 'Pelanggan berhasil ditambahkan', 201);
  });

  // 3. Cek Kartu Kas Bon Warga
  app.get('/piutang/kartu/:pelangganId', { schema: pelangganSchema.kartuPiutang }, async (req, reply) => {
    const data = await getKartuPiutang(req.toko_id, req.params.pelangganId);
    return ok(reply, data);
  });

  // 4. Pembayaran Cicilan / Pelunasan Kas Bon di Kasir
  app.post('/piutang/bayar', { schema: pelangganSchema.bayarPiutang }, async (req, reply) => {
    const data = await bayarPiutang(req.toko_id, req.pengguna.id, req.body);
    return ok(reply, data, 'Pembayaran kas bon berhasil dicatat');
  });
}

