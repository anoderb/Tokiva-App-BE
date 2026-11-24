import {
  getProfilToko,
  updateProfilToko,
  updatePengaturanStruk,
  updatePengaturanQRIS,
  getQrisStatus,
  generateDynamicQris,
} from '../../services/toko/toko.js';
import { tokoSchema } from '../../schemas/toko.js';
import { ok } from '../../utils/response.js';

export default async function ownerTokoRoutes(app) {
  // 1. Profil Toko
  app.get('/toko/profil', { schema: tokoSchema.getProfil }, async (req, reply) => {
    const data = await getProfilToko(req.toko_id);
    return ok(reply, data);
  });

  app.get('/toko', { schema: tokoSchema.getProfil }, async (req, reply) => {
    const data = await getProfilToko(req.toko_id);
    return ok(reply, data);
  });

  app.put('/toko/profil', { schema: tokoSchema.updateProfil }, async (req, reply) => {
    const data = await updateProfilToko(req.toko_id, req.body);
    return ok(reply, data, 'Profil toko berhasil diperbarui');
  });

  // 2. Pengaturan Format Struk Thermal 58mm / 80mm
  app.put('/toko/struk', { schema: tokoSchema.updateStruk }, async (req, reply) => {
    const data = await updatePengaturanStruk(req.toko_id, req.body);
    return ok(reply, data, 'Pengaturan struk thermal berhasil disimpan');
  });

  // 3. Status QRIS Toko (EMVCo)
  app.get('/toko/qris/status', { schema: tokoSchema.qrisStatus }, async (req, reply) => {
    const data = await getQrisStatus(req.toko_id);
    return ok(reply, data, 'Status QRIS toko');
  });

  // 4. Pengaturan & Validasi QRIS Statis Toko
  app.put('/toko/qris', { schema: tokoSchema.updateQRIS }, async (req, reply) => {
    const data = await updatePengaturanQRIS(req.toko_id, req.body);
    return ok(reply, data, 'Pengaturan QRIS berhasil diverifikasi dan disimpan');
  });

  // 5. Test Generate Dynamic QRIS
  app.post('/toko/qris/generate', { schema: tokoSchema.generateQris }, async (req, reply) => {
    const { nominal } = req.body || {};
    const data = await generateDynamicQris(req.toko_id, nominal);
    return ok(reply, data, 'QRIS dinamis berhasil dibuat');
  });
}
