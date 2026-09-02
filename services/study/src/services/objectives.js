/**
 * BLOOM-06 — LearningObjective persistence service.
 *
 * Handles versioned upsert (no duplicates) and superseding of removed
 * objectives on course (re-)ingestion.  The unique key per AC is scoped to
 * the document: (documentId, topicId, textHash).  Node is the sole Mongo
 * writer — Python never writes objectives.
 */

const crypto = require('crypto');
const { LearningObjective } = require('../models/index');

// --- helpers -----------------------------------------------------------------

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Flatten every objective carried in the course topics array into a flat
 * list ready for upsert.  Each element has the fields the model expects
 * plus textHash (for the unique index).
 */
function extractObjectives(documentId, topics) {
  if (!Array.isArray(topics)) return [];
  const results = [];
  for (const topic of topics) {
    if (!Array.isArray(topic.subtopics)) continue;
    for (const sub of topic.subtopics) {
      const objs = sub.learning_objectives || [];
      for (const obj of objs) {
        if (!obj || !obj.text) continue;
        results.push({
          documentId,
          objectiveId: obj.objectiveId || '',
          topicId: obj.topicId || topic.id || '',
          knowledgeType: obj.knowledgeType || '',
          bloomLevel: obj.bloomLevel || '',
          verb: obj.verb || '',
          text: obj.text,
          textHash: sha256(obj.text),
          classification: obj.classification || null
        });
      }
    }
  }
  return results;
}

// --- public API --------------------------------------------------------------

/**
 * Persist / supersede objectives for a document (course).
 *
 * Semantics:
 *   - objectives already present for this document (matching topicId +
 *     textHash) are version-bumped in place (no duplicate row).
 *   - objectives not in the incoming set are marked superseded.
 *   - new objectives are inserted at version 1.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.documentId  — the Node Course _id
 * @param {Array}  opts.topics     — the (possibly transformed) course topics
 * @returns {object} stats
 */
async function syncObjectivesForDocument({ userId, documentId, topics }) {
  const incoming = extractObjectives(documentId, topics);
  if (incoming.length === 0) return { inserted: 0, updated: 0, superseded: 0 };

  const incomingKeys = new Set(incoming.map((o) => `${o.topicId}\0${o.textHash}`));

  // 1. Supersede active objectives that are no longer present
  const previouslyActive = await LearningObjective.find({
    documentId,
    isActive: true
  })
    .select('topicId textHash')
    .lean();

  const toSupersede = previouslyActive.filter(
    (p) => !incomingKeys.has(`${p.topicId}\0${p.textHash}`)
  );

  let superseded = 0;
  if (toSupersede.length > 0) {
    const supersedeResult = await LearningObjective.updateMany(
      {
        documentId,
        $or: toSupersede.map((s) => ({
          topicId: s.topicId,
          textHash: s.textHash
        }))
      },
      { $set: { isActive: false, supersededAt: new Date() } }
    );
    superseded = supersedeResult.modifiedCount || 0;
  }

  // 2. Upsert each incoming objective (version bump or insert)
  let inserted = 0;
  let updated = 0;

  const ops = incoming.map((obj) => {
    const filter = { documentId, topicId: obj.topicId, textHash: obj.textHash };
    const existing = previouslyActive.find(
      (p) => p.topicId === obj.topicId && p.textHash === obj.textHash
    );

    if (existing) {
      // version bump
      updated++;
      return {
        updateOne: {
          filter,
          update: {
            $set: {
              userId,
              objectiveId: obj.objectiveId,
              knowledgeType: obj.knowledgeType,
              bloomLevel: obj.bloomLevel,
              verb: obj.verb,
              text: obj.text,
              classification: obj.classification,
              isActive: true,
              supersededAt: null
            },
            $inc: { version: 1 }
          }
        }
      };
    }

    // new objective
    inserted++;
    return {
      updateOne: {
        filter,
        update: {
          $setOnInsert: {
            userId,
            documentId: obj.documentId,
            objectiveId: obj.objectiveId,
            topicId: obj.topicId,
            knowledgeType: obj.knowledgeType,
            bloomLevel: obj.bloomLevel,
            verb: obj.verb,
            text: obj.text,
            textHash: obj.textHash,
            classification: obj.classification,
            version: 1,
            isActive: true
          }
        },
        upsert: true
      }
    };
  });

  await LearningObjective.bulkWrite(ops, { ordered: false });

  return { inserted, updated, superseded };
}

/**
 * Remove all objectives for a document (course deletion).
 *
 * @param {string} documentId — the Node Course _id
 * @returns {number} deleted count
 */
async function deleteObjectivesForDocument(documentId) {
  const result = await LearningObjective.deleteMany({ documentId });
  return result.deletedCount || 0;
}

module.exports = {
  sha256,
  extractObjectives,
  syncObjectivesForDocument,
  deleteObjectivesForDocument
};
