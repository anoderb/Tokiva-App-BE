import healthRoutes from './health.js';
import authRoutes from './auth.js';
import mediaProxyRoutes from './media-proxy.js';
import { config } from '../../config/env.js';
import { handleExternalCronTick } from '../../services/ai/scheduler.js';
import { aiSchema } from '../../schemas/ai.js';
import { ok } from '../../utils/response.js';

export default async function publicRoutes(app) {
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(mediaProxyRoutes);

  app.post('/ai/automation/tick', { schema: aiSchema.automationTick }, async (req, reply) => {
    const secret = config.automation?.cronSecret;
    const provided = req.headers['x-cron-secret'];
    if (!secret || provided !== secret) {
      return reply.code(401).send({
        success: false,
        message: 'Unauthorized cron secret',
      });
    }
    const data = await handleExternalCronTick(req.body || {});
    return ok(reply, data, 'Tick otomatisasi cron berhasil dieksekusi');
  });
}
