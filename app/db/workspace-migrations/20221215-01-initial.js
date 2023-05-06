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

  await db.collection('submissions').createIndex({ source: 1, deleted: 1 });

  // Users email must be unique
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  // Ensure sources are unique
  await db.collection('sources').createIndex({ system: 1, namespace: 1 }, { unique: true });

  // Add indexes for audit performance
  await db.collection('audit').createIndex({ 'user.email': 1 });
  await db.collection('audit').createIndex({ 'user._id': 1 });
  await db.collection('audit').createIndex({ type: 1 });
  await db.collection('audit').createIndex({ created: 1 });
  await db.collection('audit').createIndex({ created: 1, type: 1, 'user.email': 1 });
  await db.collection('audit').createIndex({ type: 1, 'user._id': 1 });
};

