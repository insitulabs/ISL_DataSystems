const Base = require('./base');
const Errors = require('../lib/errors');
const CurrentUser = require('../lib/current-user');

const SEQUENCES = 'sequences';

class Sequence extends Base {
  /** @type {CurrentUser} */
  user = null;

  /**
   *
   * @param {CurrentUser} user
   * @param {object} workspace The workspace or default to user's workspace.
   */
  constructor(user, workspace) {
    if (!user) {
      throw new Errors.BadRequest('User is required');
    }

    super(workspace || user.workspace);
    this.user = user;
  }

  /**
   * Get the current sequence for a given field.
   * @param {string} originType The type of origin. 'source' or 'view'.
   * @param {object} origin The source or view.
   * @param {object} field The field.
   * @return {number} The current number in the sequence.
   */
  async getSequence(originType, origin, field) {
    if (!originType || !origin || !field) {
      throw new Errors.BadRequest('Invalid sequence params');
    }

    let name = origin._id.toString() + '_' + field.id;
    const sequences = this.collection(SEQUENCES);
    let sequence = await sequences.findOne({ _id: name });

    return sequence ? sequence.value : 0;
  }

  /**
   * Get the next sequence for a given field.
   * @param {string} originType The type of origin. 'source' or 'view'.
   * @param {object} origin The source or view.
   * @param {object} field The field.
   * @return {number} The next number in the sequence.
   */
  async getNextSequence(originType, origin, field) {
    if (!originType || !origin || !field) {
      throw new Errors.BadRequest('Invalid sequence params');
    }

    let name = origin._id.toString() + '_' + field.id;
    const sequences = this.collection(SEQUENCES);
    let results = await sequences.findOneAndUpdate(
      { _id: name },
      { $set: { originType, originId: origin._id, field: field.id }, $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    return results.value.value;
  }

  /**
   * Set the next sequence for a given field.
   * @param {string} originType The type of origin. 'source' or 'view'.
   * @param {object} origin The source or view.
   * @param {object} field The field.
   * @param {number} count The number to increase the count by. Must be greater than 0.
   * @return {number} The current value of the sequence.
   */
  async incrementSequence(originType, origin, field, count) {
    if (!originType || !origin || !field || !count) {
      throw new Errors.BadRequest('Invalid sequence params');
    }

    let name = origin._id.toString() + '_' + field.id;
    const sequences = this.collection(SEQUENCES);
    let results = await sequences.findOneAndUpdate(
      { _id: name },
      { $set: { originType, originId: origin._id, field: field.id }, $inc: { value: count } },
      { upsert: true, returnDocument: 'after' }
    );

    return results.value.value;
  }
}

module.exports = Sequence;

