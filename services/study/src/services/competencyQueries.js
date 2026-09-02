/**
 * BLOOM-09 — Competency read service.
 *
 * Read-side aggregation of CompetencyProfile rows for the competency API.
 * The profile is keyed by (userId × topicId × knowledgeType × bloomLevel);
 * the API groups those rows into subject → topic → 6-level view, and exposes
 * topic detail with evidence excerpts + a `needsReview` signal.
 *
 * Subject grouping: the competency `topicId` is a subtopic `id` inside a
 * course topic tree (see objectives.js — topicId = obj.topicId || topic.id).
 * We flatten each user's course topic trees into a `topicId → subject` index
 * to group rows under their subject. Subtopics are matched by id.
 */

const { Subject, Course, CompetencyProfile } = require('../models/index');
const { BLOOM_LEVELS, UNLOCK_THRESHOLD } = require('@study-partner/shared/bloom/taxonomy');

const BLOOM_ORDER = ['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE'];

// A competency "needs review" when its evidence is too thin / low-confidence
// to trust (e.g. a single weak observation). Internal signal; instructor-only
// by convention — not shown to students.
const NEEDS_REVIEW_MIN_CONFIDENCE = 0.4;

// Map stored upper-case bloom levels (incl. British 'ANALYSE') onto the
// lowercase taxonomy keys the Python planner expects (BLOOM-10).
const BLOOM_LEVEL_TO_KEY = {
  REMEMBER: 'remember',
  UNDERSTAND: 'understand',
  APPLY: 'apply',
  ANALYZE: 'analyze',
  ANALYSE: 'analyze',
  EVALUATE: 'evaluate',
  CREATE: 'create'
};

/**
 * Build a topicId → { title, parentTopic, subjectId } index by flattening the
 * user's course topic trees. A course's subtopics carry the `id` used as the
 * competency topicId; each belongs to a course subject.
 *
 * @param {string} userId
 * @returns {Promise<Map<string, object>>}
 */
async function buildTopicIndex(userId) {
  const courses = await Course.find({ userId }).select('subjectId title topics').lean();

  const index = new Map();
  for (const course of courses) {
    const topics = course.topics || [];
    for (const topic of topics) {
      const parentTitle = topic.title || '';
      for (const sub of topic.subtopics || []) {
        if (!sub || !sub.id) continue;
        // courseId disambiguates subtopic ids that recur across courses
        index.set(sub.id, {
          title: sub.title || sub.id,
          parentTopic: parentTitle,
          subjectId: course.subjectId,
          courseId: String(course._id)
        });
      }
    }
  }
  return index;
}

/**
 * Group one level's rows by knowledgeType. Used when ?knowledgeType=breakdown.
 */
function groupKnowledgeTypes(rows) {
  const byType = {};
  for (const row of rows) {
    if (!byType[row.knowledgeType]) byType[row.knowledgeType] = [];
    byType[row.knowledgeType].push({
      score: row.score,
      confidence: row.confidence,
      evidenceCount: (row.evidence || []).length
    });
  }
  return Object.entries(byType).map(([knowledgeType, entries]) => ({
    knowledgeType,
    score: entries.length
      ? Math.round((entries.reduce((s, e) => s + e.score, 0) / entries.length) * 1000) / 1000
      : 0,
    confidence: entries.length
      ? Math.round((entries.reduce((s, e) => s + e.confidence, 0) / entries.length) * 1000) / 1000
      : 0,
    count: entries.length
  }));
}

/**
 * Aggregated competency map grouped by subject → topic → bloom level.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} [opts.subjectId]  — filter to one subject
 * @param {boolean} [opts.knowledgeTypeBreakdown] — also break levels by knowledgeType
 * @returns {Promise<Array>} subject -> topics -> levels
 */
async function getUserCompetencyMap(userId, { subjectId, knowledgeTypeBreakdown = false } = {}) {
  const [profiles, topicIndex] = await Promise.all([
    CompetencyProfile.find({ userId }).lean(),
    buildTopicIndex(userId)
  ]);

  // Group profile rows by topicId, then keep rows for topics that map to a subject
  const topicsByTopicId = {};
  for (const row of profiles) {
    if (!topicsByTopicId[row.topicId]) topicsByTopicId[row.topicId] = [];
    topicsByTopicId[row.topicId].push(row);
  }

  // subjectId -> topicId -> rows, preserving record order on first sighting
  const subjects = new Map(); // subjectId -> { subjectId, topics: Map(topicId -> rows) }

  for (const [topicId, rows] of Object.entries(topicsByTopicId)) {
    const meta = topicIndex.get(topicId);
    if (!meta) continue; // competency without a resolvable course subtopic
    if (subjectId && meta.subjectId !== subjectId) continue;

    if (!subjects.has(meta.subjectId)) {
      subjects.set(meta.subjectId, { subjectId: meta.subjectId, topics: new Map() });
    }
    const subject = subjects.get(meta.subjectId);
    if (!subject.topics.has(topicId)) {
      subject.topics.set(topicId, { ...meta, topicId, rows });
    }
  }

  // Resolve subject names
  const subjectIds = [...subjects.keys()];
  const subjectDocs = subjectIds.length
    ? await Subject.find({ userId, _id: { $in: subjectIds } })
        .select('name')
        .lean()
    : [];
  const nameById = new Map(subjectDocs.map((s) => [String(s._id), s.name]));

  const result = [];
  for (const [sid, subject] of subjects) {
    const topics = [];
    for (const [topicId, topic] of subject.topics) {
      // Build 6-level profile; drop empty levels
      const levelsByBloom = new Map();
      for (const row of topic.rows) {
        if (!levelsByBloom.has(row.bloomLevel)) levelsByBloom.set(row.bloomLevel, []);
        levelsByBloom.get(row.bloomLevel).push(row);
      }

      const levels = BLOOM_ORDER.filter((lvl) => levelsByBloom.has(lvl)).map((lvl) => {
        const levelRows = levelsByBloom.get(lvl);
        const level = {
          bloomLevel: lvl,
          score:
            Math.round((levelRows.reduce((s, r) => s + r.score, 0) / levelRows.length) * 1000) /
            1000,
          confidence:
            Math.round(
              (levelRows.reduce((s, r) => s + r.confidence, 0) / levelRows.length) * 1000
            ) / 1000,
          count: levelRows.length
        };
        if (knowledgeTypeBreakdown) level.knowledgeTypes = groupKnowledgeTypes(levelRows);
        return level;
      });

      topics.push({
        topicId,
        topicName: topic.title,
        parentTopic: topic.parentTopic,
        subjectId: topic.subjectId,
        courseId: topic.courseId,
        levels
      });
    }

    result.push({
      subjectId: sid,
      subjectName: nameById.get(sid) || null,
      topics
    });
  }

  return result;
}

/**
 * Topic detail — every competency profile row for a topic, each with its
 * evidence excerpts and an internal `needsReview` signal.
 *
 * @param {string} userId
 * @param {string} topicId
 * @returns {Promise<object|null>} topic detail, or null when the user has no
 *   competency data for that topic / topic is not in any of their courses.
 */
async function getTopicDetail(userId, topicId) {
  const [profiles, topicIndex] = await Promise.all([
    CompetencyProfile.find({ userId, topicId }).lean(),
    buildTopicIndex(userId)
  ]);

  if (!profiles || profiles.length === 0) return null;

  const meta = topicIndex.get(topicId) || {};
  const competencies = profiles.map((row) => ({
    topicId: row.topicId,
    topicName: meta.title || topicId,
    parentTopic: meta.parentTopic || null,
    subjectId: meta.subjectId || null,
    knowledgeType: row.knowledgeType,
    bloomLevel: row.bloomLevel,
    score: row.score,
    confidence: row.confidence,
    needsReview: row.confidence < NEEDS_REVIEW_MIN_CONFIDENCE,
    evidence: (row.evidence || []).slice(-5).map((e) => ({
      objectiveId: e.objectiveId,
      demonstratedBloomLevel: e.demonstratedBloomLevel,
      masteryScore: e.masteryScore,
      evaluatedAt: e.evaluatedAt,
      correlationId: e.correlationId
    }))
  }));

  return {
    topicId,
    topicName: meta.title || topicId,
    parentTopic: meta.parentTopic || null,
    subjectId: meta.subjectId || null,
    courseId: meta.courseId || null,
    competencies
  };
}

/**
 * Weakest-first competency input for the planner (BLOOM-10).
 *
 * For a given course, collect the user's competency rows scoped to that
 * course's subtopics (topicId = subtopic id), aggregate scores per Bloom
 * level (averaging across knowledge types), compute the progression-gated
 * `unlocked_levels` and the learner's `current_level`, and rank topics by
 * weakness (lowest current-level score first). Returns the top-K in the
 * snake_case shape the Python `study.plan.generate` payload expects.
 *
 * A topic with no competency rows is "not started": current_level = null and
 * scores empty, which the planner treats as weakest. When the user has no
 * rows at all the result is [] (planner degrades gracefully).
 *
 * @param {string} userId
 * @param {string} courseId
 * @param {number} [limit=10] – cap on returned topics (weakest first)
 * @returns {Promise<Array>} [{ topic_id, topic_title, scores, current_level, unlocked_levels }]
 */
async function getWeakCompetenciesForCourse(userId, courseId, limit = 10) {
  const course = await Course.findOne({ _id: courseId, userId }).lean();
  if (!course) return [];

  const titleById = new Map();
  for (const topic of course.topics || []) {
    for (const sub of topic.subtopics || []) {
      if (sub && sub.id) titleById.set(sub.id, sub.title || sub.id);
    }
  }
  const validTopicIds = [...titleById.keys()];
  if (validTopicIds.length === 0) return [];

  const rows = await CompetencyProfile.find({
    userId,
    topicId: { $in: validTopicIds }
  }).lean();

  // Aggregate per topicId: level -> average score across knowledge types
  const buckets = new Map(); // topicId -> { scores: Map(level -> {total,count}) }
  for (const row of rows) {
    const key = BLOOM_LEVEL_TO_KEY[row.bloomLevel];
    if (!key) continue;
    if (!buckets.has(row.topicId)) buckets.set(row.topicId, new Map());
    const scores = buckets.get(row.topicId);
    if (!scores.has(key)) scores.set(key, { total: 0, count: 0 });
    scores.get(key).total += row.score;
    scores.get(key).count += 1;
  }

  const scored = [];
  for (const topicId of validTopicIds) {
    const scoresMap = buckets.get(topicId);
    const scores = {};
    if (scoresMap) {
      for (const [level, { total, count }] of scoresMap) {
        scores[level] = Math.round((total / count) * 1000) / 1000;
      }
    }

    // Progression gate: level N unlocked only when N-1 >= threshold.
    const unlocked = [];
    for (const level of BLOOM_LEVELS) {
      const idx = BLOOM_LEVELS.indexOf(level);
      if (idx === 0) {
        unlocked.push(level);
        continue;
      }
      const prevScore = scores[BLOOM_LEVELS[idx - 1]];
      if (prevScore != null && prevScore >= UNLOCK_THRESHOLD) unlocked.push(level);
    }

    // current_level = highest unlocked level with a score (the level the
    // learner is currently working on), else null (not started).
    let currentLevel = null;
    for (let i = BLOOM_LEVELS.length - 1; i >= 0; i -= 1) {
      const level = BLOOM_LEVELS[i];
      if (unlocked.includes(level) && scores[level] != null) {
        currentLevel = level;
        break;
      }
    }
    if (currentLevel === null && unlocked.length > 0 && scores[BLOOM_LEVELS[0]] != null) {
      currentLevel = BLOOM_LEVELS[0];
    }

    scored.push({
      topic_id: topicId,
      topic_title: titleById.get(topicId),
      scores,
      current_level: currentLevel,
      unlocked_levels: unlocked
    });
  }

  // Weakest-first: sort by the score at the current level ascending; topics
  // without any data (not started) rank weakest of all.
  const sortScore = (wc) => {
    if (wc.current_level == null) return -1;
    return wc.scores[wc.current_level] != null ? wc.scores[wc.current_level] : 1;
  };
  return scored.sort((a, b) => sortScore(a) - sortScore(b)).slice(0, limit);
}

module.exports = {
  BLOOM_ORDER,
  NEEDS_REVIEW_MIN_CONFIDENCE,
  buildTopicIndex,
  groupKnowledgeTypes,
  getUserCompetencyMap,
  getTopicDetail,
  getWeakCompetenciesForCourse
};
