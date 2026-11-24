import { fail } from '../utils/response.js';

export function setupErrorHandler(app) {
  // 1. Not Found Handler
  app.setNotFoundHandler((request, reply) => {
    return fail(reply, `Endpoint ${request.method} ${request.url} tidak ditemukan`, 404);
  });

  // 2. Global Error Handler
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);

    // Fastify schema validation errors
    if (error.validation) {
      return fail(
        reply,
        `Validasi data gagal: ${error.message}`,
        400,
        error.validation
      );
    }

    const statusCode = error.statusCode || 500;
    const isInternalError = statusCode >= 500 && !error.statusCode;
    const message = isInternalError
      ? 'Terjadi kesalahan internal pada server'
      : error.message || 'Terjadi kesalahan internal pada server';

    return fail(reply, message, statusCode, error.errors || null);
  });
}

