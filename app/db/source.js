const { ObjectId } = require('mongodb');
const Base = require('./base');
const Sequence = require('./sequence');
const Errors = require('../lib/errors');
const CurrentUser = require('../lib/current-user');
const dayjs = require('dayjs');
const _ = require('lodash');

const SUBMISSIONS = 'submissions';
const SOURCES = 'sources';
const SUBMISSIONS_STAGED = 'submissionsStaged';
const IMPORTS = 'imports';

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

  static NON_EDITABLE_FIELDS = ['_id', 'created', 'imported', 'originId'];

  static submissionKey(system, namespace) {
    return `${system}__${namespace}`.toLowerCase();
  }

  /**
   * Flatten an object into a single level.
   * @param {object} data
   * @return {object}
   */
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
        if (isEmpty && prop) {
          result[prop] = {};
        }
      }
    }
    recurse(data, '');

    // Remove empty objects from flat structure.
    return Object.keys(result).reduce((cleaned, key) => {
      let value = result[key];
      if (value && typeof value === 'object' && !Object.values(value).length) {
        return cleaned;
      }

      cleaned[key] = value;
      return cleaned;
    }, {});
  }

  /**
   * Convert a flat record to a submission with appropriate depth. Needed to mimic ODK style
   * data on single submission create or imports.
   * @param {object} source The source to create the submission for.
   * @param {object} record The flat record to prep for submission insertion.
   */
  static flatRecordToSubmission(source, record) {
    if (!source) {
      throw new Errors.BadRequest('Source is required');
    }
    if (!record) {
      throw new Errors.BadRequest('record is required');
    }

    // Convert our flat submissions into a object to better mirror what we might have gotten
    // from ODK. Also ensure any object has all the fields so that nested data
    // can be populated later.
    let submissionFields = Object.keys(record);
    for (const f of source.fields) {
      // Populate all fields so ODK style deep objects are re-created later.
      if (!submissionFields.includes(f.id)) {
        record[f.id] = null;
      }

      if (f?.meta?.type !== 'text') {
        let value = record[f.id];
        // Is number?
        if (value && typeof value === 'string' && /^[\d\.]+$/.test(value)) {
          if (value.indexOf('.') > -1) {
            value = parseFloat(value);
          } else {
            value = parseInt(value);
          }

          if (isNaN(value)) {
            value = null;
          }
        }

        if (value !== record[f.id]) {
          record[f.id] = value;
        }
      }
    }

    return Source.unflattenSubmission(record);
  }

  /**
   * Unflatten a single level object into depth.
   * @param {object} data
   * @return {object}an object into a single level.
   */
  static unflattenSubmission(data) {
    let result = {};
    for (let i in data) {
      let keys = i.split('.');
      keys.reduce(function (r, e, j) {
        if (r[e]) {
          return r[e];
        }
        r[e] = keys.length - 1 === j ? data[i] : {};
        return r[e];
      }, result);
    }

    return result;
  }

  /**
   * Build a mongodb query array for submissions.
   * @param {object} $match What to query.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset, filters, sample, id, deleted)
   * @param {boolean} forCount True for a count, not a full search.
   * @return {Array} The query.
   */
  #buildSubmissionQuery($match, options, forCount = false) {
    let query = [
      {
        $match: $match
      }
    ];

    if (options.deleted !== true) {
      query[0].$match.deleted = { $ne: true };
    } else {
      query[0].$match.deleted = true;
    }

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

    // If we're grouping and reducing, apply stages:
    if (options.reduce) {
      let stages = this.groupByStage(options.reduce.id, options.reduce.operation);
      query.push({ $group: stages.$group });
      query.push({ $addFields: stages.$addFields });
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
        let sortKey = options.sort;
        sortKey = this.getFieldKey(options.sort);

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

    // this.debug(query);
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
      throw new Errors.BadRequest('Invalid params: system or namespace');
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
      { $match: { source: submissionKey, deleted: { $ne: true } } },
      { $sample: { size: 200 } },
      { $project: { data: 1, _id: 0 } },
      {
        $replaceRoot: {
          newRoot: '$data'
        }
      }
    ]);

    let allFields = [];
    for await (let doc of docs) {
      const nestedFields = getDocumentNestedFields(doc, new Set());
      allFields = new Set([...allFields, ...nestedFields]);
    }
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
   * @param {Object|String|ObjectId} source The source.
   * Can be a source object, an _id or submissionKey.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset, filters, sample, id, deleted)
   * @return {object} Result set with results and totalResults keys.
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
   * Get all submissions modified in a given edit audit event.
   * @param {ObjectId | String} auditId
   * @return {{results: Array, totalResults: Number}} The results.
   */
  async getSubmissionsFromEditAudit(auditId) {
    if (!auditId || !ObjectId.isValid(auditId)) {
      throw new Errors.BadRequest('Invalid audit ID');
    }

    let results = await this.collection(SUBMISSIONS)
      .find({
        '_edits.auditId': new ObjectId(auditId)
      })
      .toArray();

    return {
      results,
      totalResults: results.length
    };
  }

  /**
   * Get all submissions created in a given audit event.
   * @param {ObjectId | String} auditId
   * @return {{results: Array, totalResults: Number}} The results.
   */
  async getSubmissionsFromCreateAudit(auditId) {
    if (!auditId || !ObjectId.isValid(auditId)) {
      throw new Errors.BadRequest('Invalid audit ID');
    }

    let results = await this.collection(SUBMISSIONS)
      .find({
        auditId: new ObjectId(auditId)
      })
      .toArray();

    return {
      results,
      totalResults: results.length
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
   * Delete a single submission.
   * @param {ObjectId || String} id
   * @return {object} The deleted submission.
   */
  async deleteSubmission(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid ID param');
    }

    const submissions = this.collection(SUBMISSIONS);
    let submission = await submissions.findOne({ _id: new ObjectId(id) });
    if (!submission) {
      throw new Errors.BadRequest('Submission not found.');
    }

    let auditRecord = {
      deleted: true,
      modified: new Date(),
      modifiedBy: {
        id: new ObjectId(this.user._id),
        name: this.user.name,
        email: this.user.email
      }
    };

    await submissions.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          deleted: true
        },
        $push: {
          _edits: auditRecord
        }
      }
    );

    await this.#updateSourceLastUpdate(submission.source);

    return this.getSubmission(id);
  }

  /**
   * Restore a single deleted submission.
   * @param {ObjectId || String} id
   * @return {object} The restored submission.
   */
  async restoreSubmission(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid ID param');
    }

    const submissions = this.collection(SUBMISSIONS);
    let submission = await submissions.findOne({ _id: new ObjectId(id) });
    if (!submission) {
      throw new Errors.BadRequest('Submission not found.');
    }

    if (submission.deleted !== true) {
      throw new Errors.BadRequest('Submission not archived.');
    }

    let auditRecord = {
      deleted: false,
      modified: new Date(),
      modifiedBy: {
        id: new ObjectId(this.user._id),
        name: this.user.name,
        email: this.user.email
      }
    };

    await submissions.updateOne(
      { _id: new ObjectId(id) },
      {
        $unset: { deleted: '' },
        $push: {
          _edits: auditRecord
        }
      }
    );

    await this.#updateSourceLastUpdate(submission.source);

    return this.getSubmission(id);
  }

  /**
   * Get a source by ID.
   * @param {String|ObjectId} id The ID of the source.
   * @param {boolean} ignorePermissionCheck True if we should prevent a permission check.
   * @return {Object} Source
   * @throws Not found error.
   */
  async getSource(id, ignorePermissionCheck = false) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid source ID param');
    }

    let sources = this.collection(SOURCES);
    let source = await sources.findOne({ _id: new ObjectId(id) });
    if (!source) {
      throw new Errors.BadRequest('Source not found: ' + id);
    }

    if (!ignorePermissionCheck) {
      this.user.validateSourcePermission(source);
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

    source.fields.forEach((f) => {
      f.meta = f.meta || {};

      // Initialize default visibility setting for fields that were created before the feature.
      if (typeof f.default === 'undefined') {
        f.default = true;
      }

      if (typeof f.altLang === 'undefined') {
        f.altLang = {};
      }
    });

    return source;
  }

  /**
   * Get a source by ID.
   * @param {String|ObjectId} id The ID of the source.
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
      throw new Errors.BadRequest(
        `Source not found: for system: [${system}] and namespace: [${namespace}]`
      );
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
      return await this.getSource(source._id);
    } else {
      throw new Errors.BadRequest(`Source not found: for key: ${key}`);
    }
  }

  /**
   * List sources.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset, deleted: true, language)
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
      $match.$or = [{ _id: { $in: this.user.sourceIds() } }, { 'permissions.read': true }];
    }

    if (Object.keys($match).length) {
      pipeline.push({ $match: $match });
    }

    // If we have a name query
    if (options.name && typeof options.name === 'string') {
      // Escape for regex.
      let nameQuery = options.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      let $nameMatch = {};
      // If a language was provided, query both primary name and alt lang name.
      if (options.language) {
        $nameMatch.$or = [
          {
            name: { $regex: new RegExp(nameQuery, 'i') }
          }
        ];

        let langQuery = {};
        langQuery[`altLang.${options.language}.name`] = { $regex: new RegExp(nameQuery, 'i') };
        $nameMatch.$or.push(langQuery);
      } else {
        $nameMatch = {
          name: { $regex: new RegExp(nameQuery, 'i') }
        };
      }

      pipeline.push({ $match: $nameMatch });
    }

    let sources = this.collection(SOURCES);
    let totalResults = await sources.aggregate([...pipeline, { $count: 'totalResults' }]).toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let offset = options.offset ? Math.max(0, options.offset) : 0;

    // TODO If we need case insensitive sort, look at collation or normalizing a string to then sort on
    if (options.sort) {
      let sort = {};
      if (options.sort === 'name' && options.language) {
        sort[`altLang.${options.language}.name`] = options.order === 'asc' ? 1 : -1;
        sort['name'] = options.order === 'asc' ? 1 : -1;
      } else {
        sort[options.sort] = options.order === 'asc' ? 1 : -1;
      }
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
   * @returns {Object} The new source.
   */
  async createSource(source) {
    this.#validateSource(source);
    if (source._id) {
      throw new Errors.BadRequest('Failed to create pre-existing source: ' + source.name);
    }

    let now = new Date();
    let toPersist = {
      name: source.name,
      system: source.system,
      namespace: source.namespace,
      submissionKey: Source.submissionKey(source.system, source.namespace),
      note: source.note,
      altLang: source.altLang || {},
      fields: source.fields,
      created: source.created || now,
      modified: now
    };

    toPersist.createdBy = {
      id: new ObjectId(this.user._id),
      name: this.user.name,
      email: this.user.email
    };
    toPersist.modifiedBy = {
      id: new ObjectId(this.user._id),
      name: this.user.name,
      email: this.user.email
    };

    const sources = this.collection(SOURCES);
    try {
      let insertResult = await sources.insertOne(toPersist);
      let newSource = await this.getSource(insertResult.insertedId);

      // Set sequences
      const sequenceManager = new Sequence(this.user, this.workspace);
      for (let f of source.fields.filter((f) => f?.meta?.type === 'sequence')) {
        let nextValue = source.sequenceFields[f.id] || 1;
        if (typeof nextValue === 'number' && nextValue > 0) {
          await sequenceManager.setSequence('source', newSource, f, nextValue);
        }
      }

      return newSource;
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
   * @returns {Object} The updated source.
   */
  async updateSource(source) {
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
      altLang: source.altLang || {},
      modified: now
    };

    toPersist.modifiedBy = {
      id: new ObjectId(this.user._id),
      name: this.user.name,
      email: this.user.email
    };

    const sources = this.collection(SOURCES);
    await sources.updateOne(
      { _id: existing._id },
      {
        $set: toPersist
      }
    );

    // Update sequences
    const sequenceManager = new Sequence(this.user, this.workspace);
    for (let f of source.fields.filter((f) => f?.meta?.type === 'sequence')) {
      let nextValue = source.sequenceFields[f.id] || 1;
      if (typeof nextValue === 'number' && nextValue > 0) {
        await sequenceManager.setSequence('source', existing, f, nextValue);
      }
    }

    return {
      source: await this.getSource(existing._id),
      deletedFields: fieldsToDelete
    };
  }

  /**
   * Update a source's workspace permissions.
   * @param {Object} source
   * @param {Object} permissions
   * @returns {Object} The updated source.
   */
  async updateSourcePermissions(source, permissions) {
    let existing = await this.getSource(source._id);
    let now = new Date();
    let toPersist = {
      permissions: {
        read: permissions.read === true,
        write: permissions.write === true
      },
      modified: now
    };

    toPersist.modifiedBy = {
      id: new ObjectId(this.user._id),
      email: this.user.email,
      name: this.user.name
    };

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
   * Delete source.
   * @param {Object} source
   * @returns {Object} The updated source.
   */
  async deleteSource(source) {
    let existing = await this.getSource(source._id);
    let now = new Date();

    let toPersist = {
      deleted: true,
      modified: now
    };

    toPersist.modifiedBy = {
      id: new ObjectId(this.user._id),
      name: this.user.name,
      email: this.user.email
    };

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
   * @returns {Object} The updated source.
   */
  async restoreDeletedSource(source) {
    let existing = await this.getSource(source._id);
    let now = new Date();

    let toPersist = {
      modified: now
    };

    toPersist.modifiedBy = {
      id: new ObjectId(this.user._id),
      name: this.user.name,
      email: this.user.email
    };

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
      throw new Errors.BadRequest('Source required.');
    }

    if (!source.name || typeof source.name !== 'string' || !source.name.trim().length > 0) {
      throw new Errors.BadRequest('Invalid source name.');
    }

    if (!source.system || typeof source.system !== 'string' || !source.system.trim().length > 0) {
      throw new Errors.BadRequest('Invalid source system.');
    }
    if (source.system.indexOf('.') >= 0) {
      throw new Errors.BadRequest('Invalid source system. Cannot contain periods.');
    }

    if (
      !source.namespace ||
      typeof source.namespace !== 'string' ||
      !source.namespace.trim().length > 0
    ) {
      throw new Errors.BadRequest('Invalid source namespace.');
    }
    if (source.namespace.indexOf('.') >= 0) {
      throw new Errors.BadRequest('Invalid source namespace. Cannot contain periods.');
    }

    if (!source.fields || !Array.isArray(source.fields)) {
      throw new Errors.BadRequest('Source fields required.');
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
      throw new Errors.BadRequest('Invalid source fields');
    }
  }

  /**
   * Update a submission. No permissions checks are done.
   * @param {String|ObjectId} id
   * @param {Object} delta
   * @param {{auditId: ObjectId, submission: Object, previousDelta: Object}} options
   *   - auditId: The audit ID used to group bulk actions to audit history.
   *   - submission: The submission to update, if we have it. Not required.
   *   - previousDelta: Current values, if provided, do optimistic lock check.
   * @return {Object} The updated submission.
   */
  async updateSubmission(id, delta, options = {}) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid submission ID');
    }

    if (!delta || typeof delta !== 'object' || Object.keys(delta).length === 0) {
      throw new Errors.BadRequest('Invalid update delta');
    }
    let record = options.submission || (await this.getSubmission(id));
    let previous = {};
    let update = {};
    let auditUpdate = {};

    for (let key of Object.keys(delta)) {
      let previousValue = _.get(record.data, key, null);
      if (previousValue !== delta[key]) {
        update['data.' + key] = delta[key];
        auditUpdate[key] = delta[key];
        previous[key] = previousValue;
      }
    }

    if (options.previousDelta) {
      for (let key of Object.keys(options.previousDelta)) {
        let currentVal =
          options.previousDelta[key] && options.previousDelta[key] !== '0'
            ? options.previousDelta[key]
            : null;
        let recordVal = previous[key] && previous[key] !== '0' ? previous[key] : null;
        if (currentVal != recordVal) {
          // Optimistic Lock. Do not compare type so we don't get into string/number issues.
          throw new Errors.BadRequest(
            'The data you are trying to edit is stale. Refresh the page and try again.'
          );
        }
      }
    }

    // Don't bother updating if there's nothing to update.
    if (Object.keys(update).length) {
      let auditRecord = {
        update: auditUpdate,
        previous,
        modified: new Date(),
        modifiedBy: {
          id: new ObjectId(this.user._id),
          email: this.user.email,
          name: this.user.name
        }
      };

      if (options.auditId) {
        auditRecord.auditId = options.auditId;
      }

      const submissions = this.collection(SUBMISSIONS);
      let results = await submissions.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: update,
          $push: {
            _edits: auditRecord
          }
        }
      );

      let updatedSubmission = await this.getSubmission(id);
      await this.#updateSourceLastUpdate(updatedSubmission.source);
      return updatedSubmission;
    } else {
      return record;
    }
  }

  /**
   * Update submissions in bulk.
   * @deprecated
   * @param {object} source
   * @param {Array[String|ObjectId]} id
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

    // this.user.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);
    let update = {};
    update['data.' + field] = value;

    let auditRecord = {
      field,
      value,
      modified: new Date(),
      modifiedBy: {
        id: new ObjectId(this.user._id),
        email: this.user.email,
        name: this.user.name
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
   * @param {{
   *  externalIdKey: String,
   *  originIdKey: String,
   *  createdKey: String,
   *  auditId: ObjectId
   * }} options Options to use on insert. Can include:
   *   - externalIdKey {string} To filter out existing submissions from exsternal source (ODK).
   *   - originIdKey {string} To associate with a copied item.
   *   - createdKey {string} To use as the create date.
   *   - auditId {ObjectId} Audit record, if we are doing a user genereated bulk import.
   * @return {array} Array of new submission IDs.
   */
  async insertSubmissions(source, submissions, options = {}) {
    const col = this.collection(SUBMISSIONS);

    let toInsert = submissions;
    if (options.externalIdKey) {
      let ids = submissions.map((s) => s[options.externalIdKey]);

      let exists = (
        await col
          .find({ externalId: { $in: ids } })
          .map((s) => {
            return s.externalId;
          })
          .toArray()
      ).filter(Boolean);

      toInsert = submissions.filter((s) => {
        return !exists.includes(s[options.externalIdKey]);
      });
    }

    let now = new Date();
    if (toInsert.length > 0) {
      toInsert = toInsert.map((s) => {
        let created = now;
        let { _attachmentsPresent, ...rest } = s;

        if (options.createdKey && Object.hasOwn(s, options.createdKey)) {
          let createDate = s[options.createdKey];
          delete rest[options.createdKey];

          if (typeof createDate === 'string') {
            createDate = new Date(createDate);
          }

          if (createDate instanceof Date && createDate.toString() !== 'Invalid Date') {
            created = createDate;
          }
        }

        let externalId = null;
        if (options.externalIdKey && s[options.externalIdKey]) {
          externalId = s[options.externalIdKey];
          delete rest[options.externalIdKey];
        }

        let originId = null;
        if (options.originIdKey && s[options.originIdKey]) {
          originId = s[options.originIdKey];
          delete rest[options.originIdKey];
        }

        // Ensure no data keys are blank.
        for (let key of Object.keys(rest)) {
          if (!key) {
            delete rest[key];
          }
        }

        let submission = {
          source: source.submissionKey,
          created: created,
          imported: now,
          data: rest,
          attachments: [],
          _edits: [],
          originalData: rest
        };

        if (externalId) {
          submission.externalId = externalId;
        }

        if (originId) {
          submission.originId = new ObjectId(originId);
        }

        if (_attachmentsPresent) {
          submission._attachmentsPresent = _attachmentsPresent;
        }

        if (options.auditId) {
          submission.auditId = options.auditId;
        }

        return submission;
      });

      let sequenceFields = source.fields.filter((f) => f?.meta?.type === 'sequence');
      if (sequenceFields.length) {
        const sequenceManager = new Sequence(this.user, this.workspace);
        for (let f of sequenceFields) {
          let seq = await sequenceManager.getSequence('source', source, f);
          toInsert.forEach((submission, index) => {
            submission.data[f.id] = seq + index;
            submission.originalData[f.id] = seq + index;
          });
          await sequenceManager.incrementSequence('source', source, f, toInsert.length);
        }
      }

      let resp = await col.insertMany(toInsert);

      await this.#updateSourceLastInsert(source);

      return Object.values(resp.insertedIds);
    }

    return [];
  }

  /**
   * Add attachments to a submission. Will not update, only add.
   * @param {String|ObjectId} id
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

    await col.updateOne(
      { _id: submission._id },
      {
        $push: { attachments: { $each: toAdd } }
      }
    );

    return this.getSubmission(id);
  }

  /**
   * Create an import for a source.
   * @param {Object} source
   * @param {Array} records
   * @param {Object} options
   *   - fields: If we're creating new fields for an empty source, this is the fields.
   *   - mappedFields: If not an empty source, the fields provided in the upload.
   *   - isBulkEdit: If we're doing a bulk edit of exiting records.
   * @return {Object}
   */
  async createImport(source, records, options = {}) {
    if (!source) {
      throw new Errors.BadRequest('Source is required');
    }
    if (!records || !Array.isArray(records) || !records.length) {
      throw new Errors.BadRequest('Records are required');
    }

    const imports = this.collection(IMPORTS);
    const stagedSubmissions = this.collection(SUBMISSIONS_STAGED);
    let today = new Date();

    let newFields = null;
    let fields = options.fields;
    if (fields) {
      newFields = fields
        .filter((id) => {
          return id !== 'created';
        })
        .map((id) => {
          // Do not let fields overwrite our mandatory ones.
          if (['_id', 'id', 'imported'].includes(id)) {
            let newId = id + '_1';

            records.forEach((r) => {
              r[newId] = r[id];
              delete r[id];
            });

            id = newId;
          }

          return {
            id: id,
            name: null
          };
        });

      let duplicateFields = newFields.reduce((dups, f) => {
        if (dups[f.id]) {
          dups[f.id]++;
        } else {
          dups[f.id] = 1;
        }

        return dups;
      }, {});

      let duplicates = Object.keys(duplicateFields).filter((f) => duplicateFields[f] > 1);
      if (duplicates.length) {
        throw new Errors.BadRequest('Import has duplicate columns: ' + duplicates.join(', '));
      }
    }

    const importId = new ObjectId();

    let submissionsToPersist = records.map((r) => {
      let created = today;
      let originId = null;
      let normalized = {};
      for (let [key, value] of Object.entries(r)) {
        let newValue = value;

        if (options.isBulkEdit && key === '_id') {
          originId = new ObjectId(value);
          continue;
        }

        if (key.toLowerCase() === 'created' && newValue) {
          key = 'created';
          let createdDate = dayjs(newValue);
          if (createdDate.isValid()) {
            created = createdDate.toDate();
          }

          // For bulk edit, don't bother pushing created into data to update.
          // Preserve for true creates.
          if (options.isBulkEdit) {
            continue;
          }
        }

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

        normalized[key] = newValue;
      }

      let stagedSubmission = {
        import: importId,
        created,
        originId,
        data: normalized
      };

      return stagedSubmission;
    });

    // Ensure bulk edit is for non-deleted submissions from the correct source.
    if (options.isBulkEdit) {
      let ids = submissionsToPersist.map((s) => s.originId);
      let exists = await this.collection(SUBMISSIONS)
        .find({ _id: { $in: ids }, source: source.submissionKey, deleted: { $ne: true } })
        .map((s) => {
          return s._id.toString();
        })
        .toArray();

      submissionsToPersist = submissionsToPersist.filter((s) => {
        return s.originId && exists.includes(s.originId.toString());
      });
    }

    let toPersist = {
      _id: importId,
      sourceId: source._id,
      sourceName: source.name,
      created: today,
      createdBy: {
        id: new ObjectId(this.user._id),
        name: this.user.name,
        email: this.user.email
      },
      fields: newFields,
      mappedFields: options.mappedFields || null,
      isBulkEdit: options.isBulkEdit || false,
      count: submissionsToPersist.length
    };
    await imports.insertOne(toPersist);

    if (submissionsToPersist.length) {
      await stagedSubmissions.insertMany(submissionsToPersist);
    }

    return imports.findOne(importId);
  }

  /**
   * Get an import. User must have write permissions.
   * @param {String|ObjectId} id The import ID.
   * @return {object} The import.
   */
  async getImport(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid import ID');
    }

    const imports = this.collection(IMPORTS);
    let theImport = await imports.findOne({ _id: new ObjectId(id) });
    if (!theImport) {
      throw new Errors.BadRequest('Import not found.');
    }

    let importSource = await this.getSource(theImport.sourceId);
    this.user.validateSourcePermission(importSource, CurrentUser.PERMISSIONS.WRITE);

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

    const stagedSubmissions = this.collection(SUBMISSIONS_STAGED);
    let staged = await stagedSubmissions.findOne({ _id: new ObjectId(id) });
    if (!staged) {
      throw new Errors.BadRequest('Submission not found.');
    }

    // Loaded existing record if this is a bulk-edit staged submission
    if (staged.originId) {
      let existing = await this.getSubmission(staged.originId);
      let theImport = await this.getImport(staged.import);
      let source = await this.getSource(theImport.sourceId);
      if (existing.source === source.submissionKey) {
        staged.existing = existing;
      }
    }

    return staged;
  }

  /**
   * Get the staged submissions for an import.
   * @param {Object} theImport The import object.
   * @param {Object} options Query params:
   *  - sort
   *  - order
   *  - limit (-1 for all)
   *  - offset
   *  - filters,
   *  - sample,
   *  - id
   *  - deleted
   * @returns
   */
  async getStagedSubmissions(theImport, options = {}) {
    const col = this.collection(SUBMISSIONS_STAGED);

    let $match = {
      import: theImport._id
    };

    let countQuery = this.#buildSubmissionQuery($match, options, true);
    let fullQuery = this.#buildSubmissionQuery($match, options, false);

    if (theImport.isBulkEdit) {
      fullQuery.splice(1, 0, {
        $lookup: {
          from: 'submissions',
          localField: 'originId',
          foreignField: '_id',
          as: 'existing'
        }
      });
    }

    let totalResults = await col.aggregate([...countQuery, { $count: 'totalResults' }]).toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let results = await col.aggregate(fullQuery).toArray();

    if (theImport.isBulkEdit) {
      let source = await this.getSource(theImport.sourceId);
      results.forEach((r) => {
        if (r.existing?.length && r.existing[0].source === source.submissionKey) {
          // Make sure the existing data is for the source being bulk edited.
          // If a user uploads the wrong spreadsheet, don't mix datasets.
          // Get rid of the array for existing submission.
          r.existing = r.existing[0];
        } else {
          delete r.existing;
        }
      });
    }

    return {
      results,
      totalResults
    };
  }

  /**
   * Update staged submission.
   * @param {String|ObjectId} id
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
   * @param {Array[String|ObjectId]} id
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

  /**
   * Delete a single staged submission. Will ensure user has access edit source.
   * @param {ObjectId || String} id
   */
  async deleteStagedSubmission(id) {
    let submission = await this.getStagedSubmission(id);
    // Fetching the import will validate it exists and ensure write permissions.
    const theImport = await this.getImport(submission.import);
    const stagedSubmissions = this.collection(SUBMISSIONS_STAGED);
    stagedSubmissions.deleteOne({ _id: submission._id });
  }

  /**
   * Bulk rename a field in an import's staged submissions.
   * @param {ObjectId || String} id The import ID
   * @param {String} field The field in the import data to rename.
   * @param {String} newField The new name.
   * @return {String} The new field ID.
   */
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
   * Commit the the given import.
   * @param {object} theImport
   * @return {{count:Number, auditId: ObjectId}} The count of imported or modified submissions.
   *  and the auditId associated with the actions.
   */
  async commitImport(theImport) {
    if (!theImport) {
      throw new Errors.BadRequest('Invalid import');
    }

    let source = await this.getSource(theImport.sourceId);
    let queryResponse = await this.getStagedSubmissions(theImport, { limit: -1 });

    let auditId = new ObjectId();
    let count = queryResponse.results.length;

    if (theImport.isBulkEdit) {
      await Promise.all(
        queryResponse.results.map((r) => {
          return this.updateSubmission(r.originId, Source.flattenSubmission(r.data), {
            auditId,
            submission: r.existing
          }).catch((error) => {
            let msg =
              `Error updating submission [${r.originId}] in source ${source.submissionKey}: ` +
              error.message;
            let contextualError = new Error(msg);
            throw contextualError;
          });
        })
      );
    } else {
      let toCreate = queryResponse.results.map((r) => {
        return r.data;
      });
      let ids = await this.insertSubmissions(source, toCreate, {
        createdKey: 'created',
        auditId
      });
      count = ids.length;
    }

    await this.deleteImport(theImport);

    return {
      auditId,
      count
    };
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
   * Update a submission's custom view data.
   * @param {String|ObjectId} id
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

    let previous = {};
    previous[field] = viewData[field];

    let auditUpdate = {};
    auditUpdate[field] = value;

    let update = {};
    viewData[field] = value;
    update['viewData' + '.' + viewId + '.' + subIndex] = viewData;

    let auditRecord = {
      viewData: 'viewData' + '.' + viewId + '.' + subIndex,
      update: auditUpdate,
      previous,
      modified: new Date(),
      modifiedBy: {
        id: new ObjectId(this.user._id),
        email: this.user.email,
        name: this.user.name
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

  /**
   * Modify the field values of a particular submission to a new data type.
   * @param {object} source The source to update.
   * @param {string} fieldId The field to update.
   * @param {string} type The type to convert to. int, float, text
   * @return {number} Number of updated submissions.
   */
  async modifyFieldType(source, fieldId, type) {
    if (!source) {
      throw new Errors.BadRequest('Source is required');
    }
    let field = source.fields.find((f) => f.id === fieldId);
    if (!field) {
      throw new Errors.BadRequest('Invalid field');
    }

    if (!type || !['int', 'float', 'text'].includes(type)) {
      throw new Errors.BadRequest('Invalid field type');
    }

    const submissions = this.collection(SUBMISSIONS);
    let query = submissions.find({ source: source.submissionKey, deleted: { $ne: true } });
    let modified = 0;
    for await (let submission of query) {
      let flatRecord = Source.flattenSubmission(submission.data);
      let value = flatRecord[field.id];
      let toUpdate = value;

      if (type === 'text') {
        if (typeof value === 'number') {
          toUpdate = String(value);
        }
      } else if (type === 'int') {
        let int = parseInt(value);
        if (!isNaN(int)) {
          toUpdate = int;
        }
      } else if (type === 'float') {
        let float = parseFloat(value);
        if (!isNaN(float)) {
          toUpdate = float;
        }
      }

      if (value !== toUpdate) {
        let $set = {};
        $set[this.getFieldKey(field.id)] = toUpdate;
        await submissions.updateOne({ _id: submission._id }, { $set });
        modified++;
      }
    }

    return modified;
  }

  /**
   * Update the lastInsert field on a source.
   * @param {Object} source The source to update.
   * @param {Date} date Willd default to now if not provided.
   */
  async #updateSourceLastInsert(source, date = new Date()) {
    if (!source || !ObjectId.isValid(source._id)) {
      throw new Errors.BadRequest('Source is required');
    }

    let lastInsert = date;
    if (!lastInsert || !lastInsert instanceof Date) {
      lastInsert = new Date();
    }

    const sources = this.collection(SOURCES);
    return sources.updateOne({ _id: source._id }, { $set: { inserted: lastInsert } });
  }

  /**
   * Update the lastUpdate field on a source.
   * @param {Object|String} source The source to update. Can also be the _id or submissionKey.
   * @param {Date} date Willd default to now if not provided.
   */
  async #updateSourceLastUpdate(source, date = new Date()) {
    let findBy = {};

    // If we get a string, determine if it's _id or submissionKey
    if (source && typeof source === 'string') {
      if (ObjectId.isValid(source)) {
        findBy._id = new ObjectId(source);
      } else {
        findBy.submissionKey = source;
      }
    } else if (source && source._id && ObjectId.isValid(source._id)) {
      findBy._id = source._id;
    }

    if (!Object.keys(findBy).length) {
      throw new Errors.BadRequest('Source is required');
    }

    let lastUpdate = date;
    if (!lastUpdate || !lastUpdate instanceof Date) {
      lastUpdate = new Date();
    }

    const sources = this.collection(SOURCES);
    return sources.updateOne(findBy, { $set: { updated: lastUpdate } });
  }
}

module.exports = Source;

