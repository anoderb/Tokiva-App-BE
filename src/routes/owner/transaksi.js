import {
  getRiwayatTransaksi,
  getDetailTransaksi,
  incrementCetakStruk,
} from '../../services/transaksi/riwayat.js';
import { voidTransaksi } from '../../services/transaksi/void.js';
import { transaksiSchema } from '../../schemas/transaksi.js';
import { ok } from '../../utils/response.js';

export default async function ownerTransaksiRoutes(app) {
  // 1. Riwayat Transaksi Toko (Audit Owner)
  app.get('/transaksi', { schema: transaksiSchema.riwayat }, async (req, reply) => {
    const data = await getRiwayatTransaksi(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Detail Transaksi
  app.get('/transaksi/:id', { schema: transaksiSchema.detail }, async (req, reply) => {
    const data = await getDetailTransaksi(req.toko_id, req.params.id);
    return ok(reply, data);
  });

  // 2b. Catat cetak struk
  app.post('/transaksi/:id/cetak', { schema: transaksiSchema.detail }, async (req, reply) => {
    const data = await incrementCetakStruk(req.toko_id, req.params.id);
    return ok(reply, data, 'Jumlah cetak struk diperbarui');
  });

  // 3. Batalkan Transaksi (Void Nota & Kembalikan Stok)
  app.post('/transaksi/:id/void', { schema: transaksiSchema.void }, async (req, reply) => {
    const data = await voidTransaksi(req.toko_id, req.params.id, req.body || {});
    return ok(reply, data, 'Transaksi berhasil dibatalkan dan stok telah dikembalikan');
  });
}

