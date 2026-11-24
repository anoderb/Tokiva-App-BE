/**
 * Error Kustom Terstandarisasi untuk Tokiva POS API
 */

export class AppError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequest extends AppError {
  constructor(message = 'Permintaan tidak valid', errors = null) {
    super(message, 400, errors);
  }
}

export class Unauthorized extends AppError {
  constructor(message = 'Autentikasi diperlukan atau token tidak valid', errors = null) {
    super(message, 401, errors);
  }
}

export class Forbidden extends AppError {
  constructor(message = 'Anda tidak memiliki hak akses untuk tindakan ini', errors = null) {
    super(message, 403, errors);
  }
}

export class NotFound extends AppError {
  constructor(message = 'Data atau resource tidak ditemukan', errors = null) {
    super(message, 404, errors);
  }
}

export class Conflict extends AppError {
  constructor(message = 'Terjadi konflik data (duplikasi)', errors = null) {
    super(message, 409, errors);
  }
}

