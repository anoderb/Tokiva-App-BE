import {
  listArusKas,
  tambahArusKas,
  getRingkasanArusKas,
} from '../../services/laporan/arus-kas.js';
import { listMutasiStok } from '../../services/laporan/mutasi-stok.js';
import { laporanSchema } from '../../schemas/laporan.js';
import { ok } from '../../utils/response.js';

export default async function ownerLaporanRoutes(app) {
  // 1. Buku Kas & Arus Kas Operasional
  app.get('/arus-kas', { schema: laporanSchema.listArusKas }, async (req, reply) => {
    const data = await listArusKas(req.toko_id, req.query);
    return ok(reply, data);
  });

  app.post('/arus-kas', { schema: laporanSchema.tambahArusKas }, async (req, reply) => {
    const data = await tambahArusKas(req.toko_id, req.pengguna.id, req.body);
    return ok(reply, data, 'Catatan arus kas berhasil disimpan', 201);
  });

  app.get('/arus-kas/ringkasan', { schema: laporanSchema.ringkasanArusKas }, async (req, reply) => {
    const data = await getRingkasanArusKas(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Log Audit Mutasi Stok Barang
  app.get('/mutasi-stok', { schema: laporanSchema.listMutasiStok }, async (req, reply) => {
    const data = await listMutasiStok(req.toko_id, req.query);
    return ok(reply, data);
  });
}

