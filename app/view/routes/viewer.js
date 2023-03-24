const CONFIG = require('../../config');
const express = require('express');
const path = require('path');
const formidable = require('formidable');
const paginate = require('../paginate');
const Uploader = require('../../lib/uploader');
const Errors = require('../../lib/errors');
const { writeToBuffer } = require('@fast-csv/format');
const View = require('../../db/view');
const Source = require('../../db/source');
const User = require('../../db/user');
const Audit = require('../../db/audit').Audit;
const CurrentUser = require('../../lib/current-user');
const { getCurrentUser } = require('../../lib/route-helpers');
const XLSX = require('xlsx');

const NON_EDITABLE_FIELDS = ['_id', 'created'];

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
        resolve({ fields, files });
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
      data: result.data,
      flat: Source.flattenSubmission(result.data),
      isSourceField: (fieldId) => {
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
      }
    };
  });
};

const sendCSV = function (res, fileName, fields, submissions, next) {
  res.set('Content-disposition', `attachment; filename="${fileName}.csv"`);
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

const extractFilters = function (req, fields, pageParams) {
  // Parse column filters
  let filters = {};
  let fieldNames = fields.map((f) => f.id);
  Object.keys(req.query)
    .filter((key) => {
      if (['table', 'sort', 'order', 'offset', 'limit', 'hidden', 'id'].includes(key)) {
        return false;
      }

      return fieldNames.includes(key) || ['created', 'imported'].includes(key);
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

const mapFieldsForUI = function (fields, userCanEdit = false, sort, order, pageParams) {
  if (!fields || !fields.length) {
    fields = [];
  }

  fields.unshift({ id: '_id', name: 'ID' }, { id: 'created', name: 'created' });

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
        type: '',
        sortable: true,
        editable: userCanEdit && !NON_EDITABLE_FIELDS.includes(f.id)
      };

      if (sort === f.id) {
        filedForUI.isSorted = order === 'desc' ? 'desc' : 'asc';
      }

      if (pageParams) {
        const sortParams = new URLSearchParams(pageParams.toString());
        sortParams.set('sort', f.id);

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
    return {
      appPath,
      pagePath,
      isXHR
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
    const { pagePath, isXHR } = viewData;

    let offset = 0;
    if (req.query.offset) {
      offset = parseInt(req.query.offset);
    }

    let limit = 50;
    if (req.query.limit) {
      limit = parseInt(req.query.limit);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        limit = 50;
      }
    }

    let sort = req.query.sort || 'created';
    let order = req.query.order || 'desc';
    let idFilter = req.query.id || null;

    const pageParams = new URLSearchParams();
    pageParams.set('sort', sort);
    pageParams.set('order', order);

    let fields = [];
    let userCanEdit = false;
    let userCanCreate = false;
    let view = null;
    let source = null;
    let theImport = null;
    let pageTitle = '';
    let csvLink = null;
    let dataId = null;
    let dataType = null;
    let editLink = null;

    if (query.view) {
      view = query.view;
      fields = query.view.fields;
      dataType = 'view';
      dataId = view._id;
      pageParams.set('view', query.view._id.toString());
      pageTitle = view.name;
      userCanEdit =
        !view.deleted && currentUser.hasViewPermission(view, CurrentUser.PERMISSIONS.WRITE);
      csvLink = '/data-viewer/csv/view/' + query.view._id.toString();
      editLink = '/data-viewer/view/' + view._id.toString() + '/edit';
    } else if (query.import) {
      source = query.source;
      theImport = query.import;
      fields = theImport.fields;
      dataType = 'import';
      dataId = theImport._id;
      pageTitle = 'Import for ' + theImport.sourceName;
      userCanEdit = true;
      editLink = '/data-viewer/source/' + theImport.sourceId.toString() + '/edit';
    } else if (query.source) {
      source = query.source;
      fields = source.fields;
      dataType = 'source';
      dataId = source._id;
      pageParams.set('source', query.source._id.toString());
      pageTitle = source.name;
      userCanEdit =
        !source.deleted && currentUser.hasSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);
      userCanCreate = userCanEdit;
      csvLink = '/data-viewer/csv/source/' + query.source._id.toString();
      editLink = '/data-viewer/source/' + source._id.toString() + '/edit';
    } else {
      return next(new Errors.BadRequest());
    }

    // Parse column filters and set on pageParams
    let filters = extractFilters(req, fields, pageParams);

    fields = mapFieldsForUI(fields, userCanEdit, sort, order, pageParams);

    let queryResponse = [];
    if (view) {
      queryResponse = await viewManager.queryView(view._id, view.fields, view.sources, {
        sort,
        order,
        limit,
        offset,
        filters,
        id: idFilter
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
        id: idFilter
      });
    }

    let submissions = mapSubmissionsForUI(queryResponse.results, userCanEdit);
    let currentPage = Math.floor(offset / limit) + 1;
    let pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

    let prefs = currentUser.getPrefs(dataType, dataId) || {};
    let hiddenFields = prefs.hiddenFields || [];
    // Ensure hidden fields still exist.
    hiddenFields = hiddenFields.filter((id) => {
      return fields.find((f) => f.id == id);
    });
    prefs.hiddenFields = hiddenFields;

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
      pageTitle,
      editLink: currentUser.admin ? editLink : null
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
      res.redirect(`/data-viewer/source/${source._id}?id=${submission._id}`);
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

      fields = mapFieldsForUI(fields, false, sort, order);

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
        queryResponse = await sourceManager.getSubmissions(source, {
          sort,
          order,
          limit,
          offset,
          filters
        });
        auditRecord = {
          type: 'source',
          _id: source._id,
          name: source.name,
          filters
        };
      }

      let csvFields = fields.filter((f) => {
        if (req.query.hidden) {
          let hidden = req.query.hidden.split(',');
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
          return { id: s.id.toString(), created: s.created.toUTCString(), ...s.flat };
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
  router.get('/api/attachment', async (req, res, next) => {
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

      let url = uploader.getSignedUrl(key);
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
    try {
      let body = await getFormBody(req);
      const originType = body.fields.originType;
      const originId = body.fields.originId;
      if (!originId || !originType) {
        throw new Errors.BadRequest('Invalid params');
      }

      if (originType !== 'source') {
        throw new Errors.BadRequest('Attachments are only supported on single source edit.');
      }

      let ids = body.fields.ids ? body.fields.ids.split(',') : null;
      if (!ids || !ids.length) {
        throw new Errors.BadRequest('Invalid submission target');
      }
      if (ids.length > 1) {
        throw new Errors.BadRequest('Attachments are not supported for bulk edit.');
      }

      const field = body.fields.field;
      if (!field) {
        throw new Errors.BadRequest('Invalid field param');
      }

      if (!body.files?.value) {
        throw new Errors.BadRequest('Invalid file param');
      }

      const id = ids[0];
      let submission = await sourceManager.getSubmission(id);
      let source = await sourceManager.getSourceBySubmissionKey(submission.source);
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      let tempFile = body.files.value;
      let fileName = tempFile.originalFilename;
      let currentValue = body.fields.currentValue;
      try {
        let attachment = await uploader.uploadAttachment(
          res.locals.workspace,
          source,
          id,
          fileName,
          tempFile.size,
          tempFile.filepath
        );

        let value = fileName;
        submission = await sourceManager.addSubmissionAttachments(id, [attachment]);
        submission = await sourceManager.updateSubmission(id, field, value, currentValue);
        let html = nunjucks.render('_attachment.njk', {
          submission: {
            id: submission._id.toString()
          },
          field: {
            name: field
          },
          attachment: {
            ...attachment,
            id: `file-${Date.now()}-${submission._id.toString()}`,
            editable: true
          }
        });

        tempFile.destroy();

        const auditManager = new Audit(currentUser);
        let auditRecord = {
          type: originType,
          count: 1,
          id: id,
          ids: id[0],
          source: {
            _id: source._id,
            name: source.name,
            submissionKey: source.submissionKey
          },
          field,
          value: value,
          previous: currentValue,
          isAttachment: true
        };
        auditManager.logSubmissionEdit(auditRecord);

        res.json({
          ids: ids,
          isAttachment: true,
          value,
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
        let field = toUpdate.field;

        // Check if field is an unwound multi-field
        let subIndex = /(.+)\[(\d+)\]$/.exec(field);
        if (subIndex) {
          field = subIndex[1];
          subIndex = parseInt(subIndex[2]);
        }

        submission = await viewManager.updateSubmission(view, toUpdate.id, subIndex, field, value);
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
        html
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
        deleted
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
      const viewData = await getPageRenderData(req, res);

      // TODO Revisit with pagination?
      let sources = await sourceManager.listSources({ limit: -1 });

      let model = {
        ...viewData,
        view: {
          name: '',
          fields: [],
          sources: []
        },
        sources
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
      if (view.sources) {
        view.sources.forEach((viewSource) => {
          // Compare string to ObjectId, so use double ==
          let matchingSource = sources.results.find((s) => s._id == viewSource.source._id);
          if (matchingSource) {
            viewSource.source.name = matchingSource.name;
            // Initially we did not set system on view source, This can be removed once
            // views are re-saved and this data is cleaned up.
            viewSource.source.system = matchingSource.system;
          } else {
            // Deleted source, indicate in UI.
            viewSource.source.deleted = true;
          }
        });
      }

      let model = {
        ...viewData,
        view,
        users,
        sources
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
          f.id = View.normalizeFieldName(f.name);
        });
      }

      let fields = mapFieldsForUI(req.body.fields, userCanEdit, sort, order, pageParams);

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
        deleted
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

      let model = {
        ...viewData,
        source: {
          name: '',
          fields: []
        }
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

      let model = {
        ...viewData,
        source,
        users,
        samples: samples.results.map((s) => {
          return Source.flattenSubmission(s.data);
        })
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

      if (source.deleted) {
        throw new Errors.BadRequest('Deleted sources cannot be added to');
      }

      const viewData = await getPageRenderData(req, res);
      let imports = await sourceManager.listImports(source);
      let model = {
        ...viewData,
        source,
        imports
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
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      let source = await sourceManager.getSource(req.params.id);
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      let body = await getFormBody(req);
      if (body?.files?.file) {
        let tempFile = body.files.file;
        // https://www.npmjs.com/package/xlsx#parsing-options
        let workbook = XLSX.readFile(tempFile.filepath, {});
        if (!workbook.SheetNames.length) {
          throw new Errors.BadRequest('No sheets in spreadsheet');
        }

        let worksheet = workbook.Sheets[workbook.SheetNames[0]];
        let data = XLSX.utils.sheet_to_json(worksheet, { raw: false });

        const headers = [];
        const columnCount = XLSX.utils.decode_range(worksheet['!ref']).e.c + 1;
        for (let i = 0; i < columnCount; ++i) {
          headers.push(worksheet[`${XLSX.utils.encode_col(i)}1`].v);
        }
        let newImport = await sourceManager.createImport(source, headers, data);

        const auditManager = new Audit(getCurrentUser(res));
        let auditRecord = {
          type: 'source',
          source: {
            _id: source._id,
            name: source.name,
            submissionKey: source.submissionKey
          },
          import: newImport
        };
        auditManager.logImportCreate(auditRecord);

        tempFile.destroy();

        res.redirect(`/data-viewer/source/${source._id}/import/${newImport._id}`);
      }
    } catch (error) {
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

  return router;
};

