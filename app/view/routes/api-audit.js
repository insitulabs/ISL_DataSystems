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
  router.post('/undo/:id', async (req, res, next) => {
    try {
      const currentUser = getCurrentUser(res);
      const auditManager = new Audit(currentUser);
      const sourceManager = new Source(currentUser);
      const viewManager = new View(currentUser);
      let event = await auditManager.getEvent(req.params.id);

      if (event.canUndo) {
        await event.undo(sourceManager, viewManager, currentUser);
        await auditManager.markUndone(event, currentUser);
      } else {
        throw new Errors.Unauthorized('Operation cannot be undone.');
      }

      let updatedEvent = await auditManager.getEvent(req.params.id);
      res.json(updatedEvent);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

