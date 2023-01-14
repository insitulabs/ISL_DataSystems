const Base = require('./base');
const Errors = require('../lib/errors');
const CurrentUser = require('../lib/current-user');

const AUDIT_EVENTS = 'audit';

const AuditEvent = Object.freeze({
  UserActivity: 'user-activity',
  Export: 'export',
  Edit: 'edit',
  Download: 'download'
});

class Audit extends Base {
  /** @type {CurrentUser} */
  user = null;

  /**
   *
   * @param {CurrentUser} user
   * @param {String} workspace The workspace or default to user's workspace.
   */
  constructor(user, workspace) {
    if (!user) {
      throw new Errors.BadRequest('User is required');
    }

    super(workspace || user.workspace);
    this.user = user;
  }

  #userEvent(type, data) {
    let record = {
      created: new Date(),
      type,
      user: {
        _id: this.user._id,
        email: this.user.email
      }
    };

    if (data) {
      record.data = data;
    }

    return record;
  }

  #onError(error) {
    console.error(error);
  }

  /**
   * List audit events.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset)
   * @return {Object} Query result object with, results, totalResults, offset.
   */
  async listEvents(options = {}) {
    let events = this.collection(AUDIT_EVENTS);

    let pipeline = [];
    if (options.types && options.types.length) {
      pipeline.push({
        $match: {
          type: { $in: options.types }
        }
      });
    }

    let totalResults = await events.aggregate([...pipeline, { $count: 'totalResults' }]).toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let offset = options.offset ? Math.max(0, options.offset) : 0;

    // TODO If we need case insensitive sort, look at collation or normalizing a string to then sort on
    if (options.sort) {
      let sort = {};
      let sortField = options.sort;
      if (sortField === 'email') {
        sortField = 'user.email';
      }

      sort[sortField] = options.order === 'asc' ? 1 : -1;
      // Include a unique value in our sort so Mongo doesn't screw up limit/skip operation.
      sort._id = 1;
      pipeline.push({
        $sort: sort
      });
    }

    if (options.limit && options.limit !== -1) {
      if (offset) {
        pipeline.push({
          $skip: options.offset
        });
      }

      pipeline.push({
        $limit: options.limit
      });
    }

    let results = await events.aggregate(pipeline);

    return {
      totalResults,
      offset: offset,
      results: await results.toArray()
    };
  }

  /**
   * Log user page view activity.
   * We roll this up to the most recent hour.
   * @param {string} page The path of the page the user is on.
   */
  async logUserActivity(page) {
    let events = this.collection(AUDIT_EVENTS);

    // Rollup user activity per hour.
    let now = Date.now();
    let since = new Date();
    since.setTime(now - 1000 * 60 * 60);

    let query = {
      type: AuditEvent.UserActivity,
      'user.email': this.user.email,
      created: { $gte: since }
    };

    let record = this.#userEvent(AuditEvent.UserActivity);
    const update = {
      $set: record,
      $addToSet: { 'data.pages': page }
    };

    return events
      .findOneAndUpdate(query, update, {
        sort: { _id: -1 },
        upsert: true
      })
      .catch(this.#onError);
  }

  /**
   * Log a user export.
   * @param {object} data The data to log with this export.
   */
  async logExport(data) {
    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEvent.Export, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a submission edit via a source or view.
   * @param {object} data  The data to log with this edit.
   */
  async logEdit(data) {
    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEvent.Edit, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a file download.
   * @param {string} file The file path.
   */
  async logFileDownload(file) {
    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEvent.Download, { file });
    return events.insertOne(record).catch(this.#onError);
  }
}

module.exports = {
  Audit,
  AuditEvent
};

