const jwt = require('jsonwebtoken');
const CONFIG = require('../config');
const crypto = require('crypto');

const CRYPTO_ALGORITHM = 'aes256';

module.exports = {
  getUserToken: (email, destination) => {
    return jwt.sign({ email, destination }, CONFIG.TOKEN_SECRET, {
      expiresIn: '5m'
    });
  },

  validateUserToken: (token) => {
    return jwt.verify(token, CONFIG.TOKEN_SECRET);
  },

  encrypt: (str) => {
    let cipher = crypto.createCipheriv(CRYPTO_ALGORITHM, CONFIG.CRYPTO_KEY, CONFIG.CRYPTO_SALT);
    return cipher.update(str, 'utf8', 'hex') + cipher.final('hex');
  },

  decrypt: (str) => {
    let decipher = crypto.createDecipheriv(CRYPTO_ALGORITHM, CONFIG.CRYPTO_KEY, CONFIG.CRYPTO_SALT);
    return decipher.update(str, 'hex', 'utf8') + decipher.final('utf8');
  }
};

