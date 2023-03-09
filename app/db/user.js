const { ObjectId } = require('mongodb');
const Base = require('./base');
const Errors = require('../lib/errors');
const emailValidator = require('../lib/email-validator');

const USERS = 'users';

class User extends Base {
  /**
   * @param {object} workspace
   *
   */
  constructor(workspace) {
    if (!workspace) {
      throw new Errors.BadRequest('Workspace is required');
    }

    super(workspace);
  }

  /**
   * List the workspace users.
   * @param {boolean} includeDeleted
   * @param {object} options Query options: sort, order, _id
   * @return {array[object]} Users
   */
  async listUsers(includeDeleted = false, options = {}) {
    const col = this.collection(USERS);
    let query = {};
    if (!includeDeleted) {
      query.deleted = { $ne: true };
    }

    if (options._id) {
      query._id = typeof options._id === 'string' ? new ObjectId(options._id) : options._id;
    }

    let sort = {};
    if (options.sort) {
      sort[options.sort] = options.order === 'asc' ? 1 : -1;
    } else {
      sort['email'] = 1;
    }

    let pipeline = [];
    if (Object.keys(query).length) {
      pipeline.push({ $match: query });
    }

    // Join lastActivity data
    pipeline.push({
      $lookup: {
        from: 'audit',
        localField: '_id',
        foreignField: 'user._id',
        as: 'recentActivity',
        pipeline: [
          {
            $match: {
              type: 'user-activity'
            }
          },
          {
            $sort: {
              _id: -1
            }
          },
          {
            $limit: 1
          },
          {
            $project: {
              _id: 0,
              lastActivity: '$created'
            }
          }
        ]
      }
    });
    pipeline.push({
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            '$$ROOT',
            {
              $arrayElemAt: ['$recentActivity', 0]
            }
          ]
        }
      }
    });

    pipeline.push({
      $unset: 'recentActivity'
    });

    pipeline.push({ $sort: sort });

    return col.aggregate(pipeline).toArray();
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

    let result = await col.findOneAndUpdate(query, update, {
      upsert: true,
      returnDocument: 'after'
    });

    // Query the single user again to join audit info
    let updatedUsers = await this.listUsers(true, {
      _id: result.value._id
    });
    return updatedUsers[0];
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

  /**
   * Remove the source permissions for all users.
   * @param {object} source
   */
  async removeSourceFromUsers(source) {
    if (!source) {
      throw new Errors.BadRequest('Invalid source');
    }

    const users = this.collection(USERS);
    let $unset = {};
    $unset['sources.' + source._id] = 1;
    await users.updateMany({}, { $unset: $unset });
  }

  /**
   * Remove the view permissions for all users.
   * @param {object} view
   */
  async removeViewFromUsers(view) {
    if (!view) {
      throw new Errors.BadRequest('Invalid view');
    }

    const users = this.collection(USERS);
    let $unset = {};
    $unset['views.' + view._id] = 1;
    await users.updateMany({}, { $unset: $unset });
  }

  /**
   * Update the source/view preferences for a given user. User must belong to workspace.
   * @param {CurrentUser} user
   * @param {string} originType
   * @param {string} originId
   * @param {object} prefs
   * @return {object} saved prefs
   */
  async updatePrefs(user, originType, originId, prefs) {
    if (!user || !ObjectId.isValid(user._id)) {
      throw new Errors.BadRequest('Invalid user');
    }

    if (!/^view|source$/.test(originType)) {
      throw new Errors.BadRequest('Invalid origin type');
    }

    if (!originId || !ObjectId.isValid(originId)) {
      throw new Errors.BadRequest('Invalid originId');
    }

    if (!prefs) {
      throw new Errors.BadRequest('Invalid prefs');
    }

    const users = this.collection(USERS);
    let existingUser = await this.getUserById(user._id);
    if (!existingUser) {
      if (user.isSuperAdmin) {
        // Super admins who don't have local account, just ignore.
        return prefs;
      }
      throw new Errors.BadRequest('Invalid user');
    }

    let key = `${originType}_${originId}`;
    let userPrefs = existingUser.userPrefs;
    if (!userPrefs) {
      userPrefs = {};
    }
    userPrefs[key] = prefs;
    await users.updateOne({ _id: user._id }, { $set: { prefs: userPrefs } });

    return prefs;
  }
}

module.exports = User;

