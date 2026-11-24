/**
 * Helper Standar Respons JSON Tokiva POS
 */

export function ok(reply, data = null, message = 'Berhasil', statusCode = 200) {
  const payload = {
    success: true,
    message,
    data,
  };
  return reply.status(statusCode).send(payload);
}

export function fail(reply, message = 'Terjadi kesalahan pada server', statusCode = 500, errors = null) {
  const payload = {
    success: false,
    message,
  };
  if (errors) {
    payload.errors = errors;
  }
  return reply.status(statusCode).send(payload);
}
