const express = require('express');
const mailer = require('../../lib/mailer');
const User = require('../../db/user');
const Audit = require('../../db/audit').Audit;
const { getCurrentUser } = require('../../lib/route-helpers');
const paginate = require('../paginate');

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

      let sortLinks = ['email', 'name', 'admin', 'modified', 'lastActivity'].reduce(
        (links, col) => {
          let url = '?sort=' + col;
          if (sort === col && order === 'asc') {
            url += '&order=' + 'desc';
          }
          links[col] = url;
          return links;
        },
        {}
      );

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

  router.get('/audit', async (req, res, next) => {
    try {
      let auditManager = new Audit(getCurrentUser(res));
      const pagePath = `${req.baseUrl}${req.path}`;

      let offset = 0;
      if (req.query.offset) {
        offset = parseInt(req.query.offset);
      }

      let limit = 10;
      if (req.query.limit) {
        limit = parseInt(req.query.limit);
        if (isNaN(limit) || limit < 1 || limit > 1000) {
          limit = 10;
        }
      }

      let sort = req.query.sort || 'created';
      let order = req.query.order || 'asc';

      // Default created to desc order
      if (sort === 'created' && !req.query.order) {
        order = 'desc';
      }

      let queryResponse = await auditManager.listEvents({
        sort,
        order
      });

      let currentPage = Math.floor(offset / limit) + 1;
      let pagination = paginate(queryResponse.totalResults, currentPage, limit, 10);

      let sortLinks = ['created', 'email', 'type'].reduce((links, col) => {
        let url = '?sort=' + col;
        if (sort === col && order === 'asc') {
          url += '&order=' + 'desc';
        } else if (sort === col && order === 'desc') {
          url += '&order=' + 'asc';
        }
        links[col] = url;
        return links;
      }, {});

      let model = {
        pagePath,
        pagination,
        results: queryResponse.results,
        sort,
        order,
        sortLinks
      };
      return res.render('admin/audit', model);
    } catch (error) {
      mailer.sendError(error, {
        originalUrl: req.originalUrl
      });
      next(error);
    }
  });

  return router;
};

