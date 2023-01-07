const { ObjectId } = require('mongodb');
const { Unauthorized, BadRequest } = require('./errors');

const PERMISSIONS = {
  READ: 'read',
  WRITE: 'write'
};

class CurrentUser {
  static PERMISSIONS = {
    SOURCE_CREATE: 'create-source',
    VIEW_CREATE: 'create-view',
    READ: 'read',
    WRITE: 'write'
  };

  constructor(user, workspace, isSuperAdmin = false) {
    if (!user) {
      throw new BadRequest('Invalid user');
    }

    this._id = user._id;
    this.name = user.name;
    this.email = user.email;
    this.admin = user.admin;
    this.permissions = {};
    if (this.admin) {
      this.permissions[CurrentUser.PERMISSIONS.SOURCE_CREATE] = true;
      this.permissions[CurrentUser.PERMISSIONS.VIEW_CREATE] = true;
    }
    this._user = user;
    this.workspace = workspace;
    this.isSuperAdmin = isSuperAdmin;
  }

  sourceIds(asObjectIds = true) {
    return Object.keys(this._user.sources || {}).map((id) => {
      return asObjectIds ? new ObjectId(id) : id;
    });
  }

  viewIds(asObjectIds = true) {
    return Object.keys(this._user.views || {}).map((id) => {
      return asObjectIds ? new ObjectId(id) : id;
    });
  }

  validate(permission) {
    if (!this.permissions[permission]) {
      throw new Unauthorized();
    }
  }

  hasViewPermission(view, permission = CurrentUser.PERMISSIONS.READ) {
    if (this.admin || this.isSuperAdmin) {
      return true;
    }

    let id = this.#getObjectId(view);
    if (id) {
      return !!this._user.views[id] && this._user.views[id][permission] === true;
    }

    return false;
  }

  validateViewPermission(view, permission = CurrentUser.PERMISSIONS.READ) {
    if (!this.hasViewPermission(view, permission)) {
      throw new Unauthorized();
    }

    return true;
  }

  hasSourcePermission(source, permission = CurrentUser.PERMISSIONS.READ) {
    if (this.admin || this.isSuperAdmin) {
      return true;
    }

    let id = this.#getObjectId(source);
    if (id) {
      return !!this._user.sources[id] && this._user.sources[id][permission] === true;
    }

    return false;
  }

  validateSourcePermission(source, permission = PERMISSIONS.READ) {
    if (!this.hasSourcePermission(source, permission)) {
      throw new Unauthorized();
    }

    return true;
  }

  /**
   * Extract an ID out of an object.
   * @param {(ObjectId|Object|String)} obj The object to extract an ID string out of.
   * @return {String}
   */
  #getObjectId(obj) {
    if (obj) {
      if (typeof obj === 'string') {
        return obj;
      }

      if (obj instanceof ObjectId) {
        return obj.toString();
      }

      if (obj._id) {
        return obj._id.toString();
      }
    }

    return null;
  }
}

module.exports = CurrentUser;

