const express = require('express');
const View = require('../../db/view');
const User = require('../../db/user');
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
      let { view, deletedFields } = await viewManager.updateView(req.body);
      const auditManager = new Audit(getCurrentUser(res));
      auditManager.logViewEdit(view, deletedFields);
      res.json(view);
    } catch (error) {
      next(error);
    }
  });

  // Delete a view.
  router.post('/:id/delete', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      currentUser.validate(CurrentUser.PERMISSIONS.VIEW_CREATE);
      const viewManager = new View(currentUser);
      const userManager = new User(currentUser.workspace);
      const auditManager = new Audit(currentUser);

      const view = await viewManager.getView(req.params.id);
      if (view.deleted === true) {
        throw new Error.BadRequest('View already deleted');
      }

      await viewManager.deleteView(view, currentUser);
      await userManager.removeViewFromUsers(view);
      await auditManager.logViewDelete(view);

      res.redirect(`/data-viewer/view/${view._id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  // Restore a view.
  router.post('/:id/restore', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.VIEW_CREATE);
      const viewManager = new View(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));

      const view = await viewManager.getView(req.params.id);
      if (view.deleted !== true) {
        throw new Error.BadRequest('View is not deleted');
      }

      await viewManager.restoreDeletedView(view, getCurrentUser(res));
      await auditManager.logViewRestore(view);
      res.redirect(`/data-viewer/view/${view._id}/edit`);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get a submission from a view.
   */
  router.get('/:id/submission/:submissionId', async (req, res, next) => {
    try {
      const viewManager = new View(getCurrentUser(res));
      const view = await viewManager.getView(req.params.id);
      getCurrentUser(res).validateViewPermission(view, CurrentUser.PERMISSIONS.READ);
      let queryResponse = await viewManager.queryView(view._id, view.fields, view.sources, {
        id: req.params.submissionId
      });
      res.json(queryResponse);
    } catch (error) {
      next(error);
    }
  });

  // Update a view's workspace permissions.
  router.put('/:id/permissions', async (req, res, next) => {
    try {
      getCurrentUser(res).validate(CurrentUser.PERMISSIONS.SOURCE_CREATE);
      const viewManager = new View(getCurrentUser(res));
      const userManager = new User(getCurrentUser(res));
      const auditManager = new Audit(getCurrentUser(res));
      const view = await viewManager.getView(req.params.id);

      let allPermissions = req.body.all;
      let updatedView = await viewManager.updateViewPermissions(view, allPermissions);

      // TODO revisit
      // let userPermissions = req.body.users;
      // let previousUsers = await userManager.listUsersByView(source);
      // users.forEach((u) => {
      //   u.acl = u.views[view._id] || {};
      // });

      auditManager.logViewEdit(view);
      res.json(updatedView);
    } catch (error) {
      next(error);
    }
  });

  return router;
};

