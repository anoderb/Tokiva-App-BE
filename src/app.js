import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';

import { config } from './config/env.js';
import { setupSwagger } from './plugins/swagger.js';
import { setupErrorHandler } from './plugins/error-handler.js';

// Route Imports (Pemisahan Peran)
import publicRoutes from './routes/public/index.js';
import kasirRoutes from './routes/kasir/index.js';
import ownerRoutes from './routes/owner/index.js';
import adminRoutes from './routes/admin/index.js';

function buildAllowedOrigins() {
  const raw = String(config.cors.origin || 'http://localhost:3000');
  const set = new Set();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      set.add(new URL(trimmed).origin);
    } catch {
      set.add(trimmed.replace(/\/+$/, ''));
    }
  }
  if (config.email?.appUrl) {
    try {
      set.add(new URL(config.email.appUrl).origin);
    } catch {
      // Abaikan URL tidak valid
    }
  }
  return set;
}

export function isOriginAllowed(origin, allowedOrigins, isDev = config.isDev) {
  if (!origin) return true; // Non-browser / server-to-server / curl tanpa header Origin
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (allowedOrigins.has(parsed.origin)) {
    return true;
  }

  if (isDev && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return true;
  }

  return false;
}

export async function buildApp() {
  const app = Fastify({
    bodyLimit: 25 * 1024 * 1024, // 25 MiB untuk upload multi-foto dataset burst
    logger: {
      level: config.isDev ? 'info' : 'warn',
      transport: config.isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  });

  // 0. JSON Parser toleran terhadap body kosong (DELETE / POST tanpa body dengan header JSON)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || body.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // 1. Strict CORS Whitelist
  const allowedOrigins = buildAllowedOrigins();
  await app.register(cors, {
    origin: (origin, cb) => {
      if (isOriginAllowed(origin, allowedOrigins, config.isDev)) {
        cb(null, true);
        return;
      }
      const err = new Error('Origin tidak diizinkan oleh kebijakan CORS');
      err.statusCode = 403;
      cb(err, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // 1b. Security Headers Standar (pengganti ringan helmet tanpa mengganggu /docs)
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
  });

  // 2. Cookie & JWT
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwt.secret,
    cookie: {
      cookieName: 'tokiva_token',
      signed: false,
    },
  });

  // 3. Multipart File Upload
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 5,
    },
  });

  // 4. Rate Limiting
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  // 5. Swagger OpenAPI UI (/docs)
  await setupSwagger(app);

  // 6. Registrasi Rute (Terisolasi per Peran)
  await app.register(publicRoutes, { prefix: '/api' });
  await app.register(kasirRoutes, { prefix: '/api/kasir' });
  await app.register(ownerRoutes, { prefix: '/api/owner' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  // 7. Penanganan Error Global & Not Found
  setupErrorHandler(app);

  return app;
}
