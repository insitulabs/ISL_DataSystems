const { ObjectId } = require('mongodb');
const Base = require('./base');
const Errors = require('../lib/errors');
const CurrentUser = require('../lib/current-user');

const SUBMISSIONS = 'submissions';
const SOURCES = 'sources';
const SUBMISSIONS_STAGED = 'submissionsStaged';
const IMPORTS = 'imports';

class SourceModel {
  constructor(data) {
    this.data = data;
    return new Proxy(this, {
      get: function (target, prop) {
        console.log('here', prop);
        const property = target[prop];
        if (typeof property === 'function') {
          return property.bind(target);
        }

        return target.data[prop];

        // if (field in person) return person[field]; // normal case

        // return model.data[field];
      }
    });
  }

  toString() {
    return this.data.submissionKey;
  }
}

class Source extends Base {
  /** @type {CurrentUser} */
  user = null;

  /**
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

  static submissionKey(system, namespace) {
    return `${system}__${namespace}`.toLowerCase();
  }

  static flattenSubmission(data) {
    var result = {};
    function recurse(cur, prop) {
      if (Object(cur) !== cur || Array.isArray(cur) || prop === '_id' || cur instanceof Date) {
        result[prop] = cur;
      } else {
        var isEmpty = true;
        for (var p in cur) {
          isEmpty = false;
          recurse(cur[p], prop ? prop + '.' + p : p);
        }
        if (isEmpty && prop) result[prop] = {};
      }
    }
    recurse(data, '');
    return result;
  }

  #buildSubmissionQuery($match, options, forCount = false) {
    let query = [
      {
        $match: $match
      }
    ];

    // If we have an single ID filter, include it in match.
    if (options.id && ObjectId.isValid(options.id)) {
      query[0].$match._id = new ObjectId(options.id);
      options.limit = -1;
    }

    // Build match and field casts for filters.
    const { match, addFields } = this.filterSubmissions(options.filters);

    if (Object.keys(addFields).length) {
      query.push({ $addFields: addFields });
    }
    if (Object.keys(match).length) {
      query.push({ $match: match });
    }
    if (Object.keys(addFields).length) {
      query.push({ $unset: '_filter' });
    }

    if (forCount) {
      return query;
    }

    if (options.sample) {
      query.push({
        $sample: { size: options.sample }
      });
    } else {
      // TODO If we need case insensitive sort, look at collation or normalizing a string to then sort on
      if (options.sort) {
        let sort = {};
        let sortKey = this.getFieldKey(options.sort);
        sort[sortKey] = options.order === 'asc' ? 1 : -1;
        // Include a unique value in our sort so Mongo doesn't screw up limit/skip operation.
        sort._id = sort[sortKey];
        query.push({
          $sort: sort
        });
      }

      if (options.limit && options.limit !== -1) {
        if (options.offset) {
          query.push({
            $skip: options.offset
          });
        }

        query.push({
          $limit: options.limit
        });
      }
    }

    return query;
  }

  /**
   * Get raw fields from a sampling of submissions for a given system/namespace.
   * @param {string} system
   * @param {string} namespace
   * @return {Array[string]} Fields sorted a-z
   */
  async getFormFields(system, namespace) {
    if (!system || !namespace) {
      throw new Error('Invalid params: system or namespace');
    }

    let submissionKey = Source.submissionKey(system, namespace);

    const getDocumentNestedFields = function (document, fields, fieldName = '') {
      for (const [key, value] of Object.entries(document)) {
        if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
          getDocumentNestedFields(value, fields, fieldName === '' ? key : `${fieldName}.${key}`);
        } else if (!Array.isArray(value)) {
          fields.add(fieldName === '' ? key : `${fieldName}.${key}`);
        }
      }
      return fields;
    };

    const col = this.collection(SUBMISSIONS);
    const docs = await col.aggregate([
      { $match: { source: submissionKey } },
      { $sample: { size: 100 } },
      { $project: { data: 1, _id: 0 } },
      {
        $replaceRoot: {
          newRoot: '$data'
        }
      }
    ]);

    let allFields = [];
    await docs.forEach((doc) => {
      const nestedFields = getDocumentNestedFields(doc, new Set());
      allFields = new Set([...allFields, ...nestedFields]);
    });
    allFields = Array.from(allFields);

    // Sometimes GPS points and other nested objects can be null, so we get a false field
    // of the top level object. Remove them.
    allFields = allFields.filter((field) => {
      let isOrphanParent = allFields.some((f) => f.indexOf(field + '.') === 0);
      return !isOrphanParent;
    });

    return allFields.sort((a, b) => {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }

  /**
   * @param {Object || String || ObjectId} source The source.
   * Can be a source object, an _id or submissionKey.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset, filters, sample, id)
   * @return
   */
  async getSubmissions(source, options = {}) {
    const col = this.collection(SUBMISSIONS);

    let submissionKey = null;
    if (typeof source === 'object' && source.submissionKey) {
      submissionKey = source.submissionKey;
    } else if (typeof source === 'string') {
      if (/^[0-9A-Fa-f]+$/.test(source)) {
        submissionKey = (await this.getSource(source)).submissionKey;
      } else {
        submissionKey = source;
      }
    }

    if (!submissionKey) {
      throw new Errors.BadRequest('Invalid submission query.');
    }

    let $match = {
      source: submissionKey
    };

    let countQuery = this.#buildSubmissionQuery($match, options, true);
    let fullQuery = this.#buildSubmissionQuery($match, options, false);

    // this.debug(fullQuery);

    let totalResults = await col.aggregate([...countQuery, { $count: 'totalResults' }]).toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let results = col.aggregate(fullQuery);
    return {
      results: await results.toArray(),
      totalResults: totalResults
    };
  }

  /**
   * Get a single submission by ID
   * @param {String} id
   * @return {Object} The submission
   */
  async getSubmission(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid ID param');
    }

    const submissions = this.collection(SUBMISSIONS);
    let submission = await submissions.findOne({ _id: new ObjectId(id) });
    if (!submission) {
      throw new Errors.BadRequest('Submission not found.');
    }
    return submission;
  }

  /**
   * Get a source by ID.
   * @param {String || ObjectId} id The ID of the source.
   * @return {Object} Source
   * @throws Not found error.
   */
  async getSource(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid source ID param');
    }

    this.user.validateSourcePermission(id);

    let sources = this.collection(SOURCES);
    let source = await sources.findOne({ _id: new ObjectId(id) });
    if (!source) {
      throw new Error('Source not found: ' + id);
    }

    // Append any un-mapped raw fields to end of the source fields list.
    let rawFields = await this.getFormFields(source.system, source.namespace);
    for (let rawId of rawFields) {
      if (!source.fields.some((f) => f.id === rawId)) {
        source.fields.push({
          id: rawId,
          name: null
        });
      }
    }

    // return new SourceModel(source);
    return source;
  }

  /**
   * Get a source by ID.
   * @param {String || ObjectId} id The ID of the source.
   * @return {Object} Source
   * @throws Not found error.
   */
  async getSourceByName(system, namespace) {
    if (!system || !namespace) {
      throw new Errors.BadRequest('Invalid source params');
    }

    const sources = this.collection(SOURCES);
    let source = await sources.findOne({ system: system, namespace: namespace });

    if (source) {
      return this.getSource(source._id);
    } else {
      throw new Error(`Source not found: for system: [${system}] and namespace: [${namespace}]`);
    }
  }

  /**
   * Get a source by submission key.
   * @param {string} key The submission key of the source.
   * @return {Object} Source
   * @throws Not found error.
   */
  async getSourceBySubmissionKey(key) {
    if (!key) {
      throw new Errors.BadRequest('Invalid source key');
    }

    const sources = this.collection(SOURCES);
    let source = await sources.findOne({ submissionKey: key });

    if (source) {
      return this.getSource(source._id);
    } else {
      throw new Error(`Source not found: for key: ${key}`);
    }
  }

  /**
   * List sources.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset, deleted: true)
   * @return {Object} Query result object with, results, totalResults, offset.
   */
  async listSources(options = {}) {
    let pipeline = [];

    let $match = { deleted: { $ne: true } };

    if (this.user.admin) {
      // Only admins can view deleted sources
      if (options.deleted === true) {
        $match.deleted = true;
      }
    } else {
      $match._id = { $in: this.user.sourceIds() };
    }

    if (options.name && typeof options.name === 'string') {
      // Escape for regex.
      let nameQuery = options.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      $match.name = { $regex: new RegExp(nameQuery, 'i') };
    }

    if (Object.keys($match).length) {
      pipeline.push({ $match: $match });
    }

    let sources = this.collection(SOURCES);
    let totalResults = await sources.aggregate([...pipeline, { $count: 'totalResults' }]).toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let offset = options.offset ? Math.max(0, options.offset) : 0;

    // TODO If we need case insensitive sort, look at collation or normalizing a string to then sort on
    if (options.sort) {
      let sort = {};
      sort[options.sort] = options.order === 'asc' ? 1 : -1;
      // Include a unique value in our sort so Mongo doesn't screw up limit/skip operation.
      sort._id = sort[options.sort];
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

    let results = await sources.aggregate(pipeline);

    return {
      totalResults,
      offset: offset,
      results: await results.toArray()
    };
  }

  /**
   * Create a source.
   * @param {Object} source
   * @param {Object} user
   * @returns {Object} The new source.
   */
  async createSource(source, user) {
    this.#validateSource(source);
    if (source._id) {
      throw new Error('Failed to create pre-existing source: ' + source.name);
    }

    let now = new Date();
    let toPersist = {
      name: source.name,
      system: source.system,
      namespace: source.namespace,
      submissionKey: Source.submissionKey(source.system, source.namespace),
      note: source.note,
      fields: source.fields,
      created: source.created || now,
      modified: now
    };

    // toPersist.fields.forEach((f) => {
    //   if (!f.id) {
    //     f.id = crypto.randomUUID();
    //   }
    // });

    if (user) {
      toPersist.createdBy = {
        id: ObjectId(user._id),
        name: user.name,
        email: user.email
      };
      toPersist.modifiedBy = {
        id: ObjectId(user._id),
        name: user.name,
        email: user.email
      };
    }

    const sources = this.collection(SOURCES);
    try {
      let insertResult = await sources.insertOne(toPersist);
      return await this.getSource(insertResult.insertedId);
    } catch (err) {
      if (/duplicate key/.test(err.message)) {
        throw new Errors.BadRequest('The combination of system and namespace must be unique.');
      } else {
        throw err;
      }
    }
  }

  /**
   * Update a source.
   * @param {Object} source
   * @param {Object} user
   * @returns {Object} The updated source.
   */
  async updateSource(source, user) {
    let existing = await this.getSource(source._id);
    this.#validateSource(source);

    let fieldsToDelete = existing.fields.filter((existingField) => {
      return !source.fields.find((f) => existingField.id === f.id);
    });

    if (fieldsToDelete.length) {
      const submissions = this.collection(SUBMISSIONS);
      let $unset = fieldsToDelete.reduce((unset, f) => {
        unset['data.' + f.id] = 1;
        return unset;
      }, {});

      // Clear removed fields from submissions
      await submissions.updateMany({ source: existing.submissionKey }, { $unset });

      // Clear removed fields from views. Load module here to avoid circular dep.
      const View = require('./view');
      const viewManager = new View(this.user, this.workspace);
      viewManager.removeSourceFieldFromViews(existing, fieldsToDelete);
    }

    let now = new Date();
    let toPersist = {
      name: source.name,
      // TODO evaluate if we can update these once they are set.
      // system: source.system,
      // namespace: source.namespace,
      note: source.note,
      fields: source.fields,
      modified: now
    };

    if (user) {
      toPersist.modifiedBy = {
        id: ObjectId(user._id),
        name: user.name,
        email: user.email
      };
    }

    const sources = this.collection(SOURCES);
    await sources.updateOne(
      { _id: existing._id },
      {
        $set: toPersist
      }
    );

    return {
      source: await this.getSource(existing._id),
      deletedFields: fieldsToDelete
    };
  }

  /**
   * Delete source.
   * @param {Object} source
   * @param {Object} user
   * @returns {Object} The updated source.
   */
  async deleteSource(source, user) {
    let existing = await this.getSource(source._id);
    let now = new Date();

    let toPersist = {
      deleted: true,
      modified: now
    };

    if (user) {
      toPersist.modifiedBy = {
        id: ObjectId(user._id),
        name: user.name,
        email: user.email
      };
    }

    const sources = this.collection(SOURCES);
    await sources.updateOne(
      { _id: existing._id },
      {
        $set: toPersist
      }
    );
    return await this.getSource(existing._id);
  }

  /**
   * Restore deleted source.
   * @param {Object} source
   * @param {Object} user
   * @returns {Object} The updated source.
   */
  async restoreDeletedSource(source, user) {
    let existing = await this.getSource(source._id);
    let now = new Date();

    let toPersist = {
      modified: now
    };

    if (user) {
      toPersist.modifiedBy = {
        id: ObjectId(user._id),
        name: user.name,
        email: user.email
      };
    }

    const sources = this.collection(SOURCES);
    await sources.updateOne(
      { _id: existing._id },
      {
        $set: toPersist,
        $unset: { deleted: '' }
      }
    );
    return await this.getSource(existing._id);
  }

  /**
   * Validate the structure of a source object.
   * @param {Object} view
   * @throws Error if a problem.
   */
  #validateSource(source) {
    if (!source) {
      throw new Error('Source required.');
    }

    if (!source.name || typeof source.name !== 'string' || !source.name.trim().length > 0) {
      throw new Error('Invalid source name.');
    }

    if (!source.system || typeof source.system !== 'string' || !source.system.trim().length > 0) {
      throw new Error('Invalid source system.');
    }
    if (source.system.indexOf('.') >= 0) {
      throw new Error('Invalid source system. Cannot contain periods.');
    }

    if (
      !source.namespace ||
      typeof source.namespace !== 'string' ||
      !source.namespace.trim().length > 0
    ) {
      throw new Error('Invalid source namespace.');
    }
    if (source.namespace.indexOf('.') >= 0) {
      throw new Error('Invalid source namespace. Cannot contain periods.');
    }

    if (!source.fields || !Array.isArray(source.fields)) {
      throw new Error('Source fields required.');
    }

    if (
      source.fields.some((f) => {
        if (!f.id || typeof f.id !== 'string') {
          return true;
        }
        // Ensure name is a string
        if (f.name && typeof f.name !== 'string') {
          return true;
        }
      })
    ) {
      throw new Error('Invalid source fields');
    }
  }

  /**
   * Update a submission
   * @param {String || ObjectId} id
   * @param {String} field
   * @param {*} value
   * @param {*} currentValue
   * @return {Object} The updated submission.
   */
  async updateSubmission(id, field, value, currentValue) {
    const submissions = this.collection(SUBMISSIONS);
    let record = await this.getSubmission(id);

    if (typeof field !== 'string') {
      throw new Errors.BadRequest('Invalid field name type: ' + typeof field);
    }

    if (currentValue !== undefined) {
      let flatRecord = Source.flattenSubmission(record.data);
      currentValue = currentValue && currentValue !== '0' ? currentValue : null;
      let recordValue = flatRecord[field] ? flatRecord[field] : null;
      recordValue = recordValue && recordValue !== '0' ? recordValue : null;

      if (currentValue != recordValue) {
        // Optimistic Lock
        throw new Errors.BadRequest(
          'The data you are trying to edit is stale. Refresh the page and try again.'
        );
      }
    }

    let update = {};
    update['data.' + field] = value;

    let auditRecord = {
      field,
      value,
      modified: new Date(),
      modifiedBy: {
        _id: this.user._id,
        email: this.user.email
      }
    };

    let results = await submissions.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: update,
        $push: {
          _edits: auditRecord
        }
      }
    );

    return this.getSubmission(id);
  }

  /**
   * Update submissions in bulk.
   * @param {object} source
   * @param {Array[String || ObjectId]} id
   * @param {String} field
   * @param {*} value
   * @return {number} The number of updated submissions.
   */
  async updateBulkSubmissions(source, ids, field, value) {
    const submissions = this.collection(SUBMISSIONS);

    if (!source && !ids && !ids.length) {
      throw new Errors.BadRequest('Invalid bulk update params');
    }

    if (typeof field !== 'string') {
      throw new Errors.BadRequest('Invalid field name type: ' + typeof field);
    }

    // this.user.validateSourcePermission(id, CurrentUser.PERMISSIONS.WRITE);
    let update = {};
    update['data.' + field] = value;

    let auditRecord = {
      field,
      value,
      modified: new Date(),
      modifiedBy: {
        _id: this.user._id,
        email: this.user.email
      }
    };

    let $match = {
      source: source.submissionKey
    };

    $match._id = {
      $in: ids.map((id) => new ObjectId(id))
    };

    let results = await submissions.updateMany($match, {
      $set: update,
      $push: {
        _edits: auditRecord
      }
    });

    return results.modifiedCount;
  }

  /**
   * Create submissions.
   * @param {object} source
   * @param {array} submissions
   * @param {object} options Options to use on insert. Can include:
   *   - originIdKey {string} To filter out existing submissions.
   *   - createdKey {string} To use as the create date.
   * @return {array} Array of new submission IDs.
   */
  async insertSubmissions(source, submissions, options = {}) {
    const col = this.collection(SUBMISSIONS);

    let toInsert = submissions;
    if (options.originIdKey) {
      let ids = submissions.map((s) => s[options.originIdKey]);

      let exists = (
        await col
          .find({ originId: { $in: ids } })
          .map((s) => {
            return s.originId;
          })
          .toArray()
      ).filter(Boolean);

      toInsert = submissions.filter((s) => {
        return !exists.includes(s[options.originIdKey]);
      });
    }

    let now = new Date();
    let created = now;
    if (toInsert.length > 0) {
      toInsert = toInsert.map((s) => {
        let { _attachmentsPresent, ...rest } = s;

        if (options.createdKey && s[options.createdKey]) {
          let createDate = s[options.createdKey];
          if (typeof createDate === 'string') {
            createDate = new Date(createDate);
          }

          if (createDate instanceof Date && createDate.toString() !== 'Invalid Date') {
            created = createDate;
            delete rest[options.createdKey];
          }
        }

        let originId = null;
        if (options.originIdKey && s[options.originIdKey]) {
          originId = s[options.originIdKey];
          delete rest[options.originIdKey];
        }

        let submission = {
          source: source.submissionKey,
          created: created,
          imported: now,
          data: rest,
          attachments: [],
          edits: [],
          originalData: rest
        };

        if (originId) {
          submission.originId = originId;
        }

        if (_attachmentsPresent) {
          submission._attachmentsPresent = _attachmentsPresent;
        }

        return submission;
      });

      let resp = await col.insertMany(toInsert);
      return Object.values(resp.insertedIds);
    }

    return [];
  }

  /**
   * Add attachments to a submission. Will not update, only add.
   * @param {String || ObjectId} id
   * @param {[Object]} attachments
   * @return {Object} The updated submission.
   */
  async addSubmissionAttachments(id, attachments = []) {
    const col = this.collection(SUBMISSIONS);
    let submission = await this.getSubmission(id);
    let toAdd = [];
    if (Array.isArray(submission.attachments) && submission.attachments.length) {
      attachments.forEach((a) => {
        if (!submission.attachments.some((e) => e.name === a.name)) {
          toAdd.push(a);
        }
      });
    } else {
      toAdd = attachments;
    }

    let results = await col.updateOne(
      { _id: submission._id },
      {
        $push: { attachments: { $each: toAdd } }
      }
    );

    return this.getSubmission(id);
  }

  async createImport(source, fields, records) {
    if (!source) {
      throw new Errors.BadRequest('Source is required');
    }
    if (!fields || !Array.isArray(fields) || !fields.length) {
      throw new Errors.BadRequest('Fields are required');
    }
    if (!records || !Array.isArray(records) || !records.length) {
      throw new Errors.BadRequest('Records are required');
    }

    const imports = this.collection(IMPORTS);
    const stagedSubmissions = this.collection(SUBMISSIONS_STAGED);

    let created = new Date();

    let toPersist = {
      sourceId: source._id,
      sourceName: source.name,
      created,
      createdBy: {
        id: ObjectId(this.user._id),
        name: this.user.name,
        email: this.user.email
      },
      fields: fields.map((f) => {
        return {
          id: Source.normalizeFieldName(f),
          name: null
        };
      })
    };

    let insertImport = await imports.insertOne(toPersist);

    let submissionsToPersist = records.map((r) => {
      let normalized = {};
      for (const [key, value] of Object.entries(r)) {
        let newValue = value;
        if (typeof newValue === 'string') {
          // Is number?
          if (value && /^[\d\.]+$/.test(value)) {
            if (value.indexOf('.') > -1) {
              newValue = parseFloat(newValue);
            } else {
              newValue = parseInt(newValue);
            }

            if (isNaN(newValue)) {
              newValue = null;
            }
          }
        }

        normalized[Source.normalizeFieldName(key)] = newValue;
      }

      return {
        import: insertImport.insertedId,
        created,
        data: normalized
      };
    });

    await stagedSubmissions.insertMany(submissionsToPersist);

    return imports.findOne(insertImport.insertedId);
  }

  async getImport(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid import ID');
    }

    const imports = this.collection(IMPORTS);
    let theImport = imports.findOne({ _id: new ObjectId(id) });
    if (!theImport) {
      throw new Errors.BadRequest('Import not found.');
    }

    this.user.validateSourcePermission(theImport.sourceId, CurrentUser.PERMISSIONS.WRITE);

    return theImport;
  }

  /**
   * Get pending imports for a given source.
   * @param {object} sourceId
   * @returns {Array}
   */
  async listImports(source) {
    const imports = this.collection(IMPORTS);
    return (await imports.find({ sourceId: source._id })).toArray();
  }

  /*
   * Get a single staged submission by ID
   * @param {String} id
   * @return {Object} The staged submission
   */
  async getStagedSubmission(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid ID param');
    }

    const submissions = this.collection(SUBMISSIONS_STAGED);
    let submission = submissions.findOne({ _id: new ObjectId(id) });
    if (!submission) {
      throw new Errors.BadRequest('Submission not found.');
    }
    return submission;
  }

  async getStagedSubmissions(theImport, options = {}) {
    const col = this.collection(SUBMISSIONS_STAGED);

    let $match = {
      import: theImport._id
    };

    let countQuery = this.#buildSubmissionQuery($match, options, true);
    let fullQuery = this.#buildSubmissionQuery($match, options, false);

    let totalResults = await col.aggregate([...countQuery, { $count: 'totalResults' }]).toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let results = col.aggregate(fullQuery);
    return {
      results: await results.toArray(),
      totalResults: totalResults
    };
  }

  /**
   * Update staged submission.
   * @param {String || ObjectId} id
   * @param {String} field
   * @param {*} value
   * @param {*} currentValue
   * @return {Object} The updated submission.
   */
  async updateStagedSubmission(id, field, value, currentValue) {
    let record = await this.getStagedSubmission(id);

    if (typeof field !== 'string') {
      throw new Errors.BadRequest('Invalid field name type: ' + typeof field);
    }

    // this.user.validateSourcePermission(id, CurrentUser.PERMISSIONS.WRITE);
    const stagedSubmissions = this.collection(SUBMISSIONS_STAGED);

    let flatRecord = Source.flattenSubmission(record.data);
    currentValue = currentValue && currentValue !== '0' ? currentValue : null;
    let recordValue = flatRecord[field] && flatRecord[field] !== '0' ? flatRecord[field] : null;

    if (currentValue != recordValue) {
      // Optimistic Lock
      throw new Errors.BadRequest(
        'The data you are trying to edit is stale. Refresh the page and try again.'
      );
    }

    let update = {};
    update[`data.${field}`] = value;

    await stagedSubmissions.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: update
      }
    );

    return this.getStagedSubmission(id);
  }

  /**
   * Update staged submissions in bulk.
   * @param {object} theImport
   * @param {Array[String || ObjectId]} id
   * @param {String} field
   * @param {*} value
   * @return {number} The number of updated submissions.
   */
  async updateBulkStagedSubmissions(theImport, ids, field, value) {
    const stagedSubmissions = this.collection(SUBMISSIONS_STAGED);

    if (!theImport && !ids && !ids.length) {
      throw new Errors.BadRequest('Invalid bulk update params');
    }

    if (typeof field !== 'string') {
      throw new Errors.BadRequest('Invalid field name type: ' + typeof field);
    }

    let update = {};
    update['data.' + field] = value;

    let $match = {
      import: theImport._id
    };

    $match._id = {
      $in: ids.map((id) => new ObjectId(id))
    };

    let results = await stagedSubmissions.updateMany($match, {
      $set: update
    });

    return results.modifiedCount;
  }

  async updateImportField(id, field, newField) {
    if (!field) {
      throw new Errors.BadRequest('Invalid field name');
    }

    let newFieldId = Source.normalizeFieldName(newField);
    if (!newFieldId) {
      throw new Errors.BadRequest('Invalid new field name');
    }

    // Fetching the import will validate it exists and ensure write permissions.
    const theImport = await this.getImport(id);
    if (theImport.fields.some((f) => f.id === newFieldId)) {
      throw new Errors.BadRequest('Invalid new field name. No duplicate fields.');
    }

    const imports = this.collection(IMPORTS);
    let resp = await imports.updateOne(
      { _id: theImport._id, 'fields.id': field },
      {
        $set: { 'fields.$.id': newFieldId }
      }
    );

    if (resp.modifiedCount > 0) {
      const col = this.collection(SUBMISSIONS_STAGED);
      let $rename = {};
      $rename[`data.${field}`] = `data.${newFieldId}`;
      resp = await col.updateMany({ import: theImport._id }, { $rename });
    }

    return newFieldId;
  }

  /**
   * Delete the given import.
   * @param {object} theImport
   */
  async deleteImport(theImport) {
    if (!theImport) {
      throw new Errors.BadRequest('Invalid import');
    }
    const imports = this.collection(IMPORTS);
    await imports.deleteOne({ _id: theImport._id });
    const col = this.collection(SUBMISSIONS_STAGED);
    await col.deleteMany({
      import: theImport._id
    });
  }

  /**
   * Commit the  he given import.
   * @param {object} theImport
   * @return {number} The count of imported submissions.
   */
  async commitImport(theImport) {
    if (!theImport) {
      throw new Errors.BadRequest('Invalid import');
    }

    let source = await this.getSource(theImport.sourceId);

    let queryResponse = await this.getStagedSubmissions(theImport, { limit: -1 });
    let toCreate = queryResponse.results.map((r) => {
      return r.data;
    });
    let ids = await this.insertSubmissions(source, toCreate);
    await this.deleteImport(theImport);
    return ids.length;
  }

  /**
   * Set the last sync status for a source.
   * @param {object} source
   * @param {object} sync
   * @return {object} The updated source.
   */
  async setLastSync(source, sync) {
    if (!source) {
      throw new Errors.BadRequest('Invalid source');
    }
    if (!sync || !sync.date) {
      throw new Errors.BadRequest('Invalid sync object.');
    }

    const sources = this.collection(SOURCES);
    let toPersist = {
      lastSync: sync
    };

    await sources.updateOne(
      { _id: source._id },
      {
        $set: toPersist
      }
    );
    return await this.getSource(source._id);
  }

  async getSubmissionsNeedingAttachmentSync(source) {
    const submissions = this.collection(SUBMISSIONS);

    let submissionKey = null;
    if (typeof source === 'object' && source.submissionKey) {
      submissionKey = source.submissionKey;
    } else if (typeof source === 'string') {
      if (/^[0-9A-Fa-f]+$/.test(source)) {
        submissionKey = (await this.getSource(source)).submissionKey;
      } else {
        submissionKey = source;
      }
    }

    if (!submissionKey) {
      throw new Errors.BadRequest('Invalid submission query.');
    }

    let $match = {
      source: submissionKey,
      _attachmentsPresent: { $exists: true, $gt: 0 }
    };

    return await submissions
      .aggregate([
        { $match },
        {
          $addFields: {
            _attachmentsPersisted: {
              $cond: {
                if: { $isArray: '$attachments' },
                then: { $size: '$attachments' },
                else: 0
              }
            }
          }
        },
        { $match: { $expr: { $lt: ['$_attachmentsPersisted', '$_attachmentsPresent'] } } },
        { $unset: '_attachmentsPersisted' }
      ])
      .toArray();
  }

  /**
   * Update a submission
   * @param {String || ObjectId} id
   * @param {String} field
   * @param {*} value
   * @param {*} currentValue
   * @return {Object} The updated submission.
   */
  async updateSubmissionViewData(id, view, field, subIndex, value, currentValue) {
    if (typeof field !== 'string') {
      throw new Errors.BadRequest('Invalid field name type: ' + typeof field);
    }

    // Ensure subIndex is a number and greater than 0.
    subIndex = typeof subIndex === 'number' ? Math.max(0, subIndex) : 0;

    const submissions = this.collection(SUBMISSIONS);
    let record = await this.getSubmission(id);

    // this.user.validateSourcePermission(id, CurrentUser.PERMISSIONS.WRITE);

    let viewId = typeof view === 'string' ? view : view._id.toString();
    let allViewData = record.viewData && record.viewData[viewId] ? record.viewData[viewId] : null;
    if (!allViewData) {
      allViewData = [];
      let update = {};
      update['viewData' + '.' + viewId] = allViewData;
      await submissions.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: update
        }
      );
    }

    let viewData = allViewData.length > subIndex ? allViewData[subIndex] : {};
    viewData = viewData || {};

    if (currentValue !== undefined) {
      currentValue = currentValue && currentValue !== '0' ? currentValue : null;
      let recordValue = viewData[field] && viewData[field] !== '0' ? viewData[field] : null;
      if (currentValue != recordValue) {
        // Optimistic Lock
        throw new Errors.BadRequest(
          'The data you are trying to edit is stale. Refresh the page and try again.'
        );
      }
    }

    viewData[field] = value;

    let update = {};
    update['viewData' + '.' + viewId + '.' + subIndex] = viewData;

    let auditRecord = {
      viewData: 'viewData' + '.' + viewId + '.' + subIndex,
      field,
      value,
      modified: new Date(),
      modifiedBy: {
        _id: this.user._id,
        email: this.user.email
      }
    };

    let results = await submissions.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: update,
        $push: {
          _edits: auditRecord
        }
      }
    );

    return this.getSubmission(id);
  }

  /**
   * Remove all submission data for a given view and field.
   * @param {object} view
   * @param {array} fields
   */
  async purgeSubmissionViewData(view, fields) {
    if (!view) {
      throw new Errors.BadRequest('View is required');
    }
    if (!fields) {
      throw new Errors.BadRequest('Field is required');
    }
    const submissions = this.collection(SUBMISSIONS);
    let $match = {};
    $match[`viewData.${view._id}`] = { $exists: true };
    let $unset = fields.reduce((toUnset, field) => {
      toUnset[`viewData.${view._id}.$[].${field.id}`] = 1;
      return toUnset;
    }, {});

    await submissions.updateMany($match, {
      $unset
    });
  }
}

module.exports = Source;

