const express = require('express');
const Source = require('../../db/source');
const CurrentUser = require('../../lib/current-user');
const View = require('../../db/view');
const Audit = require('../../db/audit').Audit;
const { ObjectId } = require('mongodb');
const Errors = require('../../lib/errors');
const { getCurrentUser } = require('../../lib/route-helpers');

module.exports = function () {
  const router = express.Router();

  /**
   * Undo an event.
   */
  router.get('/undo/:id', async (req, res, next) => {
    try {
      const currentUser = getCurrentUser(res);
      const auditManager = new Audit(currentUser);
      const sourceManager = new Source(currentUser);
      let event = await auditManager.getEvent(req.params.id);
      if (event.type === 'import-commit' && event.data.import.isBulkEdit) {
        let source = await sourceManager.getSource(event.data.source._id);
        currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);
        let { results } = await sourceManager.getSubmissionsFromAudit(req.params.id);
        let count = results.length;

        if (!count) {
          throw new Errors.BadRequest(`Bad data state. Nothing to undo for ${req.params.id}`);
        }

        let newAuditId = new ObjectId();
        let deltas = results.reduce((deltas, submission) => {
          let edit = submission._edits.find((edit) => edit.auditId?.toString() === req.params.id);
          if (edit && edit.previous) {
            deltas[submission._id] = edit.previous;
          }
          return deltas;
        }, {});

        let deltaCount = Object.keys(deltas).length;
        if (deltaCount !== count) {
          throw new Errors.BadRequest(`Bad data state.
           Expected ${count} undo operations but only found ${deltaCount} for ${req.params.id}`);
        }

        await Promise.all(
          results.map((submission) => {
            return sourceManager
              .updateSubmission(submission._id, deltas[submission._id], {
                auditId: newAuditId,
                submission
              })
              .catch((error) => {
                let msg =
                  `Error updating submission [${submission._id}] in source ${source.submissionKey}: ` +
                  error.message;
                throw new Error(msg);
              });
          })
        );

        // TODO move to a typed class
        let auditRecord = {
          type: 'source',
          count,
          // TODO is this needed?
          ids: results.map((r) => r._id.toString()),
          source: {
            _id: source._id,
            name: source.name,
            submissionKey: source.submissionKey
          },
          changes: deltas
        };
        auditManager.logSubmissionEdit(auditRecord, newAuditId);
      }

      res.json(event);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

