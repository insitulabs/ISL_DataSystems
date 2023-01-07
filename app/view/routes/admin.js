const express = require('express');
const mailer = require('../../lib/mailer');
const User = require('../../db/user');

module.exports = function (opts) {
  const router = express.Router();

  router.get('/users', async (req, res, next) => {
    try {
      let userManager = new User(res.locals.workspace);
      const pagePath = `${req.baseUrl}${req.path}`;
      let includeDeleted = req.query.deleted === 'true';

      let sort = req.query.sort || 'email';
      let order = req.query.order || 'asc';

      let users = await userManager.listUsers(includeDeleted, {
        sort,
        order
      });

      let sortLinks = ['email', 'name', 'admin', 'modified'].reduce((links, col) => {
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
        includeDeleted: includeDeleted,
        sort,
        order,
        sortLinks
      };
      return res.render('admin/users', model);
    } catch (error) {
      mailer.sendError(error, {
        originalUrl: req.originalUrl
      });
      next(error);
    }
  });

  return router;
};

