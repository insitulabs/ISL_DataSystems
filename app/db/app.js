const Base = require('./base');
const Errors = require('../lib/errors');
const emailValidator = require('../lib/email-validator');
const crypto = require('../lib/crypto');

const APP_DB = 'app';
const RESERVED_WORKSPACE_NAMES = ['admin', 'local', 'config', APP_DB];
const WORKSPACES = 'workspaces';

const workspaceSchema = require('./workspace-migrations/20221215-01-initial');

class App extends Base {
  static APP_DB = APP_DB;

  constructor() {
    super(App.APP_DB);
  }

  async listWorkspaces() {
    return await this.collection(WORKSPACES).find({}).toArray();
  }

  async getWorkspace(name) {
    if (!name) {
      throw new Errors.BadRequest('Invalid workspace name.');
    }

    return await this.collection(WORKSPACES).findOne({ name: name });
  }

  async createWorkspace(name) {
    if (!name) {
      throw new Errors.BadRequest('Invalid workspace name.');
    }

    let trimmed = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
    if (!this.isValidName(trimmed)) {
      throw new Errors.BadRequest('Invalid workspace name.');
    }

    let existing = await this.getWorkspace(trimmed);
    if (existing) {
      throw new Errors.BadRequest(`Workspace ${trimmed} already exists`);
    }

    // TODO comeback to.
    let schema = '20221215-01-initial';

    await this.collection(WORKSPACES).insertOne({
      name: trimmed,
      created: new Date(),
      schema
    });

    await this.#createSchema(trimmed, schema);
  }

  isValidName(name) {
    if (!name) {
      return false;
    }

    // MongoDB limitation.
    if (name.length >= 64) {
      return false;
    }

    if (!/^[a-z,0-9-_]+$/.test(name)) {
      return false;
    }

    if (RESERVED_WORKSPACE_NAMES.includes(name)) {
      return false;
    }

    return true;
  }

  async #createSchema(workspace, schema) {
    let mongoClient = await Base.client();
    let db = mongoClient.db(workspace);

    // Redo with migrations.
    await workspaceSchema(db);
  }

  async enableWorkspaceSync(name, type, url, user, password) {
    let workspace = await this.getWorkspace(name);

    if (!type || !url || !user || !password) {
      throw new Errors.BadRequest('Invalid arguments');
    }

    let toPersist = {
      sync: {
        enabled: true,
        type,
        url,
        user,
        password: crypto.encrypt(password)
      }
    };

    const workspaces = this.collection(WORKSPACES);
    await workspaces.updateOne(
      { _id: workspace._id },
      {
        $set: toPersist
      }
    );
    return await this.getWorkspace(name);
  }

  async disableWorkspaceSync(name) {
    let workspace = await this.getWorkspace(name);

    let toPersist = {
      sync: {
        enabled: false
      }
    };

    const workspaces = this.collection(WORKSPACES);
    await workspaces.updateOne(
      { _id: workspace._id },
      {
        $set: toPersist
      }
    );
    return await this.getWorkspace(name);
  }

  /**
   * Get a super admin by email or user object.
   * @param {object || string} user
   * @return {object}
   */
  async getSuperAdmin(user) {
    let email = user;
    if (user && user.email) {
      email = user.email;
    }

    if (!email) {
      throw new Errors.BadRequest('Invalid email');
    }

    let users = this.collection('users');
    return await users.findOne({ email: email });
  }

  /**
   * Is the user object or email string a super admin?
   * @param {object || string} user
   * @return {boolean}
   */
  async isSuperAdmin(user) {
    let admin = await this.getSuperAdmin(user);
    return admin ? true : false;
  }

  /**
   * Add a super admin to the system.
   * @param {string} email
   * @param {string} name
   */
  async addSuperAdmin(email, name) {
    if (!emailValidator(email)) {
      throw new Errors.BadRequest('Invalid email');
    }

    if (!name) {
      name = email;
    }

    if (!(await this.isSuperAdmin(email))) {
      await this.collection('users').insertOne({
        email: email,
        name: name,
        admin: true,
        modified: new Date()
      });
    }
  }

  /**
   * Remove a super admin from the system.
   * @param {string} email
   */
  async removeSuperAdmin(email) {
    if (!emailValidator(email)) {
      throw new Errors.BadRequest('Invalid email');
    }

    if (await this.isSuperAdmin(email)) {
      await this.collection('users').deleteOne({ email: email });
    }
  }
}

module.exports = App;

