const Base = require('./base');
const { ObjectId } = require('mongodb');
const Errors = require('../lib/errors');
const CurrentUser = require('../lib/current-user');
const AuditEvent = require('./audit-events/audit-event');
const ImportCommit = require('./audit-events/import-commit');
const SubmissionEdit = require('./audit-events/submission-edit');

const AUDIT_EVENTS = 'audit';

const AuditEventType = Object.freeze({
  UserActivity: 'user-activity',
  UserLoginAttempt: 'user-login-attempt',
  Export: 'export',
  ImportCommit: 'import-commit',
  ImportCreate: 'import-create',
  ImportDelete: 'import-delete',
  SubmissionCreate: 'submission-create',
  SubmissionEdit: 'submission-edit',
  SubmissionDelete: 'submission-delete',
  SubmissionRestore: 'submission-restore',
  Download: 'download',
  ViewEdit: 'view-edit',
  ViewCreate: 'view-create',
  ViewDelete: 'view-delete',
  ViewRestore: 'view-restore',
  SourceEdit: 'source-edit',
  SourceCreate: 'source-create',
  SourceDelete: 'source-delete',
  SourceRestore: 'source-restore',
  UserEdit: 'user-edit'
});

const UNDOABLE_AUDIT_TYPES = [AuditEventType.ImportCommit, AuditEventType.SubmissionEdit];

class Audit extends Base {
  /** @type {CurrentUser} */
  user = null;

  /**
   *
   * @param {CurrentUser} user
   * @param {object} workspace The workspace or default to user's workspace.
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
      sort._id = sort[sortField];
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

    let results = await events.aggregate(pipeline).toArray();
    for (let result of results) {
      result.canUndo = this.#canUndo(result);
    }

    return {
      totalResults,
      offset,
      results
    };
  }

  /**
   * Get audit event.
   * @param {ObjectId} id
   * @return {AuditEvent} The event record.
   */
  async getEvent(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid event ID param');
    }

    let events = this.collection(AUDIT_EVENTS);
    let event = await events.findOne({ _id: new ObjectId(id) });
    if (!event) {
      throw new Errors.BadRequest('Event not found: ' + id);
    }

    event.canUndo = this.#canUndo(event);

    let auditEvent = null;
    if (event.type === AuditEventType.ImportCommit) {
      auditEvent = new ImportCommit(event);
    } else if (event.type === AuditEventType.SubmissionEdit) {
      auditEvent = new SubmissionEdit(event);
    } else {
      auditEvent = new AuditEvent(event);
    }

    return auditEvent;
  }

  /**
   * Log user page view activity.
   * We roll this up to the most recent hour.
   * @param {string} page The path of the page the user is on.
   */
  async logUserActivity(page) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);

    // Rollup user activity per hour.
    let now = Date.now();
    let since = new Date();
    since.setTime(now - 1000 * 60 * 60);

    let query = {
      type: AuditEventType.UserActivity,
      'user.email': this.user.email,
      created: { $gte: since }
    };

    let record = this.#userEvent(AuditEventType.UserActivity);
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
   * Log user login attempt.
   * We roll this up to count per hour.
   * @param {string} ip IP address
   * @param {string} userAgent user-agent header
   */
  async logUserLoginAttempt(ip, userAgent = null) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);

    // Rollup user activity per hour.
    let now = Date.now();
    let since = new Date();
    since.setTime(now - 1000 * 60 * 60);

    let query = {
      type: AuditEventType.UserLoginAttempt,
      'user.email': this.user.email,
      'data.ip': ip,
      created: { $gte: since }
    };

    let record = this.#userEvent(AuditEventType.UserLoginAttempt, {
      ip: ip,
      userAgent: userAgent
    });

    let data = record.data;
    if (data) {
      delete record.data;
      Object.keys(data).forEach((k) => {
        record['data.' + k] = data[k];
      });
    }

    const update = {
      $set: record,
      $inc: { 'data.count': 1 }
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
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.Export, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source import.
   * @param {Object} data The data to log with this import.
   * @param {ObjectId} auditId A audit identifier used to commit the import actions.
   */
  async logImportCommit(data, auditId) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.ImportCommit, data);

    if (auditId) {
      record._id = auditId;
    }

    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source import create.
   * @param {object} data The data to log with this event.
   */
  async logImportCreate(data) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.ImportCreate, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source import delete.
   * @param {object} data The data to log with this event.
   */
  async logImportDelete(data) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.ImportDelete, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a submission create.
   * @param {object} data The data to log with this event.
   */
  async logSubmissionCreate(data) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SubmissionCreate, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a submission edit via a source or view.
   * @param {object} data The data to log with this edit.
   * @param {ObjectId} auditId A audit identifier used to commit the import actions.
   */
  async logSubmissionEdit(data, auditId) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SubmissionEdit, data);

    if (auditId) {
      record._id = auditId;
    }

    // Indicate these events are version 2 can can be bulk undone.
    record.data.version = 2;

    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a submission delete.
   * @param {object} data  The data to log with this edit.
   */
  async logSubmissionDelete(data) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SubmissionDelete, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a submission restore.
   * @param {object} data  The data to log with this edit.
   */
  async logSubmissionRestore(data) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SubmissionRestore, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a file download.
   * @param {string} file The file path.
   */
  async logFileDownload(file) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.Download, { file });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source create.
   * @param {object} source The source.
   */
  async logSourceCreate(source) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SourceCreate, {
      _id: source._id,
      name: source.name,
      submissionKey: source.submissionKey
    });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source delete.
   * @param {object} source The source.
   */
  async logSourceDelete(source) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SourceDelete, {
      _id: source._id,
      name: source.name,
      submissionKey: source.submissionKey
    });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source restore.
   * @param {object} source The source.
   */
  async logSourceRestore(source) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.SourceRestore, {
      _id: source._id,
      name: source.name,
      submissionKey: source.submissionKey
    });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a source edit.
   * @param {object} source The source.
   * @param {array} deletedFields deleted fields
   */
  async logSourceEdit(source, deletedFields) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let data = {
      _id: source._id,
      name: source.name,
      submissionKey: source.submissionKey
    };
    if (deletedFields && deletedFields.length) {
      data.deletedFields = deletedFields.map((f) => f.name || f.id);
    }

    let record = this.#userEvent(AuditEventType.SourceEdit, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a view create.
   * @param {object} view The view.
   */
  async logViewCreate(view) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.ViewCreate, {
      _id: view._id,
      name: view.name
    });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a view delete.
   * @param {object} view The view.
   */
  async logViewDelete(view) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.ViewDelete, {
      _id: view._id,
      name: view.name
    });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a view restore.
   * @param {object} view The view.
   */
  async logViewRestore(view) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let record = this.#userEvent(AuditEventType.ViewRestore, {
      _id: view._id,
      name: view.name
    });
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a view edit.
   * @param {object} view The view.
   * @param {array} deletedFields deleted fields
   */
  async logViewEdit(view, deletedFields) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let data = {
      _id: view._id,
      name: view.name
    };
    if (deletedFields && deletedFields.length) {
      data.deletedFields = deletedFields.map((f) => f.name);
    }
    let record = this.#userEvent(AuditEventType.ViewEdit, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Log a user edit/create.
   * @param {object} user The user.
   * @param {object} previous The user state before edit. Null if a create.
   */
  async logUserEdit(user, previous = null) {
    if (this.user.preventAudit) {
      return;
    }

    let events = this.collection(AUDIT_EVENTS);
    let data = {
      _id: user._id,
      email: user.email
    };

    if (previous) {
      data.delta = {};
      if (user.admin !== previous.admin) {
        data.delta.admin = {
          before: previous.admin,
          after: user.admin
        };
      }

      if (user.email !== previous.email) {
        data.delta.email = {
          before: previous.email,
          after: user.email
        };
      }

      if (user.name !== previous.name) {
        data.delta.name = {
          before: previous.name,
          after: user.name
        };
      }

      if (user.deleted !== previous.deleted) {
        data.delta.deleted = {
          before: previous.deleted,
          after: user.deleted
        };
      }

      let sourcesA = JSON.stringify(user.sources);
      let sourcesB = JSON.stringify(previous.sources);
      if (sourcesA !== sourcesB) {
        data.delta.sources = {
          before: previous.sources,
          after: user.sources
        };
      }

      let viewsA = JSON.stringify(user.views);
      let viewsB = JSON.stringify(previous.views);
      if (viewsA !== viewsB) {
        data.delta.views = {
          before: previous.views,
          after: user.views
        };
      }
    }

    let record = this.#userEvent(AuditEventType.UserEdit, data);
    return events.insertOne(record).catch(this.#onError);
  }

  /**
   * Can the audit event be undone?
   * @param {Object} event
   * @return {boolean}
   */
  #canUndo(event) {
    let canUndo = false;

    if (event.type === AuditEventType.SubmissionEdit) {
      return new SubmissionEdit(event).canUndo;
    } else if (event.type === AuditEventType.ImportCommit) {
      return new ImportCommit(event).canUndo;
    }

    return canUndo;
  }

  /**
   * Mark an event as undone.
   * @param {AuditEvent} event
   * @param {CurrentUser} currentUser
   * @returns
   */
  async markUndone(event, currentUser) {
    let events = this.collection(AUDIT_EVENTS);
    return events.updateOne(
      { _id: event.id },
      {
        $set: {
          undone: true,
          undoneBy: {
            _id: currentUser._id,
            email: currentUser.email
          },
          undoneOn: new Date()
        }
      }
    );
  }
}

module.exports = {
  Audit,
  AuditEventType
};

