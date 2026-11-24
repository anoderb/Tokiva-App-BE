import { authenticate, requireRole } from '../../plugins/auth.js';
import kasirKategoriRoutes from './kategori.js';
import kasirProdukRoutes from './produk.js';
import kasirShiftRoutes from './shift.js';
import kasirTransaksiRoutes from './transaksi.js';
import kasirPelangganRoutes from './pelanggan.js';
import kasirArusKasRoutes from './arus-kas.js';
import kasirAiRoutes from './ai.js';
import kasirTokoRoutes from './toko.js';
import mediaRoutes from '../shared/media.js';

export default async function kasirRoutes(app) {
  // Pasang guard sekali di level namespace /api/kasir
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('kasir', 'owner', 'superadmin'));

  // Registrasi sub-rute kasir
  await app.register(kasirKategoriRoutes);
  await app.register(kasirProdukRoutes);
  await app.register(kasirShiftRoutes);
  await app.register(kasirTransaksiRoutes);
  await app.register(kasirPelangganRoutes);
  await app.register(kasirArusKasRoutes);
  await app.register(kasirAiRoutes);
  await app.register(kasirTokoRoutes);
  await app.register(mediaRoutes);
}
