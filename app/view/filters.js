const prettyBytes = require('pretty-bytes');
const dayjs = require('dayjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const CONFIG = require('../config');

// const currencyFormatter = new Intl.NumberFormat('en-US', {
//   minimumFractionDigits: 2
// });

const numberFormatter = new Intl.NumberFormat('en-US');

const assetVersions = {};

module.exports = function (nunjucks) {
  /**
   * Take an MD5 hash of the file and append it as a ?v query param. To bush caches.
   */
  nunjucks.addFilter(
    'appendVersion',
    (fileName, callback) => {
      if (CONFIG.IS_LOCAL_DEV_ENV) {
        callback(null, fileName);
        return;
      }

      if (assetVersions[fileName]) {
        callback(null, assetVersions[fileName]);
        return;
      }

      const output = crypto.createHash('md5');
      const input = fs.createReadStream(path.join(__dirname, '..', fileName));

      input.on('error', (err) => {
        callback(err);
      });

      output.once('readable', () => {
        assetVersions[fileName] = fileName + '?v=' + output.read().toString('hex');
        callback(null, assetVersions[fileName]);
      });

      input.pipe(output);
    },
    true
  );

  nunjucks.addFilter('formatDate', (date, format = 'MMM D, YYYY') => {
    let day = dayjs(date);
    if (!day.isValid()) {
      return 'Invalid Date';
    }

    return day.format(format);
  });

  nunjucks.addFilter('prettyBytes', (bytes) => {
    if (!bytes || isNaN(bytes)) {
      return 0;
    }

    return prettyBytes(bytes);
  });

  nunjucks.addFilter('formatCurrency', (value) => {
    if (!value || isNaN(value)) {
      return 0;
    }
    return currencyFormatter.format(value);
  });

  nunjucks.addFilter('formatNumber', (value) => {
    if (!value || isNaN(value)) {
      return 0;
    }
    return value.toLocaleString(value);
  });

  nunjucks.addFilter('formatValue', (value) => {
    if (value === null || value === undefined) {
      return '';
    }

    let type = typeof value;
    if (type === 'object' && value instanceof Date) {
      let day = dayjs(value);
      if (!day.isValid()) {
        return 'Invalid Date';
      }

      return day.format('MMM D, YYYY HH:mm');
    } else if (type === 'number') {
      return numberFormatter.format(value);
    }

    return value;
  });

  nunjucks.addFilter('nl2br', (value) => {
    if (value) {
      return value.replace(/\n/g, '<br>');
    }
    return '';
  });

  nunjucks.addFilter('prettyJSON', (value) => {
    return JSON.stringify(value, undefined, 2);
  });
};

