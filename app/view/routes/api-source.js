const express = require('express');
const Source = require('../../db/source');
const User = require('../../db/user');
const Error = require('../../lib/errors');
const { getCurrentUser } = require('../../lib/route-helpers');
const CurrentUser = require('../../lib/current-user');
const Audit = require('../../db/audit').Audit;
const langUtil = require('../../lib/langUtil');
const { ObjectId } = require('mongodb');

module.exports = function (opts) {
  const router = express.Router();

  /**
   * List sources.
   */
  router.get('/', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let sources = await sourceManager.listSources();
      res.json(sources);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get sample of source submissions
   */
  router.get('/:id/sample', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);

      let limit = req.query.limit || 20;
      limit = Math.max(1, Math.min(limit, 100));

      let response = await sourceManager.getSubmissions(source, {
        sample: limit
      });
      res.json({
        ...response,
        results: response.results.map((r) => {
          return Source.flattenSubmission(r.data);
        })
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get source fields.
   * @deprecated
   */
  router.get('/:id/fields', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);

      res.json(source.fields);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get sample of source submissions.
   */
  router.get('/:id/fields-with-sample', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      const language = res.locals.language;
      let source = await sourceManager.getSource(req.params.id);

      // Translate field names
      source.fields.forEach((field) => {
        field.name = langUtil.altLangFieldName(field, language);
      });

      let limit = req.query.limit || 20;
      limit = Math.max(1, Math.min(limit, 100));

      let response = await sourceManager.getSubmissions(source, {
        sample: limit
      });
      res.json({
        source,
        sample: {
          ...response,
          results: response.results.map((r) => {
            return Source.flattenSubmission(r.data);
          })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete source import submissions.
  router.post('/:id/import/submissions/delete', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(getCurrentUser(res));

      if (!req.body && !Array.isArray(req.body)) {
        throw new Error.BadRequest('Invalid delete request');
      }

      // Auth validation done in deleteStagedSubmission
      await Promise.all(req.body.map((id) => sourceManager.deleteStagedSubmission(id)));

      // TODO do we need to audit record?

      res.send({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Rename source import field
  router.put('/:id/import/:importId/rename', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);
      let theImport = await sourceManager.getImport(req.params.importId);
      if (!source._id.equals(theImport.sourceId)) {
        throw new Error.BadRequest('Mismatch import to source');
      }

      if (source.fields.length) {
        throw new Error.BadRequest('Source cannot already have fields.');
      }

      let newFieldId = await sourceManager.updateImportField(
        req.params.importId,
        req.body.id,
        req.body.name
      );

      res.json({
        id: newFieldId
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete a source import
  router.delete('/:id/import/:importId', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);
      let theImport = await sourceManager.getImport(req.params.importId);
      if (!source._id.equals(theImport.sourceId)) {
        throw new Error.BadRequest('Mismatch import to source');
      }
      await sourceManager.deleteImport(theImport);

      const auditManager = new Audit(getCurrentUser(res));
      let auditRecord = {
        type: 'source',
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        },
        import: theImport
      };
      auditManager.logImportDelete(auditRecord);

      res.json({});
    } catch (error) {
      next(error);
    }
  });

  // Commit a source import
  router.post('/:id/import/:importId', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);
      let theImport = await sourceManager.getImport(req.params.importId);
      if (!source._id.equals(theImport.sourceId)) {
        throw new Error.BadRequest('Mismatch import to source');
      }
      let { auditId, count } = await sourceManager.commitImport(theImport);

      const auditManager = new Audit(getCurrentUser(res));
      let auditRecord = {
        type: 'source',
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        },
        count,
        import: theImport
      };
      auditManager.logImportCommit(auditRecord, auditId);

      res.json({});
    } catch (error) {
      next(error);
    }
  });

  // Create a source
  router.post('/', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));
      let source = await sourceManager.createSource(req.body);
      auditManager.logSourceCreate(source);
      res.json(source);
    } catch (error) {
      next(error);
    }
  });

  // Update a source.
  router.put('/:id', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));
      let { source, deletedFields } = await sourceManager.updateSource(req.body);
      auditManager.logSourceEdit(source, deletedFields);
      res.json(source);
    } catch (error) {
      next(error);
    }
  });

  // Delete a source.
  router.post('/:id/delete', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      currentUser.validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(currentUser);
      const userManager = new User(currentUser.workspace);
      const auditManager = new Audit(currentUser);

      const source = await sourceManager.getSource(req.params.id);
      if (source.deleted === true) {
        throw new Error.BadRequest('Source already deleted');
      }

      await sourceManager.deleteSource(source);
      await userManager.removeSourceFromUsers(source);
      await auditManager.logSourceDelete(source);

      res.redirect(`/data-viewer/source/${source._id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  // Restore a source.
  router.post('/:id/restore', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));

      const source = await sourceManager.getSource(req.params.id);
      if (source.deleted !== true) {
        throw new Error.BadRequest('Source is not deleted');
      }

      await sourceManager.restoreDeletedSource(source);
      await auditManager.logSourceRestore(source);
      res.redirect(`/data-viewer/source/${source._id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get a submission from a source.
   */
  router.get('/:id/submission/:submissionId', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      const source = await sourceManager.getSource(req.params.id);
      getCurrentUser(res).validateSourcePermission(source, CurrentUser.PERMISSIONS.READ);

      let submission;
      if (req.query.staged) {
        submission = await sourceManager.getStagedSubmission(req.params.submissionId);
      } else {
        submission = await sourceManager.getSubmission(req.params.submissionId);
      }
      res.json(submission);
    } catch (error) {
      next(error);
    }
  });

  // Create a submission for a source.
  router.post('/:id/submission', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));
      const source = await sourceManager.getSource(req.params.id);
      getCurrentUser(res).validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      let submissions = [];
      if (Array.isArray(req.body)) {
        submissions = req.body;
      } else {
        submissions = [req.body];
      }

      submissions = submissions.filter((s) => {
        if (!s || typeof s !== 'object') {
          return false;
        }

        return Object.keys(s).length > 0;
      });

      if (!submissions.length) {
        throw new Error.BadRequest('Invalid submission data');
      }

      // Convert our flat submissions into a object to better mirror what we might have gotten
      // from ODK. Also ensure any object has all the fields so that nested data
      // can be populated later.
      submissions = submissions.map((s) => {
        return Source.flatRecordToSubmission(source, s);
      });

      let auditId = new ObjectId();
      let ids = await sourceManager.insertSubmissions(source, submissions, {
        // Allow linking back to copied submission original
        originIdKey: '__originId',
        auditId
      });

      let created = await Promise.all(ids.map((id) => sourceManager.getSubmission(id)));

      auditManager.logSubmissionCreate(
        {
          type: 'source',
          source: {
            _id: source._id,
            name: source.name,
            submissionKey: source.submissionKey
          },
          count: ids.length,
          ids
        },
        auditId
      );

      res.json(created);
    } catch (error) {
      next(error);
    }
  });

  // Delete source submissions.
  router.post('/:id/submissions/delete', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      const source = await sourceManager.getSource(req.params.id);

      if (source.deleted) {
        throw new Error.BadRequest('Cannot modify a deleted source.');
      }
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      if (!req.body && !Array.isArray(req.body)) {
        throw new Error.BadRequest('Invalid delete request');
      }

      await Promise.all(req.body.map((id) => sourceManager.deleteSubmission(id)));
      const auditManager = new Audit(currentUser);

      let auditRecord = {
        type: 'source',
        count: req.body.length,
        ids: req.body,
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        }
      };
      auditManager.logSubmissionDelete(auditRecord);

      res.send({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Restore source submissions.
  router.post('/:id/submissions/restore', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const sourceManager = new Source(currentUser);
      const source = await sourceManager.getSource(req.params.id);

      if (source.deleted) {
        throw new Error.BadRequest('Cannot modify a deleted source.');
      }
      currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

      if (!req.body && !Array.isArray(req.body)) {
        throw new Error.BadRequest('Invalid delete request');
      }

      await Promise.all(req.body.map((id) => sourceManager.restoreSubmission(id)));
      const auditManager = new Audit(currentUser);

      let auditRecord = {
        type: 'source',
        count: req.body.length,
        ids: req.body,
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        }
      };
      auditManager.logSubmissionRestore(auditRecord);

      res.send({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // Update a source's workspace permissions.
  router.put('/:id/permissions', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(getCurrentUser(res));
      const userManager = new User(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));
      const source = await sourceManager.getSource(req.params.id);

      let allPermissions = req.body.all;
      let updatedSource = await sourceManager.updateSourcePermissions(source, allPermissions);

      // TODO revisit
      // let userPermissions = req.body.users;
      // let previousUsers = await userManager.listUsersBySource(source);
      // users.forEach((u) => {
      //   u.acl = u.sources[source._id] || {};
      // });

      auditManager.logSourceEdit(source);
      res.json(updatedSource);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Bulk update a field type for a source.
   */
  router.put('/:id/field-type/:field/:type', async (req, res, next) => {
    try {
      const currentUser = getCurrentUser(res);
      currentUser.validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const sourceManager = new Source(currentUser);
      const auditManager = new Audit(currentUser);
      const source = await sourceManager.getSource(req.params.id);
      let count = await sourceManager.modifyFieldType(source, req.params.field, req.params.type);
      auditManager.logSourceEdit(source);

      res.json({ modified: count });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

