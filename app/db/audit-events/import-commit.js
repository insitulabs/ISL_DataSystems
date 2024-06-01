const AuditEvent = require('./audit-event');
const Source = require('../source');
const View = require('../view');
const Errors = require('../../lib/errors');
const { ObjectId } = require('mongodb');
const CurrentUser = require('../../lib/current-user');

class ImportCommit extends AuditEvent {
  /** @type {boolean} */
  isBulkEdit = false;

  constructor(event) {
    super(event);
    this.isBulkEdit = this.data.import.isBulkEdit || false;
  }

  /**
   * Undo the commit.
   * @param {Source} sourceManager
   * @param {View} viewManager
   * @param {CurrentUser} currentUser
   * @return {Promise} the count of undone records
   */
  async undo(sourceManager, viewManager, currentUser) {
    let source = await sourceManager.getSource(this.data.source._id);
    currentUser.validateSourcePermission(source, CurrentUser.PERMISSIONS.WRITE);

    if (this.isBulkEdit) {
      return this.undoBulkEdit(sourceManager);
    } else {
      return this.undoCreate(sourceManager);
    }
  }

  /**
   * Undo bulk edit.
   * @param {Source} sourceManager
   * @return {Promise} the count of undone records
   */
  async undoBulkEdit(sourceManager) {
    let { results } = await sourceManager.getSubmissionsFromEditAudit(this.id);
    let count = results.length;
    if (!count) {
      throw new Errors.BadRequest(`Bad data state. Nothing to undo for ${this.id}`);
    }

    let newAuditId = new ObjectId();
    let deltas = results.reduce((deltas, submission) => {
      let edit = submission._edits.find((edit) => {
        return edit.auditId?.equals(this.id);
      });
      if (edit && edit.previous) {
        deltas[submission._id] = edit.previous;
      }
      return deltas;
    }, {});

    let deltaCount = Object.keys(deltas).length;
    if (deltaCount !== count) {
      throw new Errors.BadRequest(`Bad data state.
       Expected ${count} undo operations but only found ${deltaCount} for ${this.id}`);
    }

    return Promise.all(
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
    ).then(() => {
      return count;
    });
  }

  /**
   * Undo bulk import create. This will soft delete the submissions.
   * @param {Source} sourceManager
   * @return {Promise} the count of undone records
   */
  async undoCreate(sourceManager) {
    let { results } = await sourceManager.getSubmissionsFromCreateAudit(this.id);
    let count = results.length;
    if (!count) {
      throw new Errors.BadRequest(`Bad data state. Nothing to undo for ${this.id}`);
    }

    return Promise.all(
      results.map((submission) => {
        return sourceManager.deleteSubmission(submission._id).catch((error) => {
          let msg =
            `Error deleting submission [${submission._id}] in source ${source.submissionKey}: ` +
            error.message;
          throw new Error(msg);
        });
      })
    ).then(() => {
      return count;
    });
  }
}

module.exports = ImportCommit;

