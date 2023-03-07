const Base = require('./base');
const Errors = require('../lib/errors');
const emailValidator = require('../lib/email-validator');
const crypto = require('../lib/crypto');

const APP_DB = 'app';
const RESERVED_WORKSPACE_NAMES = ['admin', 'local', 'config', APP_DB];
const WORKSPACES = 'workspaces';
const USERS = 'users';

const workspaceSchema = require('./workspace-migrations/20221215-01-initial');
const { ObjectId } = require('mongodb');

class App extends Base {
  static APP_DB = APP_DB;

  constructor() {
    super({
      name: 'App System',
      dbName: App.APP_DB
    });
  }

  async listWorkspaces(options = {}) {
    let sort = {};
    if (options.sort) {
      sort[options.sort] = options.order === 'asc' ? 1 : -1;
    } else {
      sort['name'] = 1;
    }

    return await this.collection(WORKSPACES).find({}).sort(sort).toArray();
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

    let dbName = trimmed;
    let existingByDbName = await this.collection(WORKSPACES).find({ dbName: trimmed }).toArray();
    if (existingByDbName.length) {
      dbName += '_' + existingByDbName.length;
    }

    // TODO comeback to.
    let schema = '20221215-01-initial';
    let now = new Date();
    await this.collection(WORKSPACES).insertOne({
      name: trimmed,
      dbName: dbName,
      created: now,
      modified: now,
      schema
    });

    await this.#createSchema(dbName, schema);
  }

  async renameWorkspace(id, name) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('ID is required.');
    }

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
    if (existing && !existing._id.equals(new ObjectId(id))) {
      throw new Errors.BadRequest(`Workspace ${trimmed} already exists`);
    }

    await this.collection(WORKSPACES).updateOne(
      { _id: new ObjectId(id) },
      { $set: { name: trimmed, modified: new Date() } }
    );
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

  async enableWorkspaceSync(name, type, url, user, password, projects) {
    let workspace = await this.getWorkspace(name);
    if (!workspace) {
      throw new Errors.BadRequest('Workspace does note exist');
    }

    if (!type || !url || !user || !password || !projects) {
      throw new Errors.BadRequest('Invalid arguments');
    }

    projects = projects
      .map((id) => parseInt(id))
      .filter((id) => !isNaN(id))
      .filter(Boolean);
    projects.sort((a, b) => a - b);

    let toPersist = {
      sync: {
        enabled: true,
        type,
        url,
        user,
        password: crypto.encrypt(password),
        projects
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

    let users = this.collection(USERS);
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

    if (name) {
      name = name.trim();
    } else {
      name = email;
    }

    if (!(await this.isSuperAdmin(email))) {
      await this.collection(USERS).insertOne({
        email: email,
        name: name,
        admin: true,
        modified: new Date()
      });
    }
  }

  /**
   * Add a super admin to the system.
   * @param {string} email
   * @param {string} name
   */
  async editSuperAdmin(id, email, name) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('ID is required.');
    }

    if (!emailValidator(email)) {
      throw new Errors.BadRequest('Invalid email');
    }

    if (name) {
      name = name.trim();
    } else {
      name = email;
    }

    let existing = await this.collection(USERS).findOne({ _id: new ObjectId(id) });
    if (!existing) {
      throw new Errors.BadRequest('User does not exist.');
    }

    let emailMatch = await this.getSuperAdmin(email);
    if (emailMatch && !emailMatch._id.equals(existing._id)) {
      throw new Errors.BadRequest(`Email address is already in use.`);
    }

    await this.collection(USERS).updateOne(
      { _id: new ObjectId(id) },
      { $set: { email: email, name: name, modified: new Date() } }
    );
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
      await this.collection(USERS).deleteOne({ email: email });
    }
  }

  /**
   * List super admins in the system.
   * @param {object} options Query options: sort, order
   * @return {array}
   */
  async listSuperAdmins(options = {}) {
    let sort = {};
    if (options.sort) {
      sort[options.sort] = options.order === 'asc' ? 1 : -1;
    } else {
      sort['email'] = 1;
    }

    return await this.collection(USERS).find({}).sort(sort).toArray();
  }
}

module.exports = App;

