import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from '../config/env.js';

export async function setupSwagger(app) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Tokiva POS - Backend REST API (v2)',
        description: 'REST API Point of Sale Tokiva dengan arsitektur terisolasi per peran: Kasir, Owner, dan Admin Platform.',
        version: '2.0.0',
      },
      servers: [
        {
          url: `http://localhost:${config.port}`,
          description: 'Local Development Server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      tags: [
        { name: 'Public', description: 'Endpoint terbuka (Health & Autentikasi)' },
        { name: 'Kasir Operations', description: 'Operasional POS meja kasir (/api/kasir)' },
        { name: 'Owner Operations', description: 'Manajemen toko, keuangan & staf (/api/owner)' },
        { name: 'Admin Platform', description: 'Master katalog & AI Skripsi (/api/admin)' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

