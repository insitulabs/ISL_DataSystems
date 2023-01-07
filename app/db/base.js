const CONFIG = require('../config');
const { MongoClient } = require('mongodb');
const util = require('util');

let _mongoClient = new MongoClient(CONFIG.MONGO_URI);

class Base {
  DB_NAME = null;
  connected = false;

  constructor(DB_NAME) {
    this.DB_NAME = DB_NAME;
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

  collection(name) {
    return _mongoClient.db(this.DB_NAME).collection(name);
  }

  debug(data) {
    console.log(util.inspect(data, { showHidden: false, depth: null, maxArrayLength: null }));
  }
}

module.exports = Base;

