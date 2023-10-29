const { ObjectId } = require('mongodb');
const Base = require('./base');
const Errors = require('../lib/errors');
const CurrentUser = require('../lib/current-user');
const Source = require('./source');

const VIEWS = 'views';
const SUBMISSIONS = 'submissions';

class View extends Base {
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

  /**
   * Get a view by ID.
   * @param {String || ObjectId} id The ID of the view.
   * @return {Object} View
   * @throws Not found error.
   */
  async getView(id) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid view ID param');
    }

    let views = this.collection(VIEWS);
    let view = await views.findOne({ _id: new ObjectId(id) });

    if (!view) {
      throw new Errors.BadRequest('View not found: ' + id);
    }
    this.user.validateViewPermission(view);

    const sourceManager = new Source(this.user);
    let sourceFields = {};
    for (let viewSource of view.sources) {
      try {
        let source = await sourceManager.getSource(new ObjectId(viewSource.source._id), true);
        sourceFields[source.submissionKey] = source.fields;
      } catch (err) {
        // Silence not found
      }
    }
    view.sourceFields = sourceFields;

    // this.debug(view);

    return view;
  }

  /**
   * List views.
   * @param {Object} options Query params (sort, order, limit (-1 for all), offset, deleted: true)
   * @return {Object} Query result object with, results, totalResults, offset.
   */
  async listViews(options = {}) {
    let pipeline = [];

    let $match = { deleted: { $ne: true } };
    if (this.user.admin) {
      // Only admins can view deleted sources
      if (options.deleted === true) {
        $match.deleted = true;
      }
    } else {
      $match.$or = [{ _id: { $in: this.user.viewIds() } }, { 'permissions.read': true }];
    }

    if (options.name && typeof options.name === 'string') {
      // Escape for regex.
      let nameQuery = options.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      $match.name = { $regex: new RegExp(nameQuery, 'i') };
    }

    if (Object.keys($match).length) {
      pipeline.push({ $match: $match });
    }

    let views = this.collection(VIEWS);
    let totalResults = await views.aggregate([...pipeline, { $count: 'totalResults' }]).toArray();
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

    let results = await views.aggregate(pipeline);

    return {
      totalResults,
      offset: offset,
      results: await results.toArray()
    };
  }

  /**
   * Create a view.
   * @param {Object} view
   * @returns {Object} The new view.
   */
  async createView(view) {
    this.user.validate(CurrentUser.PERMISSIONS.VIEW_CREATE);

    this.#validateView(view);
    if (view._id) {
      throw new Errors.BadRequest('Failed to create pre-existing view: ' + view.name);
    }

    let sources = view.sources.map((s) => {
      return {
        rename: s.rename,
        source: {
          _id: s.source._id,
          submissionKey: s.source.submissionKey,
          name: s.source.name
        }
      };
    });

    let now = new Date();
    let toPersist = {
      name: view.name,
      note: view.note,
      fields: view.fields,
      sources: sources,
      created: now,
      modified: now
    };

    toPersist.fields.forEach((f) => {
      f.id = View.normalizeFieldName(f.name);
    });

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

    const views = this.collection(VIEWS);
    let insertResult = await views.insertOne(toPersist);
    return await this.getView(insertResult.insertedId);
  }

  /**
   * Update a view.
   * @param {Object} view
   * @param {Object} user
   * @returns {Object} The updated view and deletedFields.
   */
  async updateView(view) {
    let existing = await this.getView(view._id);
    this.#validateView(view);

    let fieldsToDelete = existing.fields.filter((existingField) => {
      return !view.fields.find((f) => existingField.id === f.id);
    });

    let sources = view.sources.map((s) => {
      return {
        rename: s.rename,
        source: {
          _id: s.source._id,
          submissionKey: s.source.submissionKey,
          name: s.source.name,
          system: s.source.system
        }
      };
    });

    let now = new Date();
    let toPersist = {
      name: view.name,
      note: view.note,
      fields: view.fields,
      sources: sources,
      modified: now
    };

    toPersist.fields.forEach((f) => {
      // New fields need an ID. We don't change ID once it's created.
      if (!f.id) {
        let newFieldId = View.normalizeFieldName(f.name);
        if (toPersist.fields.some((field) => field.id === newFieldId)) {
          throw new Errors.BadRequest('Field ID must be unique: ' + newFieldId);
        }

        f.id = newFieldId;
      }
    });

    toPersist.modifiedBy = {
      id: new ObjectId(this.user._id),
      name: this.user.name,
      email: this.user.email
    };

    const views = this.collection(VIEWS);
    await views.updateOne(
      { _id: existing._id },
      {
        $set: toPersist
      }
    );

    if (fieldsToDelete.length) {
      const sourceManager = new Source(this.user);
      await sourceManager.purgeSubmissionViewData(existing, fieldsToDelete);
    }

    let updatedView = await this.getView(existing._id);
    return {
      view: updatedView,
      deletedFields: fieldsToDelete
    };
  }

  /**
   * Update a view's workspace permissions.
   * @param {Object} source
   * @param {Object} permissions
   * @returns {Object} The updated source.
   */
  async updateViewPermissions(view, permissions) {
    let existing = await this.getView(view._id);
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

    const views = this.collection(VIEWS);
    await views.updateOne(
      { _id: existing._id },
      {
        $set: toPersist
      }
    );
    return await this.getView(existing._id);
  }

  /**
   * Delete view.
   * @param {Object} view
   * @param {Object} user
   * @returns {Object} The updated view.
   */
  async deleteView(view, user) {
    let existing = await this.getView(view._id);
    let now = new Date();

    let toPersist = {
      deleted: true,
      modified: now
    };

    if (user) {
      toPersist.modifiedBy = {
        id: new ObjectId(user._id),
        name: user.name,
        email: user.email
      };
    }

    const views = this.collection(VIEWS);
    await views.updateOne(
      { _id: existing._id },
      {
        $set: toPersist
      }
    );
    return await this.getView(existing._id);
  }

  /**
   * Restore deleted view.
   * @param {Object} view
   * @param {Object} user
   * @returns {Object} The updated view.
   */
  async restoreDeletedView(view, user) {
    let existing = await this.getView(view._id);
    let now = new Date();

    let toPersist = {
      modified: now
    };

    if (user) {
      toPersist.modifiedBy = {
        id: new ObjectId(user._id),
        name: user.name,
        email: user.email
      };
    }

    const views = this.collection(VIEWS);
    await views.updateOne(
      { _id: existing._id },
      {
        $set: toPersist,
        $unset: { deleted: '' }
      }
    );
    return await this.getView(existing._id);
  }

  async queryView(viewId, fields, sources, options = {}) {
    const submissions = this.collection(SUBMISSIONS);

    if (!fields || !fields.length) {
      throw new Errors.BadRequest('View fields are required');
    }

    if (!sources || !sources.length) {
      throw new Errors.BadRequest('At least one view sources is required');
    }

    let viewSource = sources.reduce(
      (query, source) => {
        query.source.$in.push(source.source.submissionKey);
        return query;
      },
      { source: { $in: [] } }
    );

    // Evaluate sources and create a series of switch statements to use to extract
    // source data to the right fields, and know which fields come from the source.
    const unwindFields = new Set();
    const fieldMappingSwitch = [];
    const switchBranches = [];
    sources.forEach((s) => {
      // Build a data extraction switch case branch:
      // {
      //   case: {
      //     '$eq': [
      //       '$source',
      //       'fpi odk__11-2022_primate_capture'
      //     ]
      //   },
      //   then: {
      //     blood: [
      //       '$data.blood_samples.blood1_tube',
      //       '$data.blood_samples.blood2_tube'
      //     ],
      //     'animal name': '$data.start_page.animal_name'
      //   }
      // },

      let branch = {};
      branch.case = { $eq: ['$source', s.source.submissionKey] };
      branch.then = {};

      let fieldOccurrenceCount = Object.values(s.rename).reduce((aggr, f) => {
        let mappedViewField = fields.find((field) => field.name === f);
        if (mappedViewField) {
          let id = mappedViewField.id;
          aggr[id] = aggr[id] || 0;
          aggr[id]++;
        }
        return aggr;
      }, {});

      let sourceMap = {};
      for (const [existingField, newField] of Object.entries(s.rename)) {
        // Ensure rename sources are mapped to actual view fields
        let mappedViewField = fields.find((f) => f.name === newField);
        if (mappedViewField) {
          // Never let fields have . in them, or Mongo will blow up,
          let newFieldLabel = mappedViewField.id;
          let sourceFieldKey = newFieldLabel;

          let isArrayField = fieldOccurrenceCount[newFieldLabel] > 1;
          if (isArrayField) {
            unwindFields.add(newFieldLabel);
            if (!branch.then[newFieldLabel]) {
              branch.then[newFieldLabel] = ['$data.' + existingField];
            } else {
              branch.then[newFieldLabel].push('$data.' + existingField);
            }

            // Unwound fields need to distinguish the field id.
            sourceFieldKey += '_' + (branch.then[newFieldLabel].length - 1);
          } else {
            branch.then[newFieldLabel] = '$data.' + existingField;
          }

          sourceMap[sourceFieldKey] = {
            field: existingField,
            sourceKey: s.source.submissionKey,
            sourceId: s.source._id
          };
        }
      }
      switchBranches.push(branch);

      // Build a field mapping switch case branch to know aid in figuring out whether
      // a field came from the submission source or was a custom view field.
      // {
      //   case: {
      //     '$eq': [
      //       '$source',
      //       'fpi odk__11-2022_primate_capture'
      //     ]
      //   },
      //   then: {
      //     sourceFields: ['blood', 'animal name']
      //   }
      // },
      fieldMappingSwitch.push({
        case: branch.case,
        then: {
          // TODO perahps sourceFields can go away now that we have sourceMap
          sourceFields: Object.keys(branch.then),
          sourceMap,
          unwoundFields: [...unwindFields]
        }
      });
    });

    let $match = viewSource;
    $match.deleted = { $ne: true };

    // If we have an single ID filter, include it in match.
    if (options.id && ObjectId.isValid(options.id)) {
      $match._id = new ObjectId(options.id);
      options.limit = -1;
    }

    let pipeline = [
      {
        $match
      },

      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              {
                _id: '$_id',
                created: '$created',
                source: '$source',
                viewData: '$viewData',
                attachments: '$attachments'
              },
              {
                $switch: {
                  branches: fieldMappingSwitch,
                  default: {}
                }
              },
              {
                data: {
                  $mergeObjects: [
                    {
                      $switch: {
                        branches: switchBranches,
                        default: {}
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    ];

    // Unwind any multi-value fields.
    if (unwindFields.size) {
      unwindFields.forEach((fieldName) => {
        pipeline.push({
          $unwind: {
            path: '$data.' + fieldName,
            preserveNullAndEmptyArrays: true,
            includeArrayIndex: 'data._unwoundIndex'
          }
        });
      });

      pipeline.push({
        $addFields: {
          subIndex: '$data._unwoundIndex'
        }
      });

      pipeline.push({
        $unset: 'data._unwoundIndex'
      });
    } else {
      pipeline.push({
        $addFields: {
          subIndex: null
        }
      });
    }

    // Only look for custom view data if the view is persisted and we have an ID.
    if (viewId) {
      pipeline.push({
        $addFields: {
          data: {
            $mergeObjects: [
              '$data',
              // Make custom view data last so it can overwrite previous values.
              {
                $cond: {
                  if: { $eq: ['$subIndex', null] },
                  then: { $arrayElemAt: ['$viewData.' + viewId, 0] },
                  else: { $arrayElemAt: ['$viewData.' + viewId, '$subIndex'] }
                }
              }
            ]
          }
        }
      });
      pipeline.push({
        $unset: 'viewData'
      });
    }

    // Build match and field casts for filters.
    const { match, addFields } = this.filterSubmissions(options.filters);

    // If we're filtering, cast fields we want to filter by to a string.
    if (Object.keys(addFields).length) {
      pipeline.push({ $addFields: addFields });
    }

    // If we're filtering, apply filter.
    if (Object.keys(match).length) {
      pipeline.push({ $match: match });
    }

    // If we're filtering, remove casted filter-only fields.
    if (Object.keys(addFields).length) {
      pipeline.push({ $unset: '_filter' });
    }

    // If we're grouping and reducing, apply stages:
    if (options.reduce) {
      let stages = this.groupByStage(options.reduce.id, options.reduce.operation);
      pipeline.push({ $group: stages.$group });
      pipeline.push({ $addFields: stages.$addFields });
    }

    let totalResults = await submissions
      .aggregate([...pipeline, { $count: 'totalResults' }])
      .toArray();
    totalResults = totalResults && totalResults.length ? totalResults[0].totalResults : 0;

    let offset = options.offset ? Math.max(0, options.offset) : 0;

    // TODO If we need case insensitive sort, look at collation or normalizing a string to then sort on
    if (options.sort) {
      let sort = {};
      let sortKey = this.getFieldKey(options.sort);
      sort[sortKey] = options.order === 'asc' ? 1 : -1;

      // When unwinding fields, make sure we respect the unwound order.
      if (unwindFields.size) {
        sort.subIndex = 1;
      }

      // Include a unique value in our sort so Mongo doesn't screw up limit/skip operation.
      sort._id = sort[sortKey];
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

    // this.debug(pipeline);

    let results = await submissions.aggregate(pipeline).toArray();

    // If we have additional view source field information, populate it.
    // Not needed for grouping and reduction.
    if (!options.reduce && options.view && options.view.sourceFields) {
      results.forEach((r) => {
        for (const [viewField, map] of Object.entries(r.sourceMap)) {
          if (options.view.sourceFields[map.sourceKey]) {
            let sourceField = options.view.sourceFields[map.sourceKey].find(
              (f) => f.id === map.field
            );

            if (sourceField) {
              map.meta = sourceField.meta;
            }
          }
        }
      });
    }

    return {
      totalResults,
      offset: offset,
      results: results
    };
  }

  /**
   * Validate the structure of a view object.
   * @param {Object} view
   * @throws Error if a problem.
   */
  #validateView(view) {
    if (!view) {
      throw new Errors.BadRequest('View required.');
    }

    if (!view.name || typeof view.name !== 'string' || !view.name.trim().length > 0) {
      throw new Errors.BadRequest('Invalid view name.');
    }

    if (!view.fields || !Array.isArray(view.fields) || view.fields.length === 0) {
      throw new Errors.BadRequest('View fields required.');
    }

    if (
      view.fields.some((f) => {
        if (!f.name || typeof f.name !== 'string') {
          return true;
        }
      })
    ) {
      throw new Errors.BadRequest('Invalid view fields');
    }

    if (!view.sources || !Array.isArray(view.sources) || view.sources.length === 0) {
      throw new Errors.BadRequest('View sources required.');
    }

    if (
      view.sources.some((s) => {
        if (!s.source.submissionKey) {
          return true;
        }
        if (!s.rename) {
          return true;
        }
      })
    ) {
      throw new Errors.BadRequest('Invalid view sources');
    }

    // Ensure the view contains a max of one deconstructed/exploded/unwound field.
    let deconstructedFields = view.sources.reduce((explodedFields, s) => {
      let fields = Object.values(s.rename);
      let fieldCount = fields.reduce((counts, fieldName) => {
        counts[fieldName] = counts[fieldName] || 0;
        counts[fieldName]++;
        return counts;
      }, {});

      fields
        .filter((fieldName) => {
          return fieldCount[fieldName] > 1;
        })
        .forEach((fieldName) => {
          explodedFields.add(fieldName);
        });
      return explodedFields;
    }, new Set());
    if (deconstructedFields.size > 1) {
      let msg = `Views can only contain a single deconstructed field. You currently have ${
        deconstructedFields.size
      }: ${[...deconstructedFields].join(', ')}`;
      throw new Errors.BadRequest(msg);
    }
  }

  async updateSubmission(view, id, subIndex, field, value, currentValue) {
    // Ensure subIndex is a number and greater than 0.
    subIndex = typeof subIndex === 'number' ? Math.max(0, subIndex) : 0;

    const sourceManager = new Source(this.user);

    const submission = await sourceManager.getSubmission(id);
    let submissionSource = view.sources.find((s) => {
      return s.source.submissionKey === submission.source;
    });

    if (!submissionSource) {
      throw new Errors.BadRequest('Source not found in view: ' + submission.source);
    }

    let submissionField = null;
    for (const [sourceField, renamedField] of Object.entries(submissionSource.rename)) {
      if (field === View.normalizeFieldName(renamedField)) {
        if (!submissionField) {
          submissionField = sourceField;
        } else if (Array.isArray(submissionField)) {
          submissionField.push(sourceField);
        } else {
          submissionField = [submissionField];
          submissionField.push(sourceField);
        }
      }
    }

    if (submissionField) {
      if (Array.isArray(submissionField) && subIndex < submissionField.length) {
        submissionField = submissionField[subIndex];
      }

      await sourceManager.updateSubmission(submission._id, submissionField, value, currentValue);
    } else {
      // Custom Field
      await sourceManager.updateSubmissionViewData(
        submission._id,
        view,
        field,
        subIndex,
        value,
        currentValue
      );
    }

    // Query the updated view submission.
    let queryResponse = await this.queryView(view._id, view.fields, view.sources, {
      id: submission._id,
      view
    });

    if (queryResponse.results.length) {
      if (queryResponse.results.length > 1) {
        // If the updated submission was unwound, we need to return the specific results.
        return queryResponse.results.find((record) => {
          return record['subIndex'] === subIndex;
        });
      } else {
        return queryResponse.results[0];
      }
    }

    return null;
  }

  async removeSourceFieldFromViews(source, fields) {
    if (!source) {
      throw new Errors.BadRequest('source required.');
    }
    if (!fields) {
      throw new Errors.BadRequest('fields required.');
    }

    if (fields.length === 0) {
      return;
    }

    const views = this.collection(VIEWS);

    // Unsetting rename fields with dot in key didn't work, do the slow way instead.
    // TODO come back to this.

    // let $unset = fields.reduce((unset, f) => {
    //   unset[`sources.rename."${f.id}"`] = 1;
    //   return unset;
    // }, {});

    // // Clear removed source field from views that have it set.
    // let resp = await views.updateMany(
    //   { 'sources.source.submissionKey': source.submissionKey },
    //   { $unset }
    // );
    // console.log(resp);

    // Find all views for this source, delete the fields from them.
    let allViews = await views
      .find({ 'sources.source.submissionKey': source.submissionKey })
      .toArray();
    for (let v of allViews) {
      for (let i = 0; i < v.sources.length; i++) {
        let s = v.sources[i];
        if (s.source.submissionKey === source.submissionKey) {
          // Replace rename object with new one without deleted fields.
          let $set = {};
          $set[`sources.${i}.rename`] = fields.reduce(
            (newRename, f) => {
              delete newRename[f.id];
              return newRename;
            },
            { ...s.rename }
          );

          await views.updateOne({ _id: v._id }, { $set: $set });
        }
      }
    }
  }
}

module.exports = View;

