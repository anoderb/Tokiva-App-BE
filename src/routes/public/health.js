import { supabaseAdmin } from '../../lib/supabase.js';
import { ok, fail } from '../../utils/response.js';

export default async function healthRoutes(app) {
  app.get('/health', {
    schema: {
      tags: ['Public'],
      summary: 'Periksa status kesehatan server dan konektivitas Supabase Cloud',
    },
  }, async (req, reply) => {
    try {
      const { data, error } = await supabaseAdmin.from('toko').select('id, nama').limit(1);

      if (error) {
        throw error;
      }

      return ok(reply, {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          message: 'Koneksi ke Supabase berhasil',
        },
      }, 'Backend Tokiva POS berjalan optimal');
    } catch (err) {
      return fail(reply, `Layanan backend berjalan namun Supabase terkendala: ${err.message}`, 503);
    }
  });
}

