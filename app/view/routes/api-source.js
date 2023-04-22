const express = require('express');
const Source = require('../../db/source');
const User = require('../../db/user');
const Error = require('../../lib/errors');
const { getCurrentUser } = require('../../lib/route-helpers');
const CurrentUser = require('../../lib/current-user');
const Audit = require('../../db/audit').Audit;

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
   * Get sample of source submissions
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
   * Get sample of source submissions
   */
  router.get('/:id/fields-with-sample', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);

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
      let count = await sourceManager.commitImport(theImport);

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
      auditManager.logImportCommit(auditRecord);

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

      let ids = await sourceManager.insertSubmissions(source, submissions);
      let created = await Promise.all(ids.map((id) => sourceManager.getSubmission(id)));

      created.forEach((submission) => {
        auditManager.logSubmissionCreate({
          type: 'source',
          source: {
            _id: source._id,
            name: source.name,
            submissionKey: source.submissionKey
          },
          submission
        });
      });

      res.json(created);
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

  return router;
};

