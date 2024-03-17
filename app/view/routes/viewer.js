const CONFIG = require('../../config');
const express = require('express');
const path = require('path');
const { ObjectId } = require('mongodb');
const { formidable } = require('formidable');
const { firstValues } = require('formidable/src/helpers/firstValues.js');
const paginate = require('../paginate');
const Uploader = require('../../lib/uploader');
const Errors = require('../../lib/errors');
const { writeToBuffer } = require('@fast-csv/format');
const View = require('../../db/view');
const Source = require('../../db/source');
const User = require('../../db/user');
const Sequence = require('../../db/sequence');
const Audit = require('../../db/audit').Audit;
const CurrentUser = require('../../lib/current-user');
const { getCurrentUser } = require('../../lib/route-helpers');
const { v4: uuidv4 } = require('uuid');
const { noCacheMiddleware } = require('../../lib/route-helpers');
const { parseSpreadsheet } = require('../../lib/spreadsheet');

// Default page size.
const DEFAULT_LIMIT = 50;

// Reserved query params that can't be data filters.
const PAGE_QUERY_PARAMS = [
  'sort',
  'order',
  'offset',
  'limit',
  '_h',
  'id',
  'xhr',
  'iframe',
  '_select',
  'deleted',
  '__key',
  '__operation',
  '__mode'
];

const getFormBody = async (req) => {
  return new Promise((resolve, reject) => {
    const form = formidable({
      keepExtensions: true,
      allowEmptyFiles: false,
      // 20MB
      maxFileSize: 20 * 1024 * 1024
    });
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
      } else {
        // Formidable 3.x returns everything as arrays now, revert this.
        const fieldsAsSingles = firstValues(form, fields);
        resolve({ fields: fieldsAsSingles, files });
      }
    });
  });
};

const mapSubmissionsForUI = function (results = [], isEditable = false) {
  let prevRowCssClass = 'even';
  return results.map((result, index) => {
    // Determine if the current row has the same id as the previous.
    let siblings = index > 0 ? results[index - 1]._id.equals(result._id) : false;
    let rowCssClass = siblings ? prevRowCssClass : prevRowCssClass === 'even' ? 'odd' : 'even';
    prevRowCssClass = rowCssClass;
    return {
      id: result._id.toString(),
      rowCssClass,
      created: result.created,
      subIndex: result.subIndex,
      sourceId: result.source,
      // If we have an originId, present it to the UI so we can link to it.
      originId: result.originId,
      data: result.data,
      flat: Source.flattenSubmission(result.data),
      isSourceField: (fieldId) => {
        // TODO evaluate looking at result.sourceMap[fieldId] instead.
        // console.log(fieldId, result.sourceMap, result.sourceFields);
        if (fieldId && result.sourceFields) {
          return result.sourceFields.includes(fieldId);
        }

        // By default for non-views, this should always be true.
        return true;
      },
      isUnwoundField: (fieldId) => {
        if (fieldId && result.unwoundFields) {
          return result.unwoundFields.includes(fieldId);
        }
        return false;
      },
      isAttachment: (value) => {
        if (result.attachments) {
          let index = result.attachments.findIndex((a) => a.name === value);
          if (index > -1) {
            return {
              ...result.attachments[index],
              id: `file-${index}-${result._id.toString()}`,
              editable: isEditable
            };
          }
        }
        return null;
      },
      getFieldInfo: (field, subIndex) => {
        if (field && field.meta) {
          // Source submissions will have this meta object already loaded.
          return field.meta;
        }

        // View records have supplemental source field data.
        let sourceMapKey = field.id;
        if (subIndex !== undefined && subIndex !== null) {
          sourceMapKey += `_${subIndex}`;
        }
        if (field && result && result.sourceMap && result.sourceMap[sourceMapKey]) {
          return result.sourceMap[sourceMapKey].meta;
        }

        return null;
      }
    };
  });
};

const sendCSV = function (res, fileName, fields, submissions, next) {
  let encodedFileName = encodeURIComponent(fileName);
  res.setHeader('Content-Disposition', "attachment;filename*=UTF-8''" + encodedFileName + '.csv');
  res.type('text/csv');
  writeToBuffer(submissions, {
    headers: fields.map((f) => {
      return f.name;
    }),
    transform: (row) => {
      return fields.reduce((output, field) => {
        output[field.name] = row[field.id];
        return output;
      }, {});
    }
  })
    .then((buffer) => {
      res.send(buffer);
    })
    .catch((error) => {
      next(error);
    });
};

/**
 *
 * @param {object} req Request object.
 * @param {Array} fields The fields for the data being queried.
 * @param {URLSearchParams} pageParams If we want to copy params to a new query object.
 * @return {object} The filters
 */
const extractFilters = function (req, fields, pageParams) {
  // Parse column filters
  let filters = {};
  let fieldNames = fields.map((f) => f.id);
  Object.keys(req.query)
    .filter((key) => {
      if (PAGE_QUERY_PARAMS.includes(key)) {
        return false;
      }

      return fieldNames.includes(key) || ['created', 'imported', '_id', 'originId'].includes(key);
    })
    .forEach((key) => {
      let values = Array.isArray(req.query[key]) ? req.query[key] : [req.query[key]];
      values = values.filter(Boolean);
      if (values.length) {
        filters[key] = values;
        if (pageParams) {
          values.forEach((value) => {
            pageParams.append(key, value);
          });
        }
      }
    });

  return filters;
};

/**
 * Create UI friendly version of fields array.
 * @param {Array} fields
 * @param {URLSearchParams*} pageParams
 * @param {{
 *  userCanEdit: Boolean,
 *  sort: String,
 *  order: String,
 *  limit: Number,
 *  originType: String
 * }} options
 * @return {Array}
 */
const mapFieldsForUI = function (fields, pageParams, options = {}) {
  let userCanEdit = options.userCanEdit || false;
  let sort = options.sort;
  let order = options.order;
  let limit = options.limit;
  let originType = options.originType || 'source';

  if (!fields || !fields.length) {
    fields = [];
  }

  fields.unshift(
    { id: '_id', name: 'ID', default: true },
    { id: 'created', name: 'created', default: true }
  );

  // Sources can have an originId from copied data.
  if (originType === 'source') {
    fields.unshift({
      id: 'originId',
      name: 'origin ID',
      default: false
    });
  }

  return fields
    .map((f) => {
      if (typeof f === 'string') {
        return {
          id: f
        };
      } else {
        return f;
      }
    })
    .map((f) => {
      let filedForUI = {
        id: f.id,
        name: f.name || f.id,
        displayName: (f.name || f.id).replace(/\./g, '.<br>'),
        sortable: true,
        editable: userCanEdit && !Source.NON_EDITABLE_FIELDS.includes(f.id),
        meta: f.meta,
        default: f.default || false
      };

      if (sort === f.id) {
        filedForUI.isSorted = order === 'desc' ? 'desc' : 'asc';
      }

      if (pageParams) {
        const sortParams = new URLSearchParams(pageParams.toString());
        sortParams.set('sort', f.id);
        if (limit) {
          sortParams.set('limit', limit);
        }

        if (sort === f.id && order === 'asc') {
          sortParams.set('order', 'desc');
        } else if (sort === f.id && order === 'desc') {
          sortParams.set('order', 'asc');
        }
        filedForUI.url = '?' + sortParams.toString();
      }

      return filedForUI;
    });
};

module.exports = function (opts) {
  const router = express.Router();
  const nunjucks = opts.nunjucks;

  const S3_REGION = CONFIG.AWS_S3_REGION;
  const S3_BUCKET = CONFIG.AWS_S3_BUCKET;
  const uploader = new Uploader(S3_REGION, S3_BUCKET);

  /**
   * Get default page render data.
   * @param {*} req
   * @param {*} res
   * @returns
   */
  const getPageRenderData = async function (req, res) {
    const pagePath = `${req.baseUrl}${req.path}`;
    const appPath = pagePath.split('/').slice(0, 2).join('/');
    const isXHR = !!req.query.xhr;
    const isIFRAME = req.query.iframe;
    const disableSelect = req.query._select === 'false';
    const preventHeader = isIFRAME;
    return {
      appPath,
      pagePath,
      isXHR,
      isIFRAME,
      preventHeader,
      disableSelect
    };
  };

  /**
   * Render a page of submissions for a source, view, or import.
   * @param {object} query
   * @param {Request} req
   * @param {Response} res
   * @param {function} next
   * @returns
   */
  const renderPageOfResults = async function (query = {}, req, res, next) {
    const currentUser = getCurrentUser(res);
    const sourceManager = new Source(currentUser);
    const viewManager = new View(currentUser);
    const viewData = await getPageRenderData(req, res);
    const { pagePath, isXHR, isIFRAME } = viewData;

    let offset = 0;
    if (req.query.offset) {
      offset = parseInt(req.query.offset);
    }

    let limit = DEFAULT_LIMIT;
    if (req.query.limit) {
      limit = parseInt(req.query.limit);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        limit = DEFAULT_LIMIT;
      }
    }

    let sort = req.query.sort || 'created';
    let order = req.query.order || 'desc';
    let idFilter = req.query.id || null;

    const pageParams = new URLSearchParams();
    pageParams.set('sort', sort);
    pageParams.set('order', order);

    if (isIFRAME) {
      pageParams.set('iframe', isIFRAME);
    }

    let fields = [];
    let userCanEdit = false;
    let userCanCreate = false;
    let view = null;
    let source = null;
    let theImport = null;
    let csvLink = null;
    let dataId = null;
    let dataType = null;
    let editLink = null;
    let isDeleted = false;
    let showArchiveBtn = false;
    let showRestoreBtn = false;
    let showDuplicateBtn = false;
    let allowDeletedQuery = false;
    let isDeletedQuery = false;

    if (query.view) {
      view = query.view;
      fields = query.view.fields;
      dataType = 'view';
      dataId = view._id;
      originName = view.name;
      userCanEdit =
        !view.deleted && currentUser.hasViewPermission(view, CurrentUser.PERMISSIONS.WRITE);
      csvLink = '/data-viewer/csv/view/' + query.view._id.toString();
      editLink = '/data-viewer/view/' + view._id.toString() + '/edit';
      isDeleted = view.deleted;
    } else if (query.import) {
      source = query.source;
      theImport = query.import;
      // Imports to empty sources can have new fields, otherwise use existing source fields.
      fields = theImport.fields ? theImport.fields : source.fields;
      dataType = 'import';
      dataId = theImport._id;
      originName = 'Import for ' + theImport.sourceName;
      userCanEdit = true;
      editLink = '/data-viewer/source/' + theImport.sourceId.toString() + '/edit';
      showArchiveBtn = true;
    } else if (query.source) {
      source = query.source;
      fields = source.fields;
      dataType = 'source';
      dataId = source._id;
      originName = source.name;
      csvLink = '/data-viewer/csv/source/' + query.source._id.toString();
      editLink = '/data-viewer/source/' + source._id.toString() + '/edit';
      isDeleted = source.deleted;

      allowDeletedQuery = true;
      isDeletedQuery = req.query.deleted && req.query.deleted === '1' ? true : false;
      if (isDeletedQuery) {
        pageParams.set('deleted', '1');
      }

      if (!isDeleted && currentUser.hasSourcePermission(source, CurrentUser.PERMISSIONS.WRITE)) {
        showArchiveBtn = !isDeletedQuery;
        showRestoreBtn = isDeletedQuery;
        userCanEdit = !isDeletedQuery;
        showDuplicateBtn = !isDeletedQuery;
      }

      userCanCreate = userCanEdit;
    } else {
      return next(new Errors.BadRequest());
    }

    if (isIFRAME) {
      userCanEdit = false;
      csvLink = null;
      editLink = null;
    }

    // Parse column filters and set on pageParams
    let filters = extractFilters(req, fields, pageParams);

    fields = mapFieldsForUI(fields, pageParams, {
      userCanEdit,
      sort,
      order,
      limit,
      originType: dataType
    });

    let queryResponse = [];
    if (view) {
      queryResponse = await viewManager.queryView(view._id, view.fields, view.sources, {
        sort,
        order,
        limit,
        offset,
        filters,
        id: idFilter,
        view
      });
    } else if (theImport) {
      queryResponse = await sourceManager.getStagedSubmissions(theImport, {
        sort,
        order,
        limit,
        offset,
        filters,
        id: idFilter
      });
    } else if (source) {
      queryResponse = await sourceManager.getSubmissions(source, {
        sort,
        order,
        limit,
        offset,
        filters,
        id: idFilter,
        deleted: isDeletedQuery
      });
    }

    let submissions = mapSubmissionsForUI(queryResponse.results, userCanEdit);
    let currentPage = Math.floor(offset / limit) + 1;
    let pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

    let prefs = currentUser.getPrefs(dataType, dataId) || {};
    let hiddenFields = [];
    if (Array.isArray(prefs.hiddenFields)) {
      hiddenFields = prefs.hiddenFields;
      // Ensure hidden fields still exist.
      hiddenFields = hiddenFields.filter((id) => {
        return fields.find((f) => f.id == id);
      });
      prefs.hiddenFields = hiddenFields;
    } else {
      // If no fields are hidden by user preference, default to source field visibility.
      hiddenFields = fields.filter((f) => !f.default).map((f) => f.id);
    }

    // TODO we don't need this if nunjucks can find in array
    let hiddenFieldsAsObj = hiddenFields.reduce((obj, f) => {
      obj[f] = true;
      return obj;
    }, {});

    let model = {
      ...viewData,
      pagePathWQuery: pagePath + '?' + pageParams.toString(),
      csvLink: csvLink ? csvLink + '?' + pageParams.toString() : null,
      prefs,
      fields,
      hiddenFields,
      hiddenFieldsAsObj,
      submissions: submissions,
      pagination: pagination,
      userCanCreate,
      userCanEdit,
      view,
      source,
      theImport,
      dataType,
      dataId,
      pageTitle: originName,
      originName,
      editLink: currentUser.admin ? editLink : null,
      isDeleted,
      allowDeletedQuery,
      isDeletedQuery,
      showArchiveBtn,
      showRestoreBtn,
      showDuplicateBtn
    };

    let template = isXHR ? '_table' : 'viewer';
    res.render(template, model);
  };

  /**
   * Render the home page.
   */
  router.get('/', async (req, res, next) => {
    try {
      // TODO restore some day
      // const viewData = await getPageRenderData(req, res);
      // let model = {
      //   ...viewData
      // };
      // res.render('home', model);

      res.redirect('/data-viewer/sources');
    } catch (err) {
      next(err);
    }
  });

  /**
   * Redirect helper to view a submission when you only know the ID.
   */
  router.get('/submission/:id', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let submission = await sourceManager.getSubmission(req.params.id);
      let source = await sourceManager.getSourceBySubmissionKey(submission.source);

      let url = `/data-viewer/source/${source._id}?_id=${submission._id}`;
      for (let key of Object.keys(req.query).filter((key) => key !== '_id')) {
        url += `&${key}=${encodeURIComponent(req.query[key])}`;
      }
      res.redirect(url);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Download a CSV of submission data.
   */
  router.get('/csv/:type/:id', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      const viewManager = new View(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));
      let type = req.params.type;
      if (type !== 'source' && type !== 'view') {
        throw new Errors.BadRequest();
      }

      let offset = 0;
      let limit = -1;
      let sort = req.query.sort || 'created';
      let order = req.query.order || 'desc';

      let fields = [];
      let view = null;
      let source = null;

      if (type === 'view') {
        view = await viewManager.getView(req.params.id);
        fields = view.fields;
      } else {
        source = await sourceManager.getSource(req.params.id);
        fields = source.fields;
      }

      fields = mapFieldsForUI(fields, null, {
        userCanEdit: false,
        sort,
        order,
        originType: type
      });

      // Parse column filters
      let filters = extractFilters(req, fields);
      let queryResponse = null;
      let auditRecord = {};
      if (view) {
        queryResponse = await viewManager.queryView(view._id, view.fields, view.sources, {
          sort,
          order,
          limit,
          offset,
          filters
        });
        auditRecord = {
          type: 'view',
          _id: view._id,
          name: view.name,
          filters
        };
      } else {
        let deletedQuery = req.query.deleted === '1';
        queryResponse = await sourceManager.getSubmissions(source, {
          sort,
          order,
          limit,
          offset,
          filters,
          deleted: deletedQuery
        });
        auditRecord = {
          type: 'source',
          _id: source._id,
          name: source.name,
          filters
        };
      }

      let csvFields = fields.filter((f) => {
        if (req.query._h) {
          let hidden = req.query._h.split(',');
          return !hidden.includes(f.id);
        }
        return true;
      });

      let submissions = mapSubmissionsForUI(queryResponse.results, false);

      auditManager.logExport(auditRecord);

      return sendCSV(
        res,
        view ? view.name : source.name,
        csvFields,
        submissions.map((s) => {
          return {
            _id: s.id.toString(),
            created: s.created.toUTCString(),
            originId: s.originId,
            ...s.flat
          };
        }),
        next
      );
    } catch (err) {
      console.error(err);
      next(new Error('Error generating csv'));
    }
  });

  /**
   * Get and redirect to an attachment's S3 URL.
   */
  router.get('/api/attachment', noCacheMiddleware, async (req, res, next) => {
    try {
      let key = req.query.key;
      let size = req.query.size;
      if (size) {
        let ext = path.extname(key);
        let base = path.basename(key, ext);
        let prefix = path.dirname(key);
        key = `${prefix}/${base}-${size}.jpg`;
      }

      // TODO permissions?

      // Only audit full downloads, not previews.
      if (!size) {
        const auditManager = new Audit(getCurrentUser(res));
        auditManager.logFileDownload(key);
      }

      let url = await uploader.getSignedUrl(key, req.query.label);
      res.redirect(url);
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST endpoint for editing submissions.
   */
  router.post('/api/edit/source', async (req, res, next) => {
    const currentUser = getCurrentUser(res);
    try {
      let body = await getFormBody(req);
      const originType = body.fields.originType;
      const originId = body.fields.originId;
      if (!originId || !originType) {
        throw new Errors.BadRequest('Invalid params');
      }

      let ids = body.fields.ids ? body.fields.ids.split(',') : null;
      if (!ids || !ids.length) {
        throw new Errors.BadRequest('Invalid submission target');
      }

      const field = body.fields.field;
      if (!field) {
        throw new Errors.BadRequest('Invalid params');
      }

      const currentValue = body.fields.currentValue;

      const sourceManager = new Source(currentUser);
      let source = await sourceManager.getSource(originId);
      getCurrentUser(res).validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      let value = body.fields.value;
      // Make sure empty strings are turned into null db values.
      if (value === '') {
        value = null;
      }

      let valueType = body.fields.valueType || 'text';
      if (value !== null && valueType === 'int') {
        value = parseInt(value);
      } else if (value !== null && valueType === 'float') {
        value = parseFloat(value);
      }

      let html = value ? value : '';
      if (ids.length === 1) {
        // Validate submission belongs to source.
        let submission = await sourceManager.getSubmission(ids[0]);
        if (submission.source !== source.submissionKey) {
          throw new Errors.BadRequest('Invalid submission for source');
        }
        submission = await sourceManager.updateSubmission(ids[0], field, value, currentValue);
      } else {
        await sourceManager.updateBulkSubmissions(source, ids, field, value);
      }

      // For lookup fields, create link to lookup.
      let sourceField = source.fields.find((f) => f.id === field);
      if (value && /source|view/.test(sourceField?.meta?.type)) {
        let link = `/data-viewer/${sourceField.meta.type}/${sourceField.meta.originId}?${
          sourceField.meta.originField
        }=${encodeURIComponent('"' + value + '"')}`;
        html = `<a href="${link}">${html}</a>`;
      }

      const auditManager = new Audit(currentUser);
      let auditRecord = {
        type: originType,
        count: ids.length,
        ids: ids,
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        },
        field,
        value: value
      };
      auditManager.logSubmissionEdit(auditRecord);

      res.json({
        ids: ids,
        isAttachment: false,
        value,
        html
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/edit/attachment', async (req, res, next) => {
    const currentUser = getCurrentUser(res);
    const sourceManager = new Source(currentUser);
    const viewManager = new View(currentUser);
    try {
      let body = await getFormBody(req);
      if (!body.files?.value) {
        throw new Errors.BadRequest('Invalid file param');
      }

      const originType = body.fields.originType;
      const originId = body.fields.originId;
      if (!originId || !originType) {
        throw new Errors.BadRequest('Invalid params');
      }

      let source = null;
      let view = null;
      let submission = null;
      let persistFn = null;
      let field = null;
      let tempFile = body.files.value[0];
      let fileName = tempFile.originalFilename;

      // Save with a uuid to prevent overwrite.
      let uniqueFileName = uuidv4() + path.extname(fileName).toLowerCase();
      let currentValue = body.fields.currentValue;

      if (originType === 'source') {
        let ids = body.fields.ids ? body.fields.ids.split(',') : null;
        if (!ids || !ids.length) {
          throw new Errors.BadRequest('Invalid submission target');
        }
        if (ids.length > 1) {
          throw new Errors.BadRequest('Attachments are not supported for bulk edit.');
        }

        field = body.fields.field;
        if (!field) {
          throw new Errors.BadRequest('Invalid field param');
        }

        const id = ids[0];
        submission = await sourceManager.getSubmission(id);
        source = await sourceManager.getSourceBySubmissionKey(submission.source);
        currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

        persistFn = async () => {
          return await sourceManager.updateSubmission(id, field, uniqueFileName, currentValue);
        };
      } else if (originType === 'view') {
        view = await viewManager.getView(originId);
        getCurrentUser(res).validateViewPermission(view, CurrentUser.PERMISSIONS.WRITE);

        let fields = body.fields.fields ? JSON.parse(body.fields.fields) : null;
        if (!fields || !fields.length) {
          throw new Errors.BadRequest('Invalid submission target');
        }

        if (fields.some((f) => !f.id || !f.field)) {
          throw new Errors.BadRequest('Invalid fields');
        }

        if (fields.length > 1) {
          throw new Errors.BadRequest('Attachments are not supported for bulk edit.');
        }

        let toUpdate = fields[0];
        submission = await sourceManager.getSubmission(View.parseSubmissionId(toUpdate.id));
        let submissionSource = view.sources.find((s) => {
          return s.source.submissionKey === submission.source;
        });

        if (!submissionSource) {
          throw new Errors.BadRequest('Source not found in view: ' + submission.source);
        }
        source = await sourceManager.getSourceBySubmissionKey(submission.source);

        // Check if field is an unwound multi-field
        field = View.parseFieldId(toUpdate.field);
        persistFn = async () => {
          return await viewManager.updateSubmission(
            view,
            submission._id,
            View.parseSubIndex(toUpdate.field),
            field,
            uniqueFileName
          );
        };
      } else {
        throw new Errors.BadRequest('Attachments are not supported for staged imports.');
      }

      try {
        const id = submission._id.toString();

        let attachment = await uploader.uploadAttachment(
          res.locals.workspace,
          source,
          id,
          uniqueFileName,
          tempFile.size,
          tempFile.filepath,
          fileName
        );

        submission = await sourceManager.addSubmissionAttachments(id, [attachment]);
        submission = await persistFn();

        let html = nunjucks.render('_attachment.njk', {
          submission: {
            id
          },
          field: {
            id: field
          },
          attachment: {
            ...attachment,
            id: `file-${Date.now()}-${id}`,
            editable: true
          }
        });

        tempFile.destroy();

        const auditManager = new Audit(currentUser);
        let auditRecord = {
          type: originType,
          count: 1,
          id,
          field,
          value: fileName,
          previous: currentValue,
          isAttachment: true
        };
        if (view) {
          auditRecord.view = {
            _id: view._id,
            name: view.name
          };
        } else {
          auditRecord.source = {
            _id: source._id,
            name: source.name,
            submissionKey: source.submissionKey
          };
        }
        auditManager.logSubmissionEdit(auditRecord);

        res.json({
          ids: [id],
          isAttachment: true,
          value: fileName,
          html
        });
      } catch (error) {
        tempFile.destroy();
        throw error;
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/edit/view', async (req, res, next) => {
    const currentUser = getCurrentUser(res);
    try {
      const viewManager = new View(currentUser);
      let body = await getFormBody(req);
      const originType = body.fields.originType;
      const originId = body.fields.originId;
      if (!originId || !originType) {
        throw new Errors.BadRequest('Invalid params');
      }

      let fields = body.fields.fields ? JSON.parse(body.fields.fields) : null;
      if (!fields || !fields.length) {
        throw new Errors.BadRequest('Invalid submission target');
      }

      if (fields.some((f) => !f.id || !f.field)) {
        throw new Errors.BadRequest('Invalid fields');
      }

      let value = body.fields.value;
      // Make sure empty strings are turned into null db values.
      if (value === '') {
        value = null;
      }

      let valueType = body.fields.valueType || 'text';
      if (value !== null && valueType === 'int') {
        value = parseInt(value);
      } else if (value !== null && valueType === 'float') {
        value = parseFloat(value);
      }

      let html = value ? value : '';
      let htmls = {};

      let view = await viewManager.getView(originId);
      getCurrentUser(res).validateViewPermission(view, CurrentUser.PERMISSIONS.WRITE);

      // TODO
      // Validate submission belongs to view set of sources.
      // submission = await sourceManager.getSubmission(id);
      // if (!view.sources.some((s) => submission.source === s.source.submissionKey)) {
      //   throw new Errors.BadRequest('Invalid submission for view');
      // }

      let currentValue = body.fields.currentValue;

      for (let toUpdate of fields) {
        // Check if field is an unwound multi-field
        let field = View.parseFieldId(toUpdate.field);
        let subIndex = View.parseSubIndex(toUpdate.field);
        submission = await viewManager.updateSubmission(
          view,
          View.parseSubmissionId(toUpdate.id),
          subIndex,
          field,
          value
        );

        let sourceMapKey = field;
        if (typeof subIndex === 'number') {
          sourceMapKey += `_${subIndex}`;
        }

        let sourceField = submission.sourceMap ? submission.sourceMap[sourceMapKey] : null;
        let instanceHtml = html;
        if (sourceField) {
          // For lookup fields, create link to lookup.
          if (value && /source|view/.test(sourceField?.meta?.type)) {
            let link = `/data-viewer/${sourceField.meta.type}/${sourceField.meta.originId}?${
              sourceField.meta.originField
            }=${encodeURIComponent('"' + value + '"')}`;
            instanceHtml = `<a href="${link}">${html}</a>`;
          }
        }
        htmls[`${submission._id}-${toUpdate.field}`] = instanceHtml;
      }

      const auditManager = new Audit(currentUser);
      let auditRecord = {
        type: originType,
        count: fields.length,
        fields: fields,
        value: value,
        view: {
          _id: view._id,
          name: view.name
        }
      };
      auditManager.logSubmissionEdit(auditRecord);

      res.json({
        isAttachment: false,
        fields,
        value,
        html,
        htmls
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/edit/import', async (req, res, next) => {
    const currentUser = getCurrentUser(res);
    try {
      const sourceManager = new Source(currentUser);
      let body = await getFormBody(req);
      const originType = body.fields.originType;
      const originId = body.fields.originId;
      if (!originId || !originType) {
        throw new Errors.BadRequest('Invalid params');
      }

      let ids = body.fields.ids ? body.fields.ids.split(',') : null;
      if (!ids || !ids.length) {
        throw new Errors.BadRequest('Invalid submission target');
      }

      const field = body.fields.field;
      if (!field) {
        throw new Errors.BadRequest('Invalid params');
      }

      const currentValue = body.fields.currentValue;

      // Write permissions are factored into getImport(), no need to double check.
      let theImport = await sourceManager.getImport(originId);
      let source = await sourceManager.getSource(theImport.sourceId);

      let value = body.fields.value;
      // Make sure empty strings are turned into null db values.
      if (value === '') {
        value = null;
      }

      let valueType = body.fields.valueType || 'text';
      if (value !== null && valueType === 'int') {
        value = parseInt(value);
      } else if (value !== null && valueType === 'float') {
        value = parseFloat(value);
      }

      let html = value ? value : '';

      await sourceManager.updateBulkStagedSubmissions(theImport, ids, field, value);

      // For lookup fields, create link to lookup.
      let sourceField = source.fields.find((f) => f.id === field);
      if (value && sourceField && /source|view/.test(sourceField?.meta?.type)) {
        let link = `/data-viewer/${sourceField.meta.type}/${sourceField.meta.originId}?${
          sourceField.meta.originField
        }=${encodeURIComponent('"' + value + '"')}`;
        html = `<a href="${link}">${html}</a>`;
      }

      const auditManager = new Audit(currentUser);
      let auditRecord = {
        type: originType,
        count: ids.length,
        ids: ids,
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        },
        field,
        value: value
      };
      auditManager.logSubmissionEdit(auditRecord);

      res.json({
        ids: ids,
        isAttachment: false,
        value,
        html
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render view listing page.
   */
  router.get('/views', async (req, res, next) => {
    try {
      let viewManager = new View(res.locals.user);
      const viewData = await getPageRenderData(req, res);
      const { pagePath } = viewData;
      const pageParams = new URLSearchParams();

      let offset = 0;
      if (req.query.offset) {
        offset = parseInt(req.query.offset);
      }

      let limit = 20;
      if (req.query.limit) {
        limit = parseInt(req.query.limit);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          limit = 20;
        }
      }

      let nameQuery = null;
      if (req.query.name && req.query.name.length && req.query.name.length < 255) {
        nameQuery = req.query.name;
      }

      let deleted = false;
      if (req.query.deleted) {
        deleted = true;
      }

      let sort = req.query.sort || 'name';
      let order = req.query.order || 'asc';

      let sortLinks = ['name', 'created'].reduce((links, col) => {
        let url = '?sort=' + col;
        if (sort === col && order === 'asc') {
          url += '&order=' + 'desc';
        } else if (sort === col && order === 'desc') {
          url += '&order=' + 'asc';
        }

        if (nameQuery) {
          url += '&name=' + encodeURIComponent(nameQuery);
        }
        if (deleted) {
          url += '&deleted=1';
        }
        links[col] = url;
        return links;
      }, {});

      pageParams.set('sort', sort);
      pageParams.set('order', order);
      if (deleted) {
        pageParams.set('deleted', 1);
      }
      if (nameQuery) {
        pageParams.set('name', nameQuery);
      }

      let queryResponse = await viewManager.listViews({
        offset,
        limit,
        sort,
        order,
        name: nameQuery,
        deleted: deleted
      });

      let currentPage = Math.floor(offset / limit) + 1;
      let pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

      let model = {
        ...viewData,
        pagePathWQuery: pagePath + '?' + pageParams.toString(),
        pagination,
        results: queryResponse.results,
        sort,
        order,
        sortLinks,
        nameQuery,
        deleted,
        pageTitle: 'Views'
      };

      res.render('view-list', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render create view page.
   */
  router.get('/view/new', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.VIEW_CREATE);

      const sourceManager = new Source(getCurrentUser(res));
      const viewManager = new View(getCurrentUser(res));
      const viewData = await getPageRenderData(req, res);

      // TODO Revisit with pagination?
      let sources = await sourceManager.listSources({ limit: -1 });

      let toCreate = {
        name: '',
        fields: [],
        sources: []
      };

      if (req.query.origin && ObjectId.isValid(req.query.origin)) {
        let duplicate = await viewManager.getView(req.query.origin);
        if (duplicate) {
          toCreate.fields = duplicate.fields;
          toCreate.sources = duplicate.sources;
          // TODO revisit cloning with permissions
        }

        // Ensure view sources have up-to-date names
        toCreate = viewManager.sanitizeStaleData(toCreate, sources);
      }

      let model = {
        ...viewData,
        view: toCreate,
        sources,
        pageTitle: 'New View'
      };

      res.render('view-edit', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render a view page.
   */
  router.get('/view/:id', async (req, res, next) => {
    try {
      let viewManager = new View(getCurrentUser(res));
      let view = await viewManager.getView(req.params.id);
      return await renderPageOfResults({ view: view }, req, res, next);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render a view edit page.
   */
  router.get('/view/:id/edit', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.VIEW_CREATE);

      const userManager = new User(res.locals.workspace);
      const sourceManager = new Source(getCurrentUser(res));
      const viewManager = new View(getCurrentUser(res));
      const viewData = await getPageRenderData(req, res);
      let view = await viewManager.getView(req.params.id);

      let users = await userManager.listUsersByView(view);
      users.forEach((u) => {
        u.acl = u.views[view._id] || {};
      });

      // TODO Revisit with pagination?
      let sources = await sourceManager.listSources({ limit: -1 });

      // Ensure view sources have up-to-date names
      view = viewManager.sanitizeStaleData(view, sources);

      let model = {
        ...viewData,
        view,
        users,
        sources,
        pageTitle: view.name + ' - Edit'
      };

      res.render('view-edit', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render a view preview table html. To be called via AJAX.
   */
  router.post('/view-preview', async (req, res, next) => {
    try {
      // TODO permissions!
      const viewManager = new View(getCurrentUser(res));
      const viewData = await getPageRenderData(req, res);
      const { pagePath } = viewData;
      const userCanEdit = false;
      const pageParams = new URLSearchParams();

      let offset = 0;
      if (req.query.offset) {
        offset = parseInt(req.query.offset);
      }

      let limit = 10;
      if (req.query.limit) {
        limit = parseInt(req.query.limit);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          limit = 10;
        }
      }

      let sort = req.query.sort || 'created';
      let order = req.query.order || 'desc';

      if (req.body.fields) {
        req.body.fields.forEach((f) => {
          f.id = f.id || View.normalizeFieldName(f.name);
        });
      }

      let fields = mapFieldsForUI(req.body.fields, pageParams, {
        userCanEdit,
        sort,
        order,
        limit,
        originType: 'view'
      });

      // Parse column filters
      let filters = extractFilters(req, fields, pageParams);

      pageParams.set('sort', sort);
      pageParams.set('order', order);

      let queryResponse = await viewManager.queryView(null, req.body.fields, req.body.sources, {
        sort,
        order,
        limit,
        offset,
        filters
      });

      let submissions = mapSubmissionsForUI(queryResponse.results, userCanEdit);

      let currentPage = Math.floor(offset / limit) + 1;
      let pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

      let model = {
        ...viewData,
        pagePathWQuery: pagePath + '?' + pageParams.toString(),
        fields: fields,
        submissions: submissions,
        pagination: pagination,
        userCanEdit
      };

      let template = '_table';
      res.render(template, model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render the list of sources page.
   */
  router.get('/sources', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      const viewData = await getPageRenderData(req, res);
      const { pagePath } = viewData;
      const pageParams = new URLSearchParams();

      let offset = 0;
      if (req.query.offset) {
        offset = parseInt(req.query.offset);
      }

      let limit = 20;
      if (req.query.limit) {
        limit = parseInt(req.query.limit);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          limit = 20;
        }
      }

      let sort = req.query.sort || 'created';
      let order = req.query.order || 'desc';

      let nameQuery = null;
      if (req.query.name && req.query.name.length && req.query.name.length < 255) {
        nameQuery = req.query.name;
      }

      let deleted = false;
      if (req.query.deleted) {
        deleted = true;
      }

      let sortLinks = ['created', 'system', 'namespace', 'name'].reduce((links, col) => {
        let url = '?sort=' + col;
        if (sort === col && order === 'asc') {
          url += '&order=' + 'desc';
        } else if (sort === col && order === 'desc') {
          url += '&order=' + 'asc';
        }

        if (nameQuery) {
          url += '&name=' + encodeURIComponent(nameQuery);
        }
        if (deleted) {
          url += '&deleted=1';
        }
        links[col] = url;
        return links;
      }, {});

      pageParams.set('sort', sort);
      pageParams.set('order', order);
      if (deleted) {
        pageParams.set('deleted', 1);
      }
      if (nameQuery) {
        pageParams.set('name', nameQuery);
      }

      let queryResponse = await sourceManager.listSources({
        offset,
        limit,
        sort,
        order,
        name: nameQuery,
        deleted: deleted
      });

      let currentPage = Math.floor(offset / limit) + 1;
      let pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

      let model = {
        ...viewData,
        pagePathWQuery: pagePath + '?' + pageParams.toString(),
        pagination,
        results: queryResponse.results,
        sort,
        order,
        sortLinks,
        nameQuery,
        deleted,
        pageTitle: 'Sources'
      };

      res.render('source-list', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render the create source page.
   */
  router.get('/source/new', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const viewData = await getPageRenderData(req, res);

      // TODO Revisit with pagination?
      const sourceManager = new Source(getCurrentUser(res));
      let sources = await sourceManager.listSources({ limit: -1, sort: 'name', order: 'asc' });

      let toCreate = {
        name: '',
        system: 'ISL',
        namespace: '',
        note: null,
        fields: []
      };

      if (req.query.origin && ObjectId.isValid(req.query.origin)) {
        let duplicateId = new ObjectId(req.query.origin);
        let duplicate = sources.results.find((s) => s._id.equals(duplicateId));
        if (duplicate) {
          toCreate.note = duplicate.note;
          toCreate.fields = duplicate.fields;
          // TODO revisit cloning with permissions
        }
      }

      let model = {
        ...viewData,
        source: toCreate,
        sources,
        sequenceFields: [],
        pageTitle: 'New Source'
      };

      res.render('source-edit', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render the source page.
   */
  router.get('/source/:id', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);
      return await renderPageOfResults({ source: source }, req, res, next);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Group By and Reduce.
   * Next steps:
   *  - Render page with controls that produce this data.
   *  - Embed page in iframe from source/view
   */
  router.get('/:type/:id/reduce', async (req, res, next) => {
    try {
      let type = req.params.type;
      if (type !== 'source' && type !== 'view') {
        throw new Errors.BadRequest();
      }

      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      const viewManager = new View(currentUser);

      const viewData = await getPageRenderData(req, res);
      const { pagePath } = viewData;
      let source = null;
      let view = null;
      let filters = null;

      if (type === 'source') {
        source = await sourceManager.getSource(req.params.id);
        filters = extractFilters(req, source.fields);
      } else {
        view = await viewManager.getView(req.params.id);
        filters = extractFilters(req, view.fields);
      }

      const pageParams = new URLSearchParams('__mode=analyze');
      const isDeletedQuery = req.query.deleted && req.query.deleted === '1' ? true : false;
      if (isDeletedQuery) {
        pageParams.set('deleted', '1');
      }

      let groupId = req.query.__key;
      if (groupId && !Array.isArray(groupId)) {
        groupId = [groupId];
      }

      let operation = req.query.__operation;
      let operationCommand = null;
      if (operation) {
        let operationStr = operation.split(':');
        if (operationStr.length < 2) {
          throw new Errors.BadRequest('Invalid group operation');
        }
        operationCommand = operationStr[0];
      }

      let sort = req.query.sort || null;
      if (!sort && operationCommand) {
        sort = operationCommand;
      }

      let order = req.query.order || 'desc';

      let offset = 0;
      if (req.query.offset) {
        offset = parseInt(req.query.offset);
      }

      let limit = DEFAULT_LIMIT;
      if (req.query.limit) {
        limit = parseInt(req.query.limit);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          limit = DEFAULT_LIMIT;
        }
      }

      if (sort) {
        pageParams.set('sort', sort);
        pageParams.set('order', order);
      }

      if (groupId) {
        groupId.forEach((key) => {
          pageParams.append('__key', key);
        });
      }
      if (operation) {
        pageParams.set('__operation', operation);
      }

      let results = null;
      let fields = [];
      let pagination;
      if (groupId) {
        let options = {
          reduce: {
            id: groupId,
            operation
          },
          filters,
          deleted: isDeletedQuery,
          offset,
          limit,
          sort,
          order
        };

        let queryResponse = null;
        if (source) {
          queryResponse = await sourceManager.getSubmissions(source, options);
        } else {
          queryResponse = await viewManager.queryView(view._id, view.fields, view.sources, {
            ...options,
            view
          });
        }

        results = queryResponse.results;
        let currentPage = Math.floor(offset / limit) + 1;
        pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

        // Mongo makes us normalize field names, get back the original for the table.
        let idDisplayNames = groupId.reduce((agg, f) => {
          agg[Source.normalizeFieldName(f)] = f;
          return agg;
        }, {});

        if (results && results.length) {
          let originFields = source ? source.fields : view.fields;
          Object.keys(results[0].data).forEach((normalizedFieldId) => {
            let fieldId = normalizedFieldId;
            if (idDisplayNames[fieldId]) {
              fieldId = idDisplayNames[fieldId];
            }

            const sortParams = new URLSearchParams(pageParams.toString());
            sortParams.set('sort', fieldId);
            sortParams.set('limit', limit);
            sortParams.set('offset', 0);
            if (sort === fieldId && order === 'asc') {
              sortParams.set('order', 'desc');
            } else if (sort === fieldId && order === 'desc') {
              sortParams.set('order', 'asc');
            }

            let field = originFields.find((f) => f.id === fieldId);
            let fieldName = field ? field.name || field.id : fieldId;

            fields.push({
              id: fieldId,
              // The escaped fieldId needed for reduction and where the data lives.
              normalizedFieldId,
              name: fieldName,
              displayName: fieldName.replace(/\./g, '.<br>'),
              sortable: true,
              filterable: !!field,
              url: '?' + sortParams.toString(),
              isSorted: sort === fieldId ? order : null
            });
          });
        }
      }

      let model = {
        ...viewData,
        preventHeader: true,
        pagePathWQuery: pagePath + '?' + pageParams.toString(),
        source,
        view,
        operation,
        fields,
        filters,
        results,
        pagination
      };

      res.render('group-by', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render the source edit page.
   */
  router.get('/source/:id/edit', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);

      const userManager = new User(res.locals.workspace);
      const sourceManager = new Source(getCurrentUser(res));
      const viewData = await getPageRenderData(req, res);
      let source = await sourceManager.getSource(req.params.id);

      let samples = await sourceManager.getSubmissions(source, {
        sample: 20
      });

      let users = await userManager.listUsersBySource(source);
      users.forEach((u) => {
        u.acl = u.sources[source._id] || {};
      });

      // TODO Revisit with pagination?
      let sources = await sourceManager.listSources({ limit: -1, sort: 'name', order: 'asc' });

      const sequenceManager = new Sequence(getCurrentUser(res));
      let sequenceFields = source.fields.filter((f) => f?.meta?.type === 'sequence');
      for (let f of sequenceFields) {
        f.meta.nextValue = await sequenceManager.getSequence('source', source, f);
      }

      let model = {
        ...viewData,
        source,
        sources,
        users,
        sequenceFields,
        samples: samples.results.map((s) => {
          return Source.flattenSubmission(s.data);
        }),
        pageTitle: source.name + ' - Edit'
      };

      res.render('source-edit', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render the source create import page.
   */
  router.get('/source/:id/import', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      let source = await sourceManager.getSource(req.params.id);
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      let error = req.query.error;

      if (source.deleted) {
        throw new Errors.BadRequest('Deleted sources cannot be added to');
      }

      const viewData = await getPageRenderData(req, res);
      let imports = await sourceManager.listImports(source);
      let model = {
        ...viewData,
        source,
        imports,
        error,
        pageTitle: source.name + ' - Import'
      };

      res.render('source-import', model);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Parse submissions for a source import.
   */
  router.post('/source/:id/parse', async (req, res, next) => {
    let tempFile;
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      const auditManager = new Audit(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      let body = await getFormBody(req);
      if (!body?.files?.file) {
        throw new Errors.BadRequest('Missing import file');
      }

      tempFile = body.files.file[0];
      let { headers, records } = parseSpreadsheet(tempFile.filepath);
      tempFile.destroy();
      tempFile = null;

      let auditRecord = {
        type: 'source',
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        }
      };

      // Import into blank source. Allow creation of fields.
      if (!source.fields.length) {
        let newFields = headers.map((h) => Source.normalizeFieldName(h));
        records = records.map((r) => {
          return headers.reduce((s, header) => {
            s[Source.normalizeFieldName(header)] = r[header];
            return s;
          }, {});
        });
        let newImport = await sourceManager.createImport(source, records, newFields);
        auditRecord.import = newImport;
        auditManager.logImportCreate(auditRecord);
        return res.send({ redirect: `/data-viewer/source/${source._id}/import/${newImport._id}` });
      }

      // We have an existing source field mapping
      if (body.fields.mapping) {
        // Key: spreadsheet header, Value: source field ID
        let mapping = JSON.parse(body.fields.mapping);
        if (!mapping) {
          throw new Errors.BadRequest('Invalid header mapping');
        }

        records = records.map((r) => {
          let submission = Object.keys(mapping).reduce((s, header) => {
            s[mapping[header]] = r[header];
            return s;
          }, {});

          return Source.flatRecordToSubmission(source, submission);
        });

        let newImport = await sourceManager.createImport(source, records);
        auditRecord.import = newImport;
        auditManager.logImportCreate(auditRecord);
        return res.send({
          redirect: `/data-viewer/source/${source._id}/import/${newImport._id}`
        });
      }

      // Otherwise show a preview of the data and let the user map the fields.
      let sampleCount = Math.min(10, records.length);
      let submissionSamples = (await sourceManager.getSubmissions(source, { sample: 10 })).results;
      res.send({
        headers,
        fields: [...source.fields, { id: 'created', meta: {} }],
        samples: records.slice(0, sampleCount),
        submissionSamples
      });
    } catch (error) {
      if (tempFile) {
        try {
          tempFile.destroy();
        } catch (delError) {
          // Silence failed temp file delete
        }
      }

      if (error instanceof Errors.BadRequest) {
        return res.status(500).json({ message: error.message });
      }

      next(error);
    }
  });

  /**
   * Render a source import page.
   */
  router.get('/source/:sourceId/import/:id', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      let source = await sourceManager.getSource(req.params.sourceId);
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);
      let theImport = await sourceManager.getImport(req.params.id);

      if (!theImport) {
        return next();
      }

      return await renderPageOfResults({ import: theImport, source }, req, res, next);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Render a submission copy or duplicate page.
   */
  const copyToRoute = async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      const viewManager = new View(currentUser);
      const viewData = await getPageRenderData(req, res);
      const isView = req.params.type === 'view';

      let ids = null;
      if (req.method === 'POST') {
        if (!req.body.id) {
          throw new Errors.BadRequest('Missing target submissions');
        }
        ids = Array.isArray(req.body.id) ? req.body.id : [req.body.id];
      } else {
        if (!req.query.id) {
          throw new Errors.BadRequest('Missing target submissions');
        }
        ids = Array.isArray(req.query.id) ? req.query.id : [req.query.id];
      }

      let origin = null;
      let submissions = [];

      if (isView) {
        origin = await viewManager.getView(req.params.originId);
        submissions = await Promise.all(
          ids.map((id) => {
            let subIndex = View.parseSubIndex(id);
            return viewManager
              .queryView(origin._id, origin.fields, origin.sources, {
                id: View.parseSubmissionId(id),
                view: origin
              })
              .then((queryResponse) => {
                if (typeof subIndex === 'number') {
                  if (queryResponse.results.length > subIndex) {
                    return queryResponse.results[subIndex];
                  }
                } else if (queryResponse.results.length === 1) {
                  return queryResponse.results[0];
                }

                throw new Errors.BadRequest('Submission not found: ' + id);
              });
          })
        );
      } else {
        origin = await sourceManager.getSource(req.params.originId);
        submissions = await Promise.all(ids.map((id) => sourceManager.getSubmission(id)));
      }

      submissions = submissions
        .filter((s) => {
          if (isView) {
            // Ensure ids belong to submission in one of the view's sources.
            return origin.sources.some(
              (viewSource) => s.source === viewSource.source.submissionKey
            );
          } else {
            // Ensure ids belong to origin source.
            return s.source === origin.submissionKey;
          }
        })
        .map((s) => {
          return {
            _id: s._id,
            data: Source.flattenSubmission(s.data)
          };
        });
      if (!submissions.length) {
        throw new Errors.BadRequest('Missing target submissions');
      }

      let sources = await sourceManager.listSources({ limit: -1, sort: 'name', order: 'asc' });
      let editableSources = sources.results.filter((s) => {
        return currentUser.hasSourcePermission(s, CurrentUser.PERMISSIONS.WRITE);
      });

      let destinationId =
        req.query.destId && ObjectId.isValid(req.query.destId)
          ? new ObjectId(req.query.destId)
          : null;
      let destination = destinationId
        ? editableSources.find((s) => s._id.equals(destinationId))
        : null;

      let model = {
        ...viewData,
        preventHeader: true,
        sources: editableSources,
        origin,
        submissions,
        destination,
        pageTitle: origin.name + ' - Copy To',
        userCanLink:
          !isView && currentUser.hasSourcePermission(origin, CurrentUser.PERMISSIONS.WRITE)
      };
      res.render('source-copy-to', model);
    } catch (err) {
      next(err);
    }
  };
  router.post('/:type/:originId/copy-to', copyToRoute);
  router.get('/:type/:originId/copy-to', copyToRoute);

  return router;
};

