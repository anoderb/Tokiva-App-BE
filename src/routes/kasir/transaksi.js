import { checkoutTransaksi } from '../../services/transaksi/checkout.js';
import {
  getRiwayatTransaksi,
  getDetailTransaksi,
  incrementCetakStruk,
} from '../../services/transaksi/riwayat.js';
import { voidTransaksi } from '../../services/transaksi/void.js';
import { transaksiSchema } from '../../schemas/transaksi.js';
import { ok } from '../../utils/response.js';

export default async function kasirTransaksiRoutes(app) {
  // 1. Checkout POS Kasir
  app.post('/transaksi', { schema: transaksiSchema.checkout }, async (req, reply) => {
    const data = await checkoutTransaksi(req.toko_id, req.pengguna.id, req.body);
    return ok(reply, data, 'Transaksi berhasil diproses', 201);
  });

  // 2. Riwayat Transaksi Kasir (Khusus peran 'kasir' hanya menampilkan transaksi miliknya sendiri)
  app.get('/transaksi', { schema: transaksiSchema.riwayat }, async (req, reply) => {
    const queryParams = { ...(req.query || {}) };
    if (req.pengguna?.peran === 'kasir') {
      queryParams.kasir_id = req.pengguna.id;
    }
    const data = await getRiwayatTransaksi(req.toko_id, queryParams);
    return ok(reply, data);
  });

  // 3. Detail Faktur untuk Cetak Struk Thermal
  app.get('/transaksi/:id', { schema: transaksiSchema.detail }, async (req, reply) => {
    const kasirIdGuard = req.pengguna?.peran === 'kasir' ? req.pengguna.id : null;
    const data = await getDetailTransaksi(req.toko_id, req.params.id, kasirIdGuard);
    return ok(reply, data);
  });

  // 3b. Catat pencetakan / cetak ulang struk
  app.post('/transaksi/:id/cetak', { schema: transaksiSchema.detail }, async (req, reply) => {
    const kasirIdGuard = req.pengguna?.peran === 'kasir' ? req.pengguna.id : null;
    const data = await incrementCetakStruk(req.toko_id, req.params.id, kasirIdGuard);
    return ok(reply, data, 'Jumlah cetak struk diperbarui');
  });

  // 4. Batalkan Transaksi (Void Nota dengan verifikasi PIN wajib di server)
  app.post('/transaksi/:id/void', { schema: transaksiSchema.kasirVoid }, async (req, reply) => {
    const kasirIdGuard = req.pengguna?.peran === 'kasir' ? req.pengguna.id : null;
    const data = await voidTransaksi(req.toko_id, req.params.id, {
      ...(req.body || {}),
      kasir_id_guard: kasirIdGuard,
      actor_id: req.pengguna.id,
      actor_peran: req.pengguna?.peran,
    });
    return ok(reply, data, 'Transaksi berhasil dibatalkan dan stok telah dikembalikan');
  });
}
