/**
 * objectiveContext — resolve a learning objective's Bloom context (EVAL-02b).
 *
 * Given an `objectiveId` from an eval request, load the objective's
 * `bloomLevel` + `knowledgeType` from the shared learning_objectives collection
 * (read-only — the study service owns writes). The resolved target is carried
 * into the study.eval.step job payload as evaluation context so the Python
 * evaluator can target that Bloom depth without touching MongoDB.
 *
 * A missing / inactive / superseded objective returns null; the caller treats a
 * present-but-unresolvable objectiveId as a client error (422).
 */

const LearningObjective = require('../models/LearningObjective');

/**
 * @param {string} objectiveId
 * @returns {Promise<{targetBloomLevel: string, knowledgeType: string}|null>}
 */
async function resolveObjectiveContext(objectiveId) {
  if (!objectiveId) return null;
  const objective = await LearningObjective.findOne({
    objectiveId,
    isActive: true
  })
    .select('bloomLevel knowledgeType')
    .lean();
  if (!objective || !objective.bloomLevel) return null;
  return {
    targetBloomLevel: objective.bloomLevel,
    knowledgeType: objective.knowledgeType || null
  };
}

module.exports = { resolveObjectiveContext };