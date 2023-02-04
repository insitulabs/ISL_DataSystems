const express = require('express');
const Source = require('../../db/source');
const Error = require('../../lib/errors');
const { getCurrentUser } = require('../../lib/route-helpers');
const CurrentUser = require('../../lib/current-user');
const Audit = require('../../db/audit').Audit;

const SYSTEM_ONLY_FIELDS = ['_odkForm', '_odkProject', '_sourceId', '_attachmentsPresent'];

module.exports = function (opts) {
  const router = express.Router();

  /**
   * List sources.
   */
  router.get('/', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));

      // TODO security
      let sources = await sourceManager.listSources();
      res.json(sources);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get source fields
   */
  router.get('/:id/fields', async (req, res, next) => {
    try {
      let parts = req.params.id.split('__');
      if (parts.length !== 3) {
        throw new Error.BadRequest('Invalid source');
      }

      const sourceManager = new Source(getCurrentUser(res));
      getCurrentUser(res).validateSourcePermission(source, CurrentUser.PERMISSIONS.READ);

      let projectId = parseInt(parts[1]);
      let formId = parts[2];

      let fields = await sourceManager.getFormFields(projectId, formId);
      fields = fields.filter((f) => {
        return !SYSTEM_ONLY_FIELDS.includes(f);
      });
      res.json(fields);
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
  router.get('/:id/fields-with-sample', async (req, res, next) => {
    try {
      const sourceManager = new Source(getCurrentUser(res));
      let source = await sourceManager.getSource(req.params.id);

      // TODO security

      let limit = req.query.limit || 20;
      limit = Math.max(1, Math.min(limit, 100));

      // TODO just accept a source
      // let fields = await sourceManager.getFormFields(source.system, source.namespace);
      // fields = fields.filter((f) => {
      //   return !SYSTEM_ONLY_FIELDS.includes(f);
      // });

      let response = await sourceManager.getSubmissions(source, {
        sample: limit
      });
      res.json({
        source,
        // fields,
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
      let source = await sourceManager.createSource(req.body, res.locals.user);
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
      let updated = await sourceManager.updateSource(req.body, res.locals.user);
      auditManager.logSourceEdit(updated);
      res.json(updated);
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

      let submission = req.body;
      if (!submission || Object.keys(submission).length === 0) {
        throw new Error.BadRequest('Invalid submission data');
      }

      let ids = await sourceManager.insertSubmissions(source, [submission]);
      let created = await sourceManager.getSubmission(ids[0]);

      auditManager.logSubmissionCreate({
        type: 'source',
        source: {
          _id: source._id,
          name: source.name,
          submissionKey: source.submissionKey
        },
        submission: created
      });

      res.json(created);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

