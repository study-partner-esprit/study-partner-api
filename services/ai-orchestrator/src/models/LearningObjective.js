/**
 * LearningObjective — read-only view (ai-orchestrator) of the learning_objectives
 * collection (F14 / BLOOM-06, written by the study service).
 *
 * EVAL-02b: the eval API resolves an objective's `bloomLevel` + `knowledgeType`
 * here (server-side, Node) so the target is carried into the job payload as
 * evaluation context. The Python evaluator never touches MongoDB, so the load
 * happens on this side before the job is published. No writes are made through
 * this model — the study service owns the collection.
 *
 * Write path: sole writer is services/study (objectives.js). This model is
 * read-only and intentionally exposes only the fields evaluation needs.
 */

const mongoose = require('mongoose');

const learningObjectiveSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    documentId: { type: String, required: true },
    objectiveId: { type: String, required: true },
    topicId: { type: String, required: true },
    knowledgeType: { type: String, required: true },
    bloomLevel: { type: String, required: true },
    verb: { type: String, required: true },
    text: { type: String, required: true },
    isActive: { type: Boolean, default: true }
  },
  {
    collection: 'learning_objectives'
  }
);

// BLOOM-08 / EVAL-02b: an objective is addressed by its objectiveId; we only
// ever consider active (not superseded) objectives for targeting.
learningObjectiveSchema.index({ objectiveId: 1, isActive: 1 });

module.exports =
  mongoose.models.LearningObjective ||
  mongoose.model('LearningObjective', learningObjectiveSchema);