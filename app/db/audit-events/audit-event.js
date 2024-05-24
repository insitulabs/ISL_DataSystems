const { ObjectId } = require('mongodb');
const { NotImplemented } = require('../../lib/errors');

class AuditEvent {
  /** @type {ObjectId} */
  id;

  /** @type {String} */
  type;

  /** @type {Date} */
  created;

  /** @type {{_id: String, email: String}} */
  user;

  /** @type {Object} */
  data;

  /** @type {boolean} */
  canUndo = false;

  /** @type {boolean} */
  undone;

  /** @type {{_id: String, email: String}} */
  undoneBy;

  /** @type {Date} */
  undoneOn;

  constructor(event) {
    this.id = event._id;
    this.type = event.type;
    this.created = event.created;
    this.user = event.user;
    this.data = event.data;
    this.canUndo = !event.undone;
    this.undone = event.undone || false;
    this.undoneBy = event.undoneBy;
    this.undoneOn = event.undoneOn;
  }

  /**
   * Undo the commit.
   * @param {Source} sourceManager
   * @param {View} viewManager
   * @param {CurrentUser} currentUser
   * @return {Promise} the count of undone records
   */
  async undo(sourceManager, viewManager, currentUser) {
    throw new NotImplemented(`This event type [${this.type}] cannot be undone at this time.`);
  }
}

module.exports = AuditEvent;

