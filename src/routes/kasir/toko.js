import { getProfilToko, getQrisStatus, generateDynamicQris } from '../../services/toko/toko.js';
import { verifikasiPinKasir } from '../../services/auth/pin.js';
import { tokoSchema } from '../../schemas/toko.js';
import { penggunaSchema } from '../../schemas/pengguna.js';
import { ok } from '../../utils/response.js';

export default async function kasirTokoRoutes(app) {
  // 1. Informasi Profil Toko, Footer Struk & QRIS untuk Kasir
  app.get('/toko/profil', { schema: tokoSchema.getProfil }, async (req, reply) => {
    const data = await getProfilToko(req.toko_id);
    return ok(reply, data);
  });

  // 2. Status & Info QRIS Toko
  app.get('/toko/qris/status', { schema: tokoSchema.qrisStatus }, async (req, reply) => {
    const data = await getQrisStatus(req.toko_id);
    return ok(reply, data, 'Status QRIS toko');
  });

  // 3. Generate Dynamic QRIS Otomatis untuk Transaksi Kasir POS
  app.post('/qris/generate', { schema: tokoSchema.generateQris }, async (req, reply) => {
    const { nominal } = req.body || {};
    const data = await generateDynamicQris(req.toko_id, nominal);
    return ok(reply, data, 'QRIS dinamis berhasil dibuat');
  });

  app.post('/toko/qris/generate', { schema: tokoSchema.generateQris }, async (req, reply) => {
    const { nominal } = req.body || {};
    const data = await generateDynamicQris(req.toko_id, nominal);
    return ok(reply, data, 'QRIS dinamis berhasil dibuat');
  });

  // 4. Verifikasi PIN 6-Digit Kasir untuk Otorisasi Cepat di Layar POS
  app.post('/verifikasi-pin', { schema: penggunaSchema.verifikasiPin }, async (req, reply) => {
    const data = await verifikasiPinKasir(req.toko_id, req.pengguna.id, req.body.pin);
    return ok(reply, data, 'PIN kasir valid');
  });
}
