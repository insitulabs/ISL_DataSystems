const express = require('express');
const Source = require('../../db/source');
const User = require('../../db/user');
const View = require('../../db/view');
const Errors = require('../../lib/errors');
const emailValidator = require('../../lib/email-validator');
const { getCurrentUser } = require('../../lib/route-helpers');
const { ObjectId } = require('mongodb');
const Audit = require('../../db/audit').Audit;

module.exports = function () {
  const router = express.Router();

  /**
   * Get users for a given source or view.
   */
  router.get('/list/:type/:id', async (req, res, next) => {
    try {
      // TODO come back to this.
      throw new Errors.BadRequest('Not Implemented');

      const userManager = new User(res.locals.workspace);
      const sourceManager = new Source(getCurrentUser(res));
      const viewManager = new View(getCurrentUser(res));

      const type = req.params.type;
      if (type !== 'source' && type !== 'view') {
        throw new Errors.BadRequest();
      }

      let users = [];
      // TODO security
      if (type === 'source') {
        let source = await sourceManager.getSource(req.params.id);
        users = await userManager.listUsersBySource(source);
      }

      res.json(users);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Update user permissions on a source or view.
   */
  router.post('/:type/:id', async (req, res, next) => {
    try {
      // TODO come back to this.
      throw new Errors.BadRequest('Not Implemented');

      const userManager = new User(res.locals.workspace);
      const sourceManager = new Source(getCurrentUser(res));
      const viewManager = new View(getCurrentUser(res));

      const type = req.params.type;
      if (type !== 'source' && type !== 'view') {
        throw new Errors.BadRequest();
      }

      // TODO Security

      let email = req.query.email;
      let read = req.query.read === 'true';
      let write = req.query.write === 'true';

      if (type === 'source') {
        let source = await sourceManager.getSource(req.params.id);
        let user = await userManager.setSourcePermission(email, source, read, write);
      }

      res.json({});
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get user
   */
  router.get('/:id', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      if (!currentUser.admin) {
        throw new Errors.Unauthorized();
      }

      const userManager = new User(res.locals.workspace);
      const sourceManager = new Source(currentUser);
      const viewManager = new View(currentUser);

      let user = {
        email: '',
        name: '',
        admin: false,
        sources: {},
        views: {}
      };

      if (ObjectId.isValid(req.params.id)) {
        user = await userManager.getUserById(req.params.id, true);
      }

      // TODO with a combined query:
      let sources = (
        await sourceManager.listSources({
          limit: -1
        })
      ).results.map((s) => {
        return {
          _id: s._id,
          name: s.name,
          submissionKey: s.submissionKey,
          read: user.sources[s._id] ? user.sources[s._id].read : false,
          write: user.sources[s._id] ? user.sources[s._id].write : false
        };
      });

      // let userSources = sources.results.filter((s) => {
      //   return user.sources[s._id] && user.sources[s._id].read;
      // });

      sources.sort((a, b) => {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      let views = (
        await viewManager.listViews({
          limit: -1
        })
      ).results.map((v) => {
        return {
          _id: v._id,
          name: v.name,
          read: user.views[v._id] ? user.views[v._id].read : false,
          write: user.views[v._id] ? user.views[v._id].write : false
        };
      });

      views.sort((a, b) => {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });

      res.json({
        user,
        sources,
        views
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Update user.
   */
  router.post('/', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      if (!currentUser.admin) {
        throw new Errors.Unauthorized();
      }

      const userManager = new User(res.locals.workspace);
      let email = req.body.email;
      if (!emailValidator(email)) {
        throw new Errors.BadRequest('Invalid email');
      }

      let name = req.body.name ? req.body.name.trim() : null;
      if (!name || name.length === 0 || name.length > 100) {
        throw new Errors.BadRequest('Invalid name');
      }

      let forms = req.body.forms;
      if (!forms) {
        forms = {};
      }

      let existingUser = await userManager.getUser(email, true);
      if (existingUser) {
        if (!req.body._id) {
          throw new Errors.BadRequest(`${email} already exists. Edit that user instead.`);
        } else if (!existingUser._id.equals(new ObjectId(req.body._id))) {
          throw new Errors.BadRequest(`${email} already exists. Edit that user instead.`);
        }
      }

      let updated = await userManager.addOrUpdateUser(
        {
          _id: req.body._id,
          email,
          name,
          admin: req.body.admin === true,
          deleted: req.body.deleted === true,
          sources: req.body.sources,
          views: req.body.views
        },
        res.locals.user._id
      );

      const auditManager = new Audit(getCurrentUser(res));
      auditManager.logUserEdit(updated, existingUser);

      return res.render('admin/_user', { user: updated });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Update user column preferences.
   */
  router.post('/pref/:originType/:originId', async (req, res, next) => {
    try {
      let currentUser = getCurrentUser(res);
      const userManager = new User(res.locals.workspace);
      let originType = req.params.originType;
      let originId = req.params.originId;
      if (!originId || !originType) {
        throw new Errors.BadRequest('Invalid params');
      }

      let prefs = req.body;
      if (!prefs || typeof prefs !== 'object') {
        throw new Errors.BadRequest('Invalid params');
      }

      prefs = await userManager.updatePrefs(currentUser, originType, originId, prefs);
      res.json({ prefs });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

