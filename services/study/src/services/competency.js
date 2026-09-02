/**
 * BLOOM-07 — CompetencyProfile estimator service.
 *
 * Evidence-weighted EWMA seeded by EVAL's smoothing guard.
 * Each competency key (userId × topicId × knowledgeType × bloomLevel)
 * is updated independently — no cross-level inference.
 *
 * Recency decay: EWMA inherently weights recent evidence more heavily.
 * Each update is score_new = score_prev + α × (observation − score_prev),
 * which is equivalent to exponential decay of older observations with
 * half-life ≈ ln(2) / ln(1/(1−α)) ≈ 1.3 updates for α = 0.4.
 *
 * Per-step delta is capped at MAX_STEP (0.12), matching EVAL's guard.
 */

const { CompetencyProfile } = require('../models/index');

const ALPHA = 0.4;
const MAX_STEP = 0.12;
const MAX_EVIDENCE = 20;

/**
 * Apply a single EWMA update step.
 *
 * @param {number} prevScore   – previous score ∈ [0,1]
 * @param {number} observation – new observation ∈ [0,1]
 * @returns {number} updated score ∈ [0,1], rounded to 3dp
 */
function ewmaStep(prevScore, observation) {
  const raw = prevScore + ALPHA * (observation - prevScore);
  let delta = raw - prevScore;
  delta = Math.max(Math.min(delta, MAX_STEP), -MAX_STEP);
  let score = prevScore + delta;
  score = Math.max(0, Math.min(1, score));
  return Math.round(score * 1000) / 1000;
}

/**
 * Compute confidence from evidence count.
 * Confidence grows logarithmically with evidence, asymptoting to 1.
 * confidence = 1 − (1 − α)^n  (EWMA-style confidence accumulation).
 *
 * @param {number} evidenceCount
 * @returns {number} confidence ∈ [0,1], rounded to 3dp
 */
function computeConfidence(evidenceCount) {
  if (evidenceCount <= 0) return 0;
  const conf = 1 - Math.pow(1 - ALPHA, evidenceCount);
  return Math.round(Math.min(1, conf) * 1000) / 1000;
}

/**
 * Sort evidence by evaluatedAt (oldest first) and replay EWMA to get the
 * canonical score for a given profile key.  Returns { score, confidence }.
 *
 * The EWMA seed is 0.5 (neutral), matching EVAL's `last_valid_score`
 * default.  A fresh profile with no evidence returns { score: 0 } to
 * distinguish "no data" from "neutral".
 *
 * @param {Array} evidence – evidence items (each has masteryScore + evaluatedAt)
 * @returns {{ score: number, confidence: number }}
 */
function replayEvidence(evidence) {
  const sorted = [...evidence]
    .filter((e) => e.masteryScore != null)
    .sort((a, b) => new Date(a.evaluatedAt) - new Date(b.evaluatedAt));

  if (sorted.length === 0) return { score: 0, confidence: 0 };

  // Seed at 0.5 (neutral), matching EVAL's smoothing guard default
  let score = 0.5;
  for (const item of sorted) {
    score = ewmaStep(score, item.masteryScore);
  }
  return { score, confidence: computeConfidence(sorted.length) };
}

/**
 * Update or insert a CompetencyProfile row for one competency key.
 * Evidence is appended (capped at MAX_EVIDENCE), EWMA replayed.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.topicId
 * @param {string} params.knowledgeType
 * @param {string} params.bloomLevel
 * @param {object} params.evidenceItem – new evidence entry
 * @returns {object} updated profile doc
 */
async function upsertProfile({ userId, topicId, knowledgeType, bloomLevel, evidenceItem }) {
  const filter = { userId, topicId, knowledgeType, bloomLevel };

  const existing = await CompetencyProfile.findOne(filter).lean();
  const prevEvidence = existing ? existing.evidence || [] : [];

  // Append new evidence, cap at MAX_EVIDENCE (keep newest)
  const newEvidence = [...prevEvidence, evidenceItem].slice(-MAX_EVIDENCE);

  // Replay EWMA over all evidence
  const { score, confidence } = replayEvidence(newEvidence);

  const update = {
    $set: {
      score,
      confidence,
      evidence: newEvidence,
      updatedAt: new Date()
    }
  };

  return CompetencyProfile.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });
}

/**
 * Subject-level rollup from topic-level rows.
 * Aggregates all competency profiles for a given userId across the
 * topicIds belonging to the specified courses, grouped by bloomLevel.
 *
 * @param {string} userId
 * @param {string[]} topicIds – topic-level keys to aggregate
 * @returns {Array<{ bloomLevel: string, avgScore: number, avgConfidence: number, count: number }>}
 */
async function rollupByTopics(userId, topicIds) {
  if (!topicIds || topicIds.length === 0) return [];

  const rows = await CompetencyProfile.find({
    userId,
    topicId: { $in: topicIds }
  })
    .select('bloomLevel score confidence')
    .lean();

  if (rows.length === 0) return [];

  // Group by bloomLevel
  const groups = {};
  for (const row of rows) {
    if (!groups[row.bloomLevel]) {
      groups[row.bloomLevel] = { total: 0, conf: 0, count: 0 };
    }
    groups[row.bloomLevel].total += row.score;
    groups[row.bloomLevel].conf += row.confidence;
    groups[row.bloomLevel].count += 1;
  }

  return Object.entries(groups)
    .map(([bloomLevel, g]) => ({
      bloomLevel,
      avgScore: Math.round((g.total / g.count) * 1000) / 1000,
      avgConfidence: Math.round((g.conf / g.count) * 1000) / 1000,
      count: g.count
    }))
    .sort((a, b) => a.bloomLevel.localeCompare(b.bloomLevel));
}

module.exports = {
  ALPHA,
  MAX_STEP,
  MAX_EVIDENCE,
  ewmaStep,
  computeConfidence,
  replayEvidence,
  upsertProfile,
  rollupByTopics
};
