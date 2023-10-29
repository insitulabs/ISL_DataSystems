const CONFIG = require('../config');
const { MongoClient, Collection } = require('mongodb');
const util = require('util');
const Errors = require('../lib/errors');

let _mongoClient = new MongoClient(CONFIG.MONGO_URI);

class Base {
  workspace = null;
  DB_NAME = null;
  connected = false;

  constructor(workspace) {
    this.workspace = workspace;
    this.DB_NAME = workspace.dbName;
  }

  static close() {
    _mongoClient.close();
  }

  static async client() {
    return _mongoClient;
  }

  static normalizeFieldName(name) {
    if (name && typeof name === 'string') {
      // Never let fields have . in them, or Mongo will blow up
      // Also just remove special chars
      return name
        .toLowerCase()
        .replace(/\./g, '__')
        .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
    }
    return null;
  }

  async connect() {
    console.log('connect deprecated, use db');
    return this.db();
  }

  db() {
    return _mongoClient.db(this.DB_NAME);
  }

  /**
   * Returns a reference to a MongoDB Collection. If it does not exist it will be created implicitly.
   * @param {string} name The DB collection name.
   * @return {Collection}
   */
  collection(name) {
    return _mongoClient.db(this.DB_NAME).collection(name);
  }

  debug(data) {
    console.log(util.inspect(data, { showHidden: false, depth: null, maxArrayLength: null }));
  }

  /**
   * Get the field mapping for a given key.
   * @param {string} field
   * @return {string}
   */
  getFieldKey(field) {
    if (!field) {
      return null;
    }

    if (['_id', 'created', 'imported'].includes(field)) {
      return field;
    }

    return `data.${field}`;
  }

  /**
   * Build the match and addFields aggregation steps for filtering submissions.
   * @param {object} filters
   * @return {object} Object with match and addFields keys
   */
  filterSubmissions(filters) {
    // Cast fields to filter as string, so regex works correctly on numbers.
    let match = {};
    let addFields = {};
    if (filters) {
      let filterBy = Object.keys(filters).map((field) => {
        let values = filters[field];
        let valueFilters = values.map((value) => {
          let expression = {};
          let castTo = 'string';
          let onError = null;

          let isNot = /^!/.test(value);
          if (isNot) {
            value = value.replace(/^!\s*/, '');
          }

          // > 2022-33-02 && < 2022-23-02
          let dateCompare =
            /^([[<>=]+)\s*(\d{4}-\d{2}-\d{2})(?:\s+(?:and|&&?)\s+([[<>=]+)\s*(\d{4}-\d{2}-\d{2}))?/.exec(
              value
            );

          // > 10 && <= 20
          let numericalCompare =
            /^([[<>=]+)\s*([\d.]+)(?:\s+(?:and|&&?)\s+([[<>=]+)\s*([\d.]+))?/.exec(value);

          if (dateCompare) {
            castTo = 'date';
            onError = null;
            let operator = '$eq';
            if (dateCompare[1] === '>') {
              operator = '$gt';
            } else if (dateCompare[1] === '>=') {
              operator = '$gte';
            } else if (dateCompare[1] === '<') {
              operator = '$lt';
            } else if (dateCompare[1] === '<=') {
              operator = '$lte';
            }

            expression[operator] = new Date(dateCompare[2]);
            if (dateCompare.filter(Boolean).length === 5) {
              let secOperator = '$eq';
              if (dateCompare[3] === '>') {
                secOperator = '$gt';
              } else if (dateCompare[3] === '>=') {
                secOperator = '$gte';
              } else if (dateCompare[3] === '<') {
                secOperator = '$lt';
              } else if (dateCompare[3] === '<=') {
                secOperator = '$lte';
              }
              expression[secOperator] = new Date(dateCompare[4]);
            }
          } else if (numericalCompare) {
            castTo = 'double';
            onError = 0;
            let operator = '$eq';
            if (numericalCompare[1] === '>') {
              operator = '$gt';
            } else if (numericalCompare[1] === '>=') {
              operator = '$gte';
            } else if (numericalCompare[1] === '<') {
              operator = '$lt';
            } else if (numericalCompare[1] === '<=') {
              operator = '$lte';
            }

            expression[operator] = parseFloat(numericalCompare[2]);
            if (numericalCompare.filter(Boolean).length === 5) {
              let secOperator = '$eq';
              if (numericalCompare[3] === '>') {
                secOperator = '$gt';
              } else if (numericalCompare[3] === '>=') {
                secOperator = '$gte';
              } else if (numericalCompare[3] === '<') {
                secOperator = '$lt';
              } else if (numericalCompare[3] === '<=') {
                secOperator = '$lte';
              }
              expression[secOperator] = parseFloat(numericalCompare[4]);
            }
          } else if (value.trim() === '*') {
            expression = { $exists: true, $ne: null };

            // If isNot, inverse to mean value does not exist.
            if (isNot) {
              isNot = false;
              expression = null;
            }
          } else if (value.trim() === 'null') {
            expression = null;

            // If isNot, inverse to mean value exists.
            if (isNot) {
              isNot = false;
              expression = { $exists: true, $ne: null };
            }
          } else {
            // If the value is wrapped in quotes, do an exact string equals
            let equalsExp = /^['"](.+)['"]$/.exec(value);
            if (equalsExp) {
              expression['$eq'] = equalsExp[1];
            } else {
              let regex = null;
              let realRegExp = /^\/(.+)\/([a-z]?)$/.exec(value);
              if (realRegExp) {
                try {
                  regex = new RegExp(realRegExp[1], realRegExp.length === 3 ? realRegExp[2] : null);
                } catch (err) {}
              }

              if (!regex) {
                let escapedV = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                regex = new RegExp(escapedV, 'i');
              }

              expression['$regex'] = regex;
            }
          }

          let filterField = '_filter.' + field + '_' + castTo;
          addFields[filterField] = {
            $convert: {
              input: '$' + this.getFieldKey(field),
              to: castTo,
              onError: onError,
              onNull: onError
            }
          };

          let filter = {};
          if (isNot) {
            filter[filterField] = { $not: expression };
          } else {
            filter[filterField] = expression;
          }
          return filter;
        });

        if (valueFilters.length === 1) {
          return valueFilters[0];
        } else {
          return valueFilters;
        }
      });

      let $or = [];
      for (let filter of filterBy) {
        if (Array.isArray(filter)) {
          $or = $or.concat(filter);
        } else {
          let [key, value] = Object.entries(filter)[0];
          match[key] = value;
        }
      }

      if ($or.length) {
        match.$or = $or;
      }
    }

    return {
      match,
      addFields
    };
  }

  groupByOperation(operationStr) {
    if (!operationStr && typeof operationStr !== 'string') {
      throw new Errors.BadRequest('Invalid group operation');
    }
    let operation = null;
    let operationField = null;
    operationStr = operationStr.split(':');
    if (operationStr.length < 2) {
      throw new Errors.BadRequest('Invalid group operation');
    }

    return {
      operation: operationStr.shift(),
      operationField: operationStr.join('')
    };
  }

  /**
   * Build a $group stage for Mongo aggregation.
   *
   *  {
   *    '$group': {
   *       _id: { '0': { '$ifNull': [ '$data.file', null ] } },
   *       count: { '$count': {} }
   *     }
   *  }, {
   *    '$addFields': {
   *       data: { file: '$_id.0', count: '$count' }
   *    }
   *  }
   *
   * @param {String|Array} groupId The list of fields to group by.
   * @param {String} operationStr The operation string: 'count:*' or 'sum:[fieldId]'
   * @return {object}
   */
  groupByStage(groupId, operationStr) {
    if (groupId && !Array.isArray(groupId)) {
      groupId = [groupId];
    }

    if (!groupId || !groupId.filter(Boolean).length) {
      throw new Errors.BadRequest('Invalid group ID');
    }

    let operation = null;
    let operationField = null;
    if (!operationStr && typeof operationStr !== 'string') {
      throw new Errors.BadRequest('Invalid group operation');
    }
    operationStr = operationStr.split(':');
    if (operationStr.length < 2) {
      throw new Errors.BadRequest('Invalid group operation');
    }
    operation = operationStr.shift();
    operationField = operationStr.join('');

    let dataFields = {};
    // Evaluate if this is the best way to do an ID. it's kind of ugly output.
    groupId = groupId.reduce((agg, field, index) => {
      // Ensure we always have every key accounted for in our groupId object, even if null.
      agg[index] = { $ifNull: ['$' + this.getFieldKey(field), null] };
      dataFields[Base.normalizeFieldName(field)] = '$_id.' + index;
      return agg;
    }, {});

    let $groupStage = {
      _id: groupId
    };

    if (operation === 'count') {
      $groupStage.count = { $count: {} };
    } else if (operation === 'avg' && operationField) {
      $groupStage.avg = { $avg: '$' + this.getFieldKey(operationField) };
    } else if (operation === 'max' && operationField) {
      $groupStage.max = { $max: '$' + this.getFieldKey(operationField) };
    } else if (operation === 'min' && operationField) {
      $groupStage.min = { $min: '$' + this.getFieldKey(operationField) };
    } else if (operation === 'sum' && operationField) {
      $groupStage.sum = { $sum: '$' + this.getFieldKey(operationField) };
    } else if (operation === 'stdDev' && operationField) {
      $groupStage.stdDev = { $stdDevPop: '$' + this.getFieldKey(operationField) };
    }

    // This gets us a data field so sorting is like other queries but is it wasteful?
    dataFields[operation] = '$' + operation;

    return {
      $group: $groupStage,
      $addFields: {
        data: dataFields
      }
    };
  }
}

module.exports = Base;

