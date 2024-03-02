const { Db } = require('mongodb');

/**
 * Rename sourceId to externalId
 * @param {Db} db
 */
module.exports = async function (db) {
  const submissions = await db.collection('submissions');

  // Delete old index for originId field.
  await submissions.dropIndex('source_1_originId_1');

  // Re-create index for new fieldName
  // Prevent duplicate docs from the same external system (ODK).
  // We don't care about uniqueness if no externalId
  await submissions.createIndex(
    { source: 1, externalId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        externalId: { $exists: true }
      }
    }
  );

  // Rename originId to externalId
  let renameResp = await submissions.updateMany(
    { originId: { $exists: true } },
    { $rename: { originId: 'externalId' } }
  );

  await submissions.createIndex({ originId: 1 });
};

