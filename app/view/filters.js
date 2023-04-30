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
   * Take an MD5 hash of the file and append it as a ?v query param. To bust caches.
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

    const si = true;
    const thresh = si ? 1000 : 1024;
    const dp = 1;

    if (Math.abs(bytes) < thresh) {
      return bytes + ' B';
    }

    const units = si
      ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
      : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    const r = 10 ** dp;

    do {
      bytes /= thresh;
      ++u;
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
    return bytes.toFixed(dp) + ' ' + units[u];
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

  nunjucks.addFilter('shortenID', (value) => {
    if (value && typeof value === 'string') {
      let len = value.length;
      return value.substring(len - 5, len);
    }
    return null;
  });

  nunjucks.addFilter('userAuditDelta', (delta) => {
    if (delta) {
      let keys = Object.keys(delta);
      keys.sort((a, b) => {
        return a.toLowerCase().localeCompare(b.toLowerCase());
      });
      return keys.join(', ');
    }
    return '';
  });
};

