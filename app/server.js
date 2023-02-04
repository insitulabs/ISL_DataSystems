const CONFIG = require('./config');
const DEV_MODE = CONFIG.IS_LOCAL_DEV_ENV;

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { noCacheMiddleware } = require('./lib/route-helpers');

const Agenda = require('agenda');
const crypto = require('./lib/crypto');
const Errors = require('./lib/errors');
const CurrentUser = require('./lib/current-user');
const MongoStore = require('connect-mongo');

const jobSyncOdkSubmissions = require('./jobs/odk-sync-submissions');
const jobSyncOdkAttachments = require('./jobs/odk-sync-attachments');

const app = express();

// Disable "X-Powered-By: Express" header.
app.disable('x-powered-by');

// We run behind a proxy.
app.set('trust proxy', true);

// Allow form body parsing of application/json
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));

const nunjucks = require('nunjucks');
const DATA_VIEWER_PATH = 'data-viewer';
const emailValidator = require('./lib/email-validator');

(async () => {
  const mailer = require('./lib/mailer');
  const AppDB = require('./db/app');
  const User = require('./db/user');
  const Source = require('./db/source');
  const Audit = require('./db/audit').Audit;
  let appManager = new AppDB();

  app.use(
    session({
      store: MongoStore.create({
        clientPromise: AppDB.client(),
        dbName: AppDB.APP_DB
      }),
      name: 'isl-sid',
      secret: CONFIG.SESSION_SECRET,
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        secure: !CONFIG.IS_LOCAL_DEV_ENV,
        maxAge: 1000 * 60 * 60 * 24 * 5,
        sameSite: 'Lax'
        // TODO explore setting domain to reuse session across
      }
    })
  );

  const agenda = new Agenda({
    mongo: appManager.db()
  });

  const shutdown = async function (server, error) {
    const exit = (code) => {
      process.exit(code);
    };

    if (error) {
      try {
        await mailer.sendError(error);
      } catch (e) {
        console.error(e);
      }
    }

    try {
      await agenda.stop();
    } catch (e) {
      console.error(e);
    }

    try {
      AppDB.close();
    } catch (e) {
      console.error(e);
    }

    server.close(exit);
    setTimeout(exit, 500).unref();
  };

  const nunjucksEnv = nunjucks.configure(path.join(__dirname, 'templates'), {
    autoescape: true,
    express: app,
    noCache: CONFIG.IS_LOCAL_DEV_ENV,
    watch: CONFIG.IS_LOCAL_DEV_ENV
  });
  require('./view/filters')(nunjucksEnv);
  app.set('view engine', 'njk');

  const logout = (req, res, next) => {
    req.session.auth = null;
    req.session.save((error) => {
      if (error) {
        next(error);
      } else {
        // regenerate the session, which is good practice to help
        // guard against forms of session fixation
        req.session.regenerate(function (error) {
          if (error) {
            next(err);
          } else {
            res.redirect('/');
          }
        });
      }
    });
  };

  app.get('/status', noCacheMiddleware, (req, res) => {
    res.send('Up and Up');
  });

  app.use('/assets', express.static(path.join(__dirname, 'assets')));

  /**
   * Extract workspace out of host domain.
   */
  app.use((req, res, next) => {
    let subdomain = null;

    let domainParts = req.hostname.split('.');
    if (domainParts.length > 1) {
      subdomain = domainParts[0];
    }

    if (CONFIG.IS_LOCAL_DEV_ENV && !subdomain && CONFIG.DEFAULT_WORKSPACE) {
      subdomain = CONFIG.DEFAULT_WORKSPACE;
    }

    if (!subdomain) {
      return res.redirect(CONFIG.MISSING_WORKSPACE_REDIRECT);
    }

    appManager
      .getWorkspace(subdomain)
      .then((workspace) => {
        if (workspace) {
          res.locals.workspace = workspace.name;
          next();
        } else {
          return next(new Errors.NotFound('Invalid workspace'));
        }
      })
      .catch((err) => {
        next(err);
      });
  });

  app.get('/logout', noCacheMiddleware, (req, res, next) => {
    logout(req, res, next);
  });

  app.get('/hello', noCacheMiddleware, (req, res) => {
    let model = {
      sent: req.query.ok == 1,
      expired: req.query.expired == 1,
      return: req.query.return
    };
    return res.render('hello', model);
  });

  app.post('/hello', noCacheMiddleware, async (req, res, next) => {
    try {
      let email = req?.body?.email.trim();
      if (emailValidator(email)) {
        let min = 100;
        let max = 1000;
        let APP_LINK = (DEV_MODE ? 'http' : 'https') + `://${req.hostname}`;
        if (DEV_MODE) {
          APP_LINK += ':' + CONFIG.PORT;
        }

        const userManager = new User(res.locals.workspace);
        let superAdmin = await appManager.isSuperAdmin(email);
        let user = await userManager.getUser(email);
        setTimeout(() => {
          if (user || superAdmin) {
            mailer.sendLoginEmail(email, APP_LINK, req.body.return).catch((error) => {
              console.error(error);
              mailer.sendError(error);
            });
          }
          return res.redirect('/hello?ok=1');
        }, Math.floor(Math.random() * (max - min + 1) + min));
      } else {
        let helloPath = '/hello';
        if (req?.body?.return) {
          helloPath += '?return=' + encodeURIComponent(req.body.return);
        }
      }
    } catch (error) {
      console.error(error);
      mailer.sendError(error);

      let helloPath = '/hello';
      if (req?.body?.return) {
        helloPath += '?return=' + encodeURIComponent(req.body.return);
      }
      res.redirect(helloPath);
    }
  });

  // Auth Filter
  app.use(async (req, res, next) => {
    if (/^\/(assets\/|favicon\.ico)/.test(req.path)) {
      // Don't bother with static assets.
      return next();
    }

    const userManager = new User(res.locals.workspace);

    // 1. check token
    if (req.query.token) {
      try {
        let decoded = crypto.validateUserToken(req.query.token);
        if (decoded && decoded.email) {
          // Set session cookie and redirect to orig destination or homepage.
          let user = await userManager.getUser(decoded.email);
          let superAdmin = await appManager.getSuperAdmin(decoded.email);
          if (user || superAdmin) {
            req.session.auth = decoded.email;
            req.session.save((sessionError) => {
              if (sessionError) {
                next(sessionError);
              } else {
                res.redirect(decoded.destination || '/');
              }
            });
            return;
          }
        }
      } catch (error) {
        if (error.name === 'TokenExpiredError') {
          return res.redirect('/hello?expired=1');
        }

        return next(error);
      }

      return next(new Error('Invalid Auth Token'));
    } else if (req.session && req.session.auth) {
      try {
        let superAdmin = await appManager.getSuperAdmin(req.session.auth);
        let user = await userManager.getUser(req.session.auth);

        if (user && !user.deleted) {
          res.locals.user = new CurrentUser(
            user,
            res.locals.workspace,
            superAdmin ? 'member' : false
          );
          res.locals.isAdmin = res.locals.user.admin;
          return next();
        } else if (superAdmin) {
          // No workspace user, but we are a super admin
          res.locals.user = new CurrentUser(superAdmin, res.locals.workspace, 'guest');
          res.locals.isAdmin = res.locals.user.admin;
          return next();
        } else {
          // User has a session, but it's not valid, logout.
          return logout(req, res, next);
        }
      } catch (error) {
        return next(error);
      }
    } else {
      let params = '';
      if (req.originalUrl && req.originalUrl !== '/') {
        params = '?return=' + encodeURIComponent(req.originalUrl);
      }

      res.redirect(`/hello${params}`);
    }
  });

  // Audit user page activity.
  app.use((req, res, next) => {
    let path = req.originalUrl;
    if (path.indexOf('/api/') === -1 && path.indexOf('/admin/') === -1) {
      const auditManager = new Audit(res.locals.user);
      auditManager.logUserActivity(path);
    }

    next();
  });

  // Admin routes
  app.use(
    '/admin',
    noCacheMiddleware,
    (req, res, next) => {
      if (res.locals.user && res.locals.user.admin === true) {
        next();
      } else {
        next(new Errors.Unauthorized());
      }
    },
    require('./view/routes/admin')()
  );

  // Redirect home to /data-viewer
  app.get('/', (req, res, next) => {
    res.redirect('/' + DATA_VIEWER_PATH);
  });

  // Register API routes
  app.use('/api/source', noCacheMiddleware, require('./view/routes/api-source')());
  app.use('/api/view', noCacheMiddleware, require('./view/routes/api-view')());
  app.use('/api/user', noCacheMiddleware, require('./view/routes/api-user')());

  // /data-viewer
  app.use(
    `/${DATA_VIEWER_PATH}`,
    noCacheMiddleware,
    require('./view/routes/viewer')({
      nunjucks: nunjucksEnv
    })
  );

  // 404 handler
  app.use((req, res, next) => {
    res.render('error', {
      error: new Error('Not Found'),
      statusCode: 404
    });
  });

  // Error handler
  app.use((error, req, res, next) => {
    if (!error.silent) {
      console.log(error);
    }

    if (!error.statusCode && !error.silent) {
      mailer.sendError(error, {
        url: req.originalUrl,
        workspace: res.locals.workspace,
        user: res.locals.user ? res.locals.user.email : null
      });
    }

    // TODO figure out why this is always returning NULL.
    // if (req.is('json')) {
    if (/json/.test(req.get('content-type')) || /json/.test(req.get('accept'))) {
      res.status(500).json({ message: error.message });
    } else {
      res.status(error.statusCode || 500);
      res.render('error', {
        error: error,
        statusCode: error.statusCode || 500
      });
    }
  });

  const server = app.listen(CONFIG.PORT);
  console.log(`Server running at http://localhost:${CONFIG.PORT}`);

  process.on('SIGTERM', () => {
    shutdown(server);
  });
  process.on('SIGINT', () => {
    shutdown(server);
  });

  process.on('uncaughtException', (error) => {
    shutdown(server, error);
  });

  process.on('unhandledRejection', (error, promise) => {
    console.error('Unhandled rejection at ', promise, `reason: ${error.message}`);
    shutdown(server, error);
  });

  if (CONFIG.JOBS_ENABLED && CONFIG.JOBS_USER) {
    try {
      let jobsUser = await appManager.getSuperAdmin(CONFIG.JOBS_USER);
      if (jobsUser) {
        console.log('Jobs enabled for user: ' + CONFIG.JOBS_USER);
        agenda.on('fail', (err, job) => {
          let jobError = `Job ${job.attrs.name} failed with error: ${err.message}`;
          console.error(jobError);
          mailer.sendError(jobError);
        });

        agenda.define('ODK Sync Submissions', async (job) => {
          try {
            let workspaces = await appManager.listWorkspaces();
            workspaces = workspaces.filter((w) => {
              return w.sync && w.sync.enabled && w.sync.type === 'ODK';
            });

            for (let workspace of workspaces) {
              try {
                let sourceManager = new Source(
                  new CurrentUser(jobsUser, workspace.name, true),
                  workspace.name
                );
                await jobSyncOdkSubmissions(workspace, sourceManager);
              } catch (error) {
                console.error(error);
                mailer.sendError(error, {
                  job: 'ODK Sync Submissions',
                  workspace: workspace.name
                });
              }
            }
          } catch (error) {
            console.error(error);
            mailer.sendError(error, {
              job: 'ODK Sync Submissions'
            });
          }
        });

        agenda.define('ODK Sync Attachments', async (job) => {
          try {
            let workspaces = await appManager.listWorkspaces();
            workspaces = workspaces.filter((w) => {
              return w.sync && w.sync.enabled && w.sync.type === 'ODK';
            });

            for (let workspace of workspaces) {
              try {
                let sourceManager = new Source(
                  new CurrentUser(jobsUser, workspace.name, true),
                  workspace.name
                );
                await jobSyncOdkAttachments(workspace, sourceManager);
              } catch (error) {
                console.error(error);
                mailer.sendError(error, {
                  job: 'ODK Sync Attachments',
                  workspace: workspace.name
                });
              }
            }
          } catch (error) {
            console.error(error);
            mailer.sendError(error, {
              job: 'ODK Sync Attachments'
            });
          }
        });

        await agenda.start();

        await agenda.every('5 minutes', 'ODK Sync Submissions');
        await agenda.every('6 minutes', 'ODK Sync Attachments');
      } else {
        console.log('Invalid jobs user. Jobs will be disabled: ' + CONFIG.JOBS_USER);
      }
    } catch (error) {
      shutdown(server, error);
    }
  } else {
    console.log('Jobs disabled');
  }
})();

