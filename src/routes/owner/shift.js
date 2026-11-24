import { getRiwayatShift, getRingkasanShift } from '../../services/shift/ringkasan.js';
import { shiftSchema } from '../../schemas/shift.js';
import { ok } from '../../utils/response.js';

export default async function ownerShiftRoutes(app) {
  // 1. Rekapitulasi Riwayat Shift Kasir Toko
  app.get('/shift', { schema: shiftSchema.riwayat }, async (req, reply) => {
    const data = await getRiwayatShift(req.toko_id, req.query);
    return ok(reply, data);
  });

  // 2. Detail 1 Sesi Shift Kasir
  app.get('/shift/:id', { schema: shiftSchema.detail }, async (req, reply) => {
    const data = await getRingkasanShift(req.toko_id, req.params.id);
    return ok(reply, data);
  });
}

