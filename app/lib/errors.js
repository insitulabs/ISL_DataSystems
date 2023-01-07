class BadRequest extends Error {
  constructor(message = 'Bad Request', ...params) {
    super(message, params);

    this.name = 'BadRequest';
    this.logLevel = false;
    this.statusCode = 400;
    this.silent = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BadRequest);
    }
  }
}

class NotFound extends Error {
  constructor(message = 'Not Found', ...params) {
    super(message, params);

    this.name = 'NotFound';
    this.logLevel = false;
    this.statusCode = 404;
    this.silent = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BadRequest);
    }
  }
}

class Unauthorized extends Error {
  constructor(message = 'Unauthorized', ...params) {
    super(message, params);
    this.name = 'Unauthorized';
    this.logLevel = false;
    this.statusCode = 401;
    this.silent = true;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, Unauthorized);
    }
  }
}

module.exports = {
  BadRequest,
  NotFound,
  Unauthorized
};

