const util = require('util');
const { program } = require('commander');

// Bootstrap App
const { JOBS_USER } = require('../config');

const App = require('../db/app');
const Source = require('../db/source');
const CurrentUser = require('../lib/current-user');

const sync = require('../jobs/odk-sync-submissions');
const syncAttachments = require('../jobs/odk-sync-attachments');

function debug(data) {
  console.log(util.inspect(data, { showHidden: false, depth: null, maxArrayLength: null }));
}

let appManager = new App();

program
  .command('sync')
  .description('Sync a workspace with ODK')
  .argument('<workspace name>')
  .option('-email, --email <Admin Email>')
  .action(async function () {
    let workspaceName = this.args[0];

    let workspace = await appManager.getWorkspace(workspaceName);

    const email = this.opts().email || JOBS_USER;
    let admin = await appManager.getSuperAdmin(email.trim());
    if (!admin) {
      throw new Error('Invalid super admin: ' + email);
    }
    const sourceManager = new Source(new CurrentUser(admin, workspace, true), workspace);
    try {
      await sync(workspace, sourceManager);
    } catch (error) {
      console.error(error);
    }

    App.close();
  });

program
  .command('sync-attachments')
  .description('Sync a workspace with pending ODK attachments')
  .argument('<workspace name>')
  .option('-email, --email <Admin Email>')
  .action(async function () {
    let workspaceName = this.args[0];

    let workspace = await appManager.getWorkspace(workspaceName);

    const email = this.opts().email || JOBS_USER;
    let admin = await appManager.getSuperAdmin(email.trim());
    if (!admin) {
      throw new Error('Invalid super admin: ' + email);
    }
    const sourceManager = new Source(new CurrentUser(admin, workspace, true), workspace);
    try {
      await syncAttachments(workspace, sourceManager);
    } catch (error) {
      console.error(error);
    }

    App.close();
  });

program.parse();

