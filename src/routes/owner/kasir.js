import {
  listKasir,
  getDetailKasir,
  createKasir,
  resendKasirInvite,
  updateKasir,
  resetPinKasir,
  deleteKasir,
} from '../../services/pengguna/kasir.js';
import { penggunaSchema } from '../../schemas/pengguna.js';
import { ok } from '../../utils/response.js';

export default async function ownerKasirRoutes(app) {
  // 1. Daftar Karyawan Kasir
  app.get('/karyawan', { schema: penggunaSchema.listKasir }, async (req, reply) => {
    const data = await listKasir(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Tambah / Undang Akun Kasir Baru
  app.post('/karyawan', { schema: penggunaSchema.createKasir }, async (req, reply) => {
    const data = await createKasir(req.toko_id, req.body);
    const msg = data.undangan_terkirim
      ? `Undangan aktivasi kasir telah dikirim ke ${data.email}`
      : 'Akun kasir berhasil dibuat';
    return ok(reply, data, msg, 201);
  });

  // 2b. Kirim Ulang Undangan Kasir
  app.post('/karyawan/:id/invite', { schema: penggunaSchema.resendInvite }, async (req, reply) => {
    const data = await resendKasirInvite(req.toko_id, req.params.id);
    return ok(reply, data, data.message);
  });

  // 3. Detail Profil Kasir & Statistik
  app.get('/karyawan/:id', { schema: penggunaSchema.detailKasir }, async (req, reply) => {
    const data = await getDetailKasir(req.toko_id, req.params.id);
    return ok(reply, data);
  });

  // 4. Perbarui Data Kasir
  app.put('/karyawan/:id', { schema: penggunaSchema.updateKasir }, async (req, reply) => {
    const data = await updateKasir(req.toko_id, req.params.id, req.body);
    return ok(reply, data, 'Data kasir berhasil diperbarui');
  });

  // 5. Reset PIN 6-Digit Kasir
  app.post('/karyawan/:id/reset-pin', { schema: penggunaSchema.resetPinKasir }, async (req, reply) => {
    const data = await resetPinKasir(req.toko_id, req.params.id, req.body);
    return ok(reply, data, data.message);
  });

  // 6. Nonaktifkan / Hapus Akun Kasir
  app.delete('/karyawan/:id', { schema: penggunaSchema.deleteKasir }, async (req, reply) => {
    const data = await deleteKasir(req.toko_id, req.params.id);
    return ok(reply, data, data.message);
  });
}
