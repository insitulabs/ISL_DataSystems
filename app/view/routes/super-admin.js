const express = require('express');
const App = require('../../db/app');
const Errors = require('../../lib/errors');

module.exports = function (opts) {
  const router = express.Router();

  /**
   * Base URL redirect.
   */
  router.get('/', async (req, res, next) => {
    res.redirect(req.baseUrl + '/workspaces');
  });

  /**
   * List Super Admins
   */
  router.get('/users', async (req, res, next) => {
    try {
      let appManager = new App();
      const pagePath = `${req.baseUrl}${req.path}`;

      let sort = req.query.sort || 'email';
      let order = req.query.order || 'asc';

      let users = await appManager.listSuperAdmins({
        sort,
        order
      });

      let sortLinks = ['email', 'name', 'modified'].reduce((links, col) => {
        let url = '?sort=' + col;
        if (sort === col && order === 'asc') {
          url += '&order=' + 'desc';
        }
        links[col] = url;
        return links;
      }, {});

      let model = {
        pagePath,
        users,
        sort,
        order,
        sortLinks,
        pageTitle: 'Super Admins'
      };
      return res.render('super-admin/users', model);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Create or Update Super Admin
   */
  router.post('/api/user', async (req, res, next) => {
    try {
      let id = req.body.id;
      let email = req.body.email;
      let name = req.body.name;
      let appManager = new App();

      if (id) {
        await appManager.editSuperAdmin(id, email, name);
      } else {
        await appManager.addSuperAdmin(email, name);
      }

      res.send({});
    } catch (error) {
      next(error);
    }
  });

  /**
   * Delete Super Admin
   */
  router.delete('/api/user', async (req, res, next) => {
    try {
      let appManager = new App();
      let email = req.body.email;
      await appManager.removeSuperAdmin(email);
      res.send({});
    } catch (error) {
      next(error);
    }
  });

  /**
   * List Workspaces.
   */
  router.get('/workspaces', async (req, res, next) => {
    try {
      let appManager = new App();
      const pagePath = `${req.baseUrl}${req.path}`;

      let sort = req.query.sort || 'name';
      let order = req.query.order || 'asc';

      let workspaces = await appManager.listWorkspaces({
        sort,
        order
      });

      let sortLinks = ['name', 'created'].reduce((links, col) => {
        let url = '?sort=' + col;
        if (sort === col && order === 'asc') {
          url += '&order=' + 'desc';
        }
        links[col] = url;
        return links;
      }, {});

      let model = {
        pagePath,
        workspaces,
        sort,
        order,
        sortLinks,
        pageTitle: 'Workspaces'
      };
      return res.render('super-admin/workspaces', model);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Create or Update Workspace.
   */
  router.post('/api/workspace', async (req, res, next) => {
    try {
      let id = req.body.id;
      let name = req.body.name;
      let languages = req.body.languages;
      let appManager = new App();

      if (id) {
        await appManager.updateWorkspace(id, name, languages);
      } else {
        await appManager.createWorkspace(name, languages);
      }

      res.send({});
    } catch (error) {
      next(error);
    }
  });

  /**
   * Delete Workspace.
   */
  router.delete('/api/workspace', async (req, res, next) => {
    try {
      // TODO Finish
      let appManager = new App();
      throw new Errors.BadRequest('Not implemented yet.');
    } catch (error) {
      next(error);
    }
  });

  return router;
};

