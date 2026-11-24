import { listArusKas, tambahArusKas } from '../../services/laporan/arus-kas.js';
import { laporanSchema } from '../../schemas/laporan.js';
import { ok } from '../../utils/response.js';

export default async function kasirArusKasRoutes(app) {
  // 1. Daftar Arus Kas / Pengeluaran Laci Kasir
  app.get('/arus-kas', { schema: laporanSchema.listArusKas }, async (req, reply) => {
    const data = await listArusKas(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Catat Pengeluaran Operasional Kecil dari Laci Kasir
  app.post('/arus-kas', { schema: laporanSchema.tambahArusKas }, async (req, reply) => {
    const data = await tambahArusKas(req.toko_id, req.pengguna.id, req.body);
    return ok(reply, data, 'Pengeluaran kasir berhasil dicatat', 201);
  });
}
