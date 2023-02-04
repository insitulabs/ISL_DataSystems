const CurrentUser = require('./current-user');

/**
 *
 * @param {} res
 * @return {CurrentUser} user
 */
exports.getCurrentUser = function (res) {
  return res.locals.user;
};

/**
 * Middleware to prevent browser cache.
 * @param {*} req
 * @param {*} res
 * @param {*} next
 */
exports.noCacheMiddleware = function (req, res, next) {
  res.header('Cache-Control', 'private, no-cache, no-store');
  res.header('Expires', '-1');
  res.header('Pragma', 'no-cache');
  next();
};

