import { getDashboardOwner } from '../../services/laporan/dashboard.js';
import { getLaporanPenjualan } from '../../services/laporan/penjualan.js';
import { getLaporanLabaRugi } from '../../services/laporan/laba-rugi.js';
import { opnameStok, getStokMenipis } from '../../services/stok/opname.js';
import { laporanSchema } from '../../schemas/laporan.js';
import { ok } from '../../utils/response.js';

export default async function ownerDashboardRoutes(app) {
  // 1. Dashboard Utama Owner
  app.get('/dashboard', { schema: laporanSchema.dashboardOwner }, async (req, reply) => {
    const data = await getDashboardOwner(req.toko_id);
    return ok(reply, data);
  });

  // 2. Laporan Analitik Penjualan & Metode Pembayaran
  app.get('/laporan/penjualan', { schema: laporanSchema.laporanPenjualan }, async (req, reply) => {
    const data = await getLaporanPenjualan(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 3. Laporan Laba Rugi (Omzet - HPP - Beban Operasional)
  app.get('/laporan/laba-rugi', { schema: laporanSchema.laporanLabaRugi }, async (req, reply) => {
    const data = await getLaporanLabaRugi(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 4. Stok Opname Fisik & Daftar Stok Menipis
  app.post('/stok/opname', { schema: laporanSchema.opnameStok }, async (req, reply) => {
    const data = await opnameStok(req.toko_id, req.body);
    return ok(reply, data, 'Stok opname berhasil dicatat');
  });

  app.get('/stok/menipis', { schema: laporanSchema.stokMenipis }, async (req, reply) => {
    const data = await getStokMenipis(req.toko_id);
    return ok(reply, data);
  });
}

