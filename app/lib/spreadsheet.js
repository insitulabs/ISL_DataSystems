const XLSX = require('xlsx');
const Errors = require('./errors');

/**
 * Parse a spreadsheet into a headers and records.
 * @param {string} filePath The path to the file to parse.
 * @return {object}
 */
exports.parseSpreadsheet = function (filePath) {
  if (!filePath) {
    throw new Errors.BadRequest('Missing spreadsheet file');
  }

  let workbook = XLSX.readFile(filePath, {});
  if (!workbook.SheetNames.length) {
    throw new Errors.BadRequest('No sheets in spreadsheet');
  }

  let worksheet = workbook.Sheets[workbook.SheetNames[0]];

  let headers = [];
  const columnCount = XLSX.utils.decode_range(worksheet['!ref']).e.c + 1;
  for (let i = 0; i < columnCount; ++i) {
    let col = worksheet[`${XLSX.utils.encode_col(i)}1`];
    if (col) {
      headers.push(worksheet[`${XLSX.utils.encode_col(i)}1`].v);
    }
  }

  headers = headers
    .map((h) => {
      if (typeof h === 'string') {
        return h.trim();
      } else {
        return String(h);
      }
    })
    .filter(Boolean);

  if (!headers.length) {
    throw new Errors.BadRequest('Spreadsheet headers are required');
  }

  let duplicateFields = headers.reduce((dups, f) => {
    if (dups[f]) {
      dups[f]++;
    } else {
      dups[f] = 1;
    }

    return dups;
  }, {});
  let duplicates = Object.keys(duplicateFields).filter((f) => duplicateFields[f] > 1);
  if (duplicates.length) {
    throw new Errors.BadRequest('Spreadsheet has duplicate columns: ' + duplicates.join(', '));
  }

  let records = XLSX.utils.sheet_to_json(worksheet, { raw: false });

  if (!records || !Array.isArray(records) || !records.length) {
    throw new Errors.BadRequest('Records are required');
  }

  // Clean up any bad CSV spacing:
  records = records.map((r) => {
    let cleaned = {};
    for (const key of Object.keys(r)) {
      cleaned[key.trim()] = typeof r[key] === 'string' ? r[key].trim() : r[key];
    }
    return cleaned;
  });

  return {
    headers,
    records
  };
};

