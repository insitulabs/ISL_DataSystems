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
    this.admin = user.admin || !!isSuperAdmin;
    this.permissions = {};
    this.prefs = user.prefs || {};
    if (this.admin) {
      this.permissions[CurrentUser.PERMISSIONS.SOURCE_CREATE] = true;
      this.permissions[CurrentUser.PERMISSIONS.VIEW_CREATE] = true;
    }
    this._user = user;
    this.workspace = workspace;
    this.isSuperAdmin = isSuperAdmin === 'guest' || isSuperAdmin === 'member';

    const isGuestSuperAdmin = isSuperAdmin === 'guest';
    if (isGuestSuperAdmin) {
      this.preventAudit = true;
      if (user.prefs && user.prefs[workspace.dbName]) {
        this.prefs = user.prefs[workspace.dbName];
      }
    }
    this.firstName = this.#getFirstName();
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

  /**
   * Does the user have the given permission on the provided view.
   * @param {object} view
   * @param {string} permission
   * @return {boolean}
   */
  hasViewPermission(view, permission = CurrentUser.PERMISSIONS.READ) {
    if (view) {
      if (this.admin || this.isSuperAdmin) {
        return true;
      }

      if (view.permissions && view.permissions[permission] === true) {
        return true;
      }

      let id = this.#getObjectId(view);
      if (id) {
        return !!this._user.views[id] && this._user.views[id][permission] === true;
      }
    }

    return false;
  }

  validateViewPermission(view, permission = CurrentUser.PERMISSIONS.READ) {
    if (!this.hasViewPermission(view, permission)) {
      throw new Unauthorized();
    }

    return true;
  }

  /**
   * Does the user have the given permission on the provided source.
   * @param {object} source
   * @param {string} permission
   * @return {boolean}
   */
  hasSourcePermission(source, permission = CurrentUser.PERMISSIONS.READ) {
    if (source) {
      if (this.admin || this.isSuperAdmin) {
        return true;
      }

      if (source.permissions && source.permissions[permission] === true) {
        return true;
      }

      let id = this.#getObjectId(source);
      if (id) {
        return !!this._user.sources[id] && this._user.sources[id][permission] === true;
      }
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
   * Get user preferences for a source/view.
   * @param {string} type
   * @param {string} id
   * @return {object|null}
   */
  getPrefs(type, id) {
    if (type && id && this.prefs) {
      return this.prefs[`${type}_${id}`];
    }

    return null;
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

  /**
   * Try to extract a first name out of the name field or the beginning of an email.
   * @return {string}
   */
  #getFirstName() {
    // If we have a name and it's not an email address, use it
    if (this.name && this.name.indexOf('@') === -1) {
      return this.name.split(' ')[0];
    }

    if (this.email) {
      return this.email.split('@')[0];
    }

    return this.email;
  }
}

module.exports = CurrentUser;

