module.exports = async function (db) {
  // Change submission indexes
  await db.collection('submissions').createIndex({ source: 1 });

  // Prevent duplicate docs from the same origin if they have an originId,
  // We don't care about uniqueness if no originId
  await db.collection('submissions').createIndex(
    { source: 1, originId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        originId: { $exists: true }
      }
    }
  );
  await db.collection('submissions').createIndex({ _attachmentsPresent: 1 });

  // Users email must be unique
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  // Ensure sources are unique
  await db.collection('sources').createIndex({ system: 1, namespace: 1 }, { unique: true });

  // View Entries Indexes
  await db.collection('viewEntries').createIndex({ submission_id: 1 });
};

