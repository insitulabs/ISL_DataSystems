const express = require('express');
const View = require('../../db/view');
const { getCurrentUser } = require('../../lib/route-helpers');
const CurrentUser = require('../../lib/current-user');
const Audit = require('../../db/audit').Audit;

module.exports = function (opts) {
  const router = express.Router();

  // Create a view
  router.post('/', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.VIEW_CREATE);
      const viewManager = new View(getCurrentUser(res));
      let view = await viewManager.createView(req.body);
      const auditManager = new Audit(getCurrentUser(res));
      auditManager.logViewCreate(view);
      res.json(view);
    } catch (error) {
      next(error);
    }
  });

  // Update a view.
  router.put('/:id', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.VIEW_CREATE);
      const viewManager = new View(getCurrentUser(res));
      let updated = await viewManager.updateView(req.body);
      const auditManager = new Audit(getCurrentUser(res));
      auditManager.logViewEdit(updated);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

