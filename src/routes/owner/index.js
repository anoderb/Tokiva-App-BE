import { authenticate, requireRole } from '../../plugins/auth.js';
import ownerKategoriRoutes from './kategori.js';
import ownerProdukRoutes from './produk.js';
import ownerShiftRoutes from './shift.js';
import ownerTransaksiRoutes from './transaksi.js';
import ownerPelangganRoutes from './pelanggan.js';
import ownerKulakanRoutes from './kulakan.js';
import ownerLaporanRoutes from './laporan.js';
import ownerDashboardRoutes from './dashboard.js';
import ownerAiRoutes from './ai.js';
import ownerTokoRoutes from './toko.js';
import ownerKasirRoutes from './kasir.js';
import mediaRoutes from '../shared/media.js';

export default async function ownerRoutes(app) {
  // Pasang guard sekali di level namespace /api/owner
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('owner', 'superadmin'));

  // Registrasi sub-rute owner
  await app.register(ownerDashboardRoutes);
  await app.register(ownerKategoriRoutes);
  await app.register(ownerProdukRoutes);
  await app.register(ownerShiftRoutes);
  await app.register(ownerTransaksiRoutes);
  await app.register(ownerPelangganRoutes);
  await app.register(ownerKulakanRoutes);
  await app.register(ownerLaporanRoutes);
  await app.register(ownerAiRoutes);
  await app.register(ownerTokoRoutes);
  await app.register(ownerKasirRoutes);
  await app.register(mediaRoutes);
}
