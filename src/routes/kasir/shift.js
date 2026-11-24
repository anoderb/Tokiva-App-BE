import { bukaShift, getShiftAktif, tutupShift } from '../../services/shift/buka-tutup.js';
import { getRiwayatShift, getRingkasanShift } from '../../services/shift/ringkasan.js';
import { shiftSchema } from '../../schemas/shift.js';
import { ok } from '../../utils/response.js';

export default async function kasirShiftRoutes(app) {
  // 1. Buka Shift Baru
  app.post('/shift/buka', { schema: shiftSchema.buka }, async (req, reply) => {
    const data = await bukaShift(req.toko_id, req.pengguna.id, req.body || {});
    return ok(reply, data, 'Shift kasir berhasil dibuka', 201);
  });

  // 2. Cek Shift Aktif
  app.get('/shift/aktif', { schema: shiftSchema.aktif }, async (req, reply) => {
    const data = await getShiftAktif(req.toko_id, req.pengguna.id);
    return ok(reply, data, data ? 'Shift aktif ditemukan' : 'Tidak ada shift aktif');
  });

  // 3. Riwayat Shift Kasir (kasir hanya melihat shift miliknya)
  app.get('/shift/riwayat', { schema: shiftSchema.riwayat }, async (req, reply) => {
    const queryParams = { ...(req.query || {}) };
    if (req.pengguna?.peran === 'kasir') {
      queryParams.kasir_id = req.pengguna.id;
    }
    const data = await getRiwayatShift(req.toko_id, queryParams);
    return ok(reply, data);
  });

  // 4. Detail 1 Shift Kasir
  app.get('/shift/:id', { schema: shiftSchema.detail }, async (req, reply) => {
    const kasirIdGuard = req.pengguna?.peran === 'kasir' ? req.pengguna.id : null;
    const data = await getRingkasanShift(req.toko_id, req.params.id, kasirIdGuard);
    return ok(reply, data);
  });

  // 5. Tutup Shift Kasir & Audit Laci
  app.post('/shift/:id/tutup', { schema: shiftSchema.tutup }, async (req, reply) => {
    const isKasirRole = req.pengguna?.peran === 'kasir';
    const data = await tutupShift(req.toko_id, req.pengguna.id, req.params.id, req.body, {
      enforceOwnShift: isKasirRole,
    });
    return ok(reply, data, 'Shift kasir berhasil ditutup');
  });
}
