const CurrentUser = require('./current-user');

/**
 *
 * @param {} res
 * @return {CurrentUser} user
 */
exports.getCurrentUser = function (res) {
  return res.locals.user;
};

