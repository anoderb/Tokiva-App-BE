import { authenticate, requireRole } from '../../plugins/auth.js';
import adminTokoRoutes from './toko.js';
import adminProdukMasterRoutes from './produk-master.js';
import adminAiRoutes from './ai.js';
import mediaRoutes from '../shared/media.js';
import { ok } from '../../utils/response.js';

export default async function adminRoutes(app) {
  // Pasang guard sekali di level namespace /api/admin
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('superadmin'));

  app.get('/status', {
    schema: {
      tags: ['Admin Platform'],
      summary: 'Status platform superadmin',
    },
  }, async (req, reply) => {
    return ok(reply, {
      admin: req.pengguna.nama_lengkap,
      peran: req.pengguna.peran,
    }, 'Area administrasi platform aktif');
  });

  await app.register(adminTokoRoutes);
  await app.register(adminProdukMasterRoutes);
  await app.register(adminAiRoutes);
  await app.register(mediaRoutes);
}
