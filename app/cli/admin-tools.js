const { program } = require('commander');

// Bootstrap config for Mongo usage.
const CONFIG = require('../config');
const App = require('../db/app');

program
  .command('add-workspace')
  .description('Create a new workspace')
  .argument('<workspace name>')
  .action(function () {
    let workspace = this.args[0];
    let appManager = new App();
    appManager
      .createWorkspace(workspace)
      .then(() => {
        console.log('Workspace created: ', workspace);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        App.close();
      });
  });

program
  .command('add-super-admin')
  .description('Add super admin to system')
  .requiredOption('-email, --email <Admin Email>')
  .requiredOption('-name, --name <Admin Name>')
  .action(function () {
    const email = this.opts().email.trim();
    const name = this.opts().name.trim();
    let appManager = new App();
    appManager
      .addSuperAdmin(email, name)
      .then(() => {
        console.log('Admin added: ' + email);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        App.close();
      });
  });

program
  .command('remove-super-admin')
  .description('Delete super admin from system')
  .requiredOption('-email, --email <Admin Email>')
  .action(function () {
    const email = this.opts().email.trim();
    let appManager = new App();
    appManager
      .removeSuperAdmin(email)
      .then(() => {
        console.log('Admin removed: ' + email);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        App.close();
      });
  });

program
  .command('enable-odk-sync')
  .description('Enable ODK syncing for a given workspace')
  .argument('<workspace name>')
  .requiredOption('-url, --url <ODK URL>')
  .requiredOption('-projects, --projects <ID,ID>')
  .requiredOption('-email, --email <ODK Email>')
  .requiredOption('-password, --password <ODK Password>')
  .action(function () {
    const workspaceName = this.args[0];
    let options = this.opts();
    const url = options.url.trim();
    let projects = options.projects
      .split(',')
      .map((id) => parseInt(id))
      .filter((id) => !isNaN(id));
    const email = options.email.trim();
    const password = options.password.trim();
    let appManager = new App();
    appManager
      .enableWorkspaceSync(workspaceName, 'ODK', url, email, password, projects)
      .then((workspace) => {
        console.log('Sync enabled for ' + workspace.name);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        App.close();
      });
  });

program
  .command('disable-odk-sync')
  .description('Disable ODK syncing for a given workspace')
  .argument('<workspace name>')
  .action(function () {
    const workspaceName = this.args[0];
    let appManager = new App();
    appManager
      .disableWorkspaceSync(workspaceName)
      .then((workspace) => {
        console.log('Sync disable for ' + workspace.name);
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        App.close();
      });
  });

program.parse();

