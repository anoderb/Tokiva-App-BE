import {
  getDashboardAdmin,
  listTokoPlatform,
  getDetailTokoPlatform,
  createTokoDanOwner,
  updateStatusToko,
  listPenggunaPlatform,
  updateStatusPenggunaPlatform,
} from '../../services/admin/platform.js';
import { adminSchema } from '../../schemas/admin.js';
import { ok } from '../../utils/response.js';

export default async function adminTokoRoutes(app) {
  // 1. Dashboard Eksekutif Superadmin Platform
  app.get('/dashboard', { schema: adminSchema.dashboard }, async (req, reply) => {
    const data = await getDashboardAdmin();
    return ok(reply, data);
  });

  // 2. Manajemen Toko Tenant
  app.get('/toko', { schema: adminSchema.listToko }, async (req, reply) => {
    const data = await listTokoPlatform(req.query);
    return ok(reply, data);
  });

  app.get('/toko/:id', { schema: adminSchema.detailToko }, async (req, reply) => {
    const data = await getDetailTokoPlatform(req.params.id);
    return ok(reply, data);
  });

  app.post('/toko', { schema: adminSchema.createToko }, async (req, reply) => {
    const data = await createTokoDanOwner(req.body);
    return ok(reply, data, 'Toko dan akun owner baru berhasil dibuat', 201);
  });

  app.put('/toko/:id/status', { schema: adminSchema.updateStatusToko }, async (req, reply) => {
    const data = await updateStatusToko(req.params.id, req.body.status);
    return ok(reply, data, `Status toko diperbarui menjadi '${data.status}'`);
  });

  // 3. Manajemen Pengguna Lintas Platform
  app.get('/pengguna', { schema: adminSchema.listPengguna }, async (req, reply) => {
    const data = await listPenggunaPlatform(req.query);
    return ok(reply, data);
  });

  app.put('/pengguna/:id/status', { schema: adminSchema.updateStatusPengguna }, async (req, reply) => {
    const data = await updateStatusPenggunaPlatform(req.params.id, req.body.aktif, req.pengguna?.id || null);
    return ok(reply, data, 'Status akun pengguna berhasil diperbarui');
  });
}
