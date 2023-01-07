const { ObjectId } = require('mongodb');
const Base = require('./base');
const Errors = require('../lib/errors');
const emailValidator = require('../lib/email-validator');

const USERS = 'users';

class User extends Base {
  /**
   * @param {String} workspace
   */
  constructor(workspace) {
    if (!workspace) {
      throw new Errors.BadRequest('Workspace is required');
    }

    super(workspace);
  }

  async listUsers(includeDeleted = false, options = {}) {
    const col = this.collection(USERS);
    let query = {};
    if (!includeDeleted) {
      query.deleted = { $ne: true };
    }

    let sort = {};
    if (options.sort) {
      sort[options.sort] = options.order === 'asc' ? 1 : -1;
    } else {
      sort[email] = 1;
    }

    return col.find(query).sort(sort).toArray();
  }

  async getUserById(id, includeDeleted = false) {
    if (!id || !ObjectId.isValid(id)) {
      throw new Errors.BadRequest('Invalid user ID param');
    }

    const col = this.collection(USERS);
    let query = { _id: new ObjectId(id) };
    if (!includeDeleted) {
      query.deleted = { $ne: true };
    }
    let user = await col.findOne(query);
    if (user) {
      // Make sure old data is brought inline with new data
      user.views = user.views || {};
      user.sources = user.sources || {};
    }
    return user;
  }

  /**
   * Get user in workspace.
   * @param {string} email
   * @param {boolean} includeDeleted
   * @returns
   */
  async getUser(email, includeDeleted = false) {
    const col = this.collection(USERS);
    let query = { email };
    if (!includeDeleted) {
      query.deleted = { $ne: true };
    }
    let user = await col.findOne(query);
    if (user) {
      // Make sure old data is brought inline with new data
      user.views = user.views || {};
      user.sources = user.sources || {};
    }
    return user;
  }

  async addOrUpdateUser(user, modifiedBy) {
    if (!user || !user.email || !user.name) {
      throw new Errors.BadRequest('Invalid user params');
    }

    if (!emailValidator(user.email)) {
      throw new Errors.BadRequest('Invalid email');
    }

    if (!modifiedBy && !(await this.getUserById(modifiedBy))) {
      throw new Errors.BadRequest('Invalid modifiedBy user param');
    }

    let sources = (user.sources || {})
      .filter((s) => {
        // Only persist items we have read permissions on
        return s.read;
      })
      .reduce((acl, s) => {
        // Ensure booleans
        acl[s._id] = {
          read: s.read ? true : false,
          write: s.write ? true : false
        };
        return acl;
      }, {});

    let views = (user.views || {})
      .filter((v) => {
        // Only persist items we have read permissions on
        return v.read;
      })
      .reduce((acl, v) => {
        // Ensure booleans
        acl[v._id] = {
          read: v.read ? true : false,
          write: v.write ? true : false
        };
        return acl;
      }, {});

    const col = this.collection(USERS);
    const query = user._id ? { _id: new ObjectId(user._id) } : { email: user.email };
    let userToUpdate = {
      email: user.email,
      name: user.name,
      admin: user.admin || false,
      modified: new Date(),
      modifiedBy: new ObjectId(modifiedBy),
      forms: user.forms || {},
      sources,
      views,
      deleted: user.deleted || null
    };

    const update = {
      $set: userToUpdate
    };
    return col.findOneAndUpdate(query, update, { upsert: true, returnDocument: 'after' });
  }

  async listUsersBySource(source, includeDeleted = false) {
    if (!source) {
      throw new Errors.BadRequest('Invalid source');
    }

    const users = this.collection(USERS);
    const query = {};
    let sourceKey = 'sources.' + source._id + '.read';
    query[sourceKey] = true;

    if (!includeDeleted) {
      query.deleted = { $ne: true };
    }

    return users.find(query).sort({ email: 1 }).toArray();
  }

  async setSourcePermission(email, source, read = false, write = false) {
    if (!email) {
      throw new Errors.BadRequest('Invalid user email');
    }
    if (!source) {
      throw new Errors.BadRequest('Invalid source');
    }

    let user = await this.getUser(email);
    if (!user) {
      // TODO what about create on the fly for users who can
      throw new Errors.BadRequest('User not found ');
    }

    let sources = user.sources || {};
    if (!read && !write) {
      delete sources[source._id];
    } else {
      sources[source._id] = {
        // Ensure write permissions also have read permissions.
        read: write ? true : read,
        write: write
      };
    }

    const users = this.collection(USERS);
    await users.updateOne({ _id: user._id }, { $set: { sources: sources } });
    return await this.getUser(email);
  }

  async listUsersByView(view, includeDeleted = false) {
    if (!view) {
      throw new Errors.BadRequest('Invalid view');
    }

    const users = this.collection(USERS);
    const query = {};
    let viewQuery = 'views.' + view._id + '.read';
    query[viewQuery] = true;

    if (!includeDeleted) {
      query.deleted = { $ne: true };
    }

    return users.find(query).sort({ email: 1 }).toArray();
  }
}

module.exports = User;

