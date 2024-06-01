const { Db, ObjectId } = require('mongodb');

/**
 * Convert originId from String to ObjectId.
 * @param {Db} db
 */
module.exports = async function (db) {
  const submissions = await db.collection('submissions');
  let withOriginId = await submissions.find({ originId: { $exists: true } }).toArray();

  let updated = 0;
  for (let submission of withOriginId) {
    if (typeof submission.originId === 'string') {
      if (ObjectId.isValid(submission.originId)) {
        let toUpdate = {};
        toUpdate.originId = new ObjectId(submission.originId);
        await submissions.updateOne(
          { _id: submission._id },
          {
            $set: toUpdate
          }
        );
        updated++;
      } else {
        console.log('Bad data', submission._id, submission.originId);
      }
    }
  }

  console.log(`Found ${withOriginId.length}. Updated: ${updated}`);
};

