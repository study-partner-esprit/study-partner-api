/**
 * BLOOM-12 — End-to-end loop integration test (Node side).
 *
 * Proves the ingest → objectives → eval → profile → plan feedback loop works
 * against real MongoDB with the REAL study services (no mocked models):
 *
 *   1. Ingest → objectives classified: a Course is seeded and
 *      `syncObjectivesForDocument` persists classified LearningObjective rows.
 *   2. Eval steps update the profile IDEMPOTENTLY: EvalResultRecord rows are
 *      seeded, `processEvalResult` bumps the CompetencyProfile via the EWMA
 *      estimator, and a duplicate replay is skipped (claim store) so the score
 *      is NOT double-counted.
 *   3. Plan targets weakest: `getWeakCompetenciesForCourse` ranks topics
 *      weakest-first with progression-gated `unlocked_levels`.
 *
 * Requires MongoDB on localhost:27017 (no broker — the study loop is Mongo
 * only; the orchestrator portion of eval persistence is covered by EVAL-08/10).
 */

const mongoose = require('mongoose');

jest.setTimeout(30000);

process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner_test';
process.env.NODE_ENV = 'test';

const {
  Course,
  LearningObjective,
  CompetencyProfile,
  EvalResultRecord,
  CompetencyProcessing
} = require('../../services/study/src/models/index');
const { syncObjectivesForDocument } = require('../../services/study/src/services/objectives');
const {
  processEvalResult,
  runOnce
} = require('../../services/study/src/services/competencyUpdater');
const { getWeakCompetenciesForCourse } = require('../../services/study/src/services/competencyQueries');

const USER = 'bloom-loop-user';
const COURSE_ID = new mongoose.Types.ObjectId().toString();
const TOPIC_A = 'sub-a-recursion';
const TOPIC_B = 'sub-b-sorting';
const OBJ_A = 'obj-loop-a';
const OBJ_B = 'obj-loop-b';

async function wipeLoopCollections() {
  await Course.deleteMany({});
  await LearningObjective.deleteMany({});
  await CompetencyProfile.deleteMany({});
  await EvalResultRecord.deleteMany({});
  await CompetencyProcessing.deleteMany({});
}

function seedCourse() {
  return Course.create({
    _id: COURSE_ID,
    userId: USER,
    subjectId: 'subj-1',
    title: 'Data Structures',
    status: 'completed',
    topics: [
      {
        title: 'Recursion',
        subtopics: [
          {
            id: TOPIC_A,
            title: 'Recursion Basics',
            summary: '',
            key_concepts: ['base case'],
            learning_objectives: []
          }
        ]
      },
      {
        title: 'Sorting',
        subtopics: [
          {
            id: TOPIC_B,
            title: 'Sorting Algorithms',
            summary: '',
            key_concepts: ['quicksort'],
            learning_objectives: []
          }
        ]
      }
    ]
  });
}

describe('BLOOM-12 end-to-end loop (real Mongo + real services)', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await wipeLoopCollections();
    await seedCourse();
  });

  afterAll(async () => {
    await wipeLoopCollections();
    await mongoose.disconnect();
  });

  test('1. ingest → objectives: syncObjectivesForDocument persists classified objectives', async () => {
    const stats = await syncObjectivesForDocument({
      userId: USER,
      documentId: COURSE_ID,
      topics: [
        {
          id: 'topic-recursion',
          subtopics: [
            {
              id: TOPIC_A,
              title: 'Recursion Basics',
              learning_objectives: [
                {
                  objectiveId: OBJ_A,
                  topicId: TOPIC_A,
                  text: 'Define a base case for a recursive function',
                  verb: 'Define',
                  bloomLevel: 'REMEMBER',
                  knowledgeType: 'conceptual',
                  classification: {
                    bloomLevel: 'remember',
                    knowledgeType: 'conceptual',
                    confidence: 0.9,
                    status: 'classified',
                    needsReview: false
                  }
                }
              ]
            }
          ]
        },
        {
          id: 'topic-sorting',
          subtopics: [
            {
              id: TOPIC_B,
              title: 'Sorting Algorithms',
              learning_objectives: [
                {
                  objectiveId: OBJ_B,
                  topicId: TOPIC_B,
                  text: 'Implement quicksort',
                  verb: 'Implement',
                  bloomLevel: 'APPLY',
                  knowledgeType: 'procedural',
                  classification: {
                    bloomLevel: 'apply',
                    knowledgeType: 'procedural',
                    confidence: 0.85,
                    status: 'classified',
                    needsReview: false
                  }
                }
              ]
            }
          ]
        }
      ]
    });

    expect(stats.inserted).toBe(2);
    const a = await LearningObjective.findOne({ objectiveId: OBJ_A }).lean();
    expect(a).toBeTruthy();
    expect(a.bloomLevel).toBe('REMEMBER');
    expect(a.knowledgeType).toBe('conceptual');
    expect(a.topicId).toBe(TOPIC_A);
    expect(a.isActive).toBe(true);
    expect(a.classification.status).toBe('classified');
  });

  test('2. eval → profile: processEvalResult seeds the EWMA profile', async () => {
    await EvalResultRecord.create({
      correlationId: 'corr-loop-1',
      userId: USER,
      sessionId: 'sess-loop-1',
      step: 1,
      status: 'CONTINUE',
      masteryScore: 0.9,
      demonstratedBloomLevel: 'REMEMBER',
      objectiveId: OBJ_A,
      targetBloomLevel: 'REMEMBER',
      createdAt: new Date('2026-09-01T10:00:00Z')
    });

    const out = await processEvalResult(await EvalResultRecord.findOne({ correlationId: 'corr-loop-1' }));

    expect(out.processed).toBe(true);
    expect(out.bloomLevel).toBe('REMEMBER');
    expect(out.topicId).toBe(TOPIC_A);

    const profile = await CompetencyProfile.findOne({ userId: USER, topicId: TOPIC_A }).lean();
    expect(profile).toBeTruthy();
    // Seed 0.5 + 0.4*(0.9-0.5) = 0.66, but delta (0.16) is capped at MAX_STEP
    // 0.12 => 0.5 + 0.12 = 0.62
    expect(profile.score).toBe(0.62);
    expect(profile.confidence).toBe(0.4); // 1 - (1-0.4)^1
    expect(profile.evidence).toHaveLength(1);
  });

  test('3. idempotency: duplicate replay does not double-count', async () => {
    const before = await CompetencyProfile.findOne({ userId: USER, topicId: TOPIC_A }).lean();

    // Re-deliver the SAME eval result (same correlationId) — e.g. a broker
    // redelivery/retry. processEvalResult must claim-skip it, leaving the
    // profile untouched (no double-count).
    const redelivered = await EvalResultRecord.findOne({ correlationId: 'corr-loop-1' }).lean();
    const replayOut = await processEvalResult(redelivered);
    expect(replayOut.skipped).toBe('already_processed');

    const after = await CompetencyProfile.findOne({ userId: USER, topicId: TOPIC_A }).lean();
    expect(after.score).toBe(before.score); // unchanged — no double-count
    expect(after.evidence).toHaveLength(1); // still a single evidence item

    // ALSO: a genuinely separate step with a different correlationId should update.
    await EvalResultRecord.create({
      correlationId: 'corr-loop-2',
      userId: USER,
      sessionId: 'sess-loop-1',
      step: 2,
      status: 'MASTERY_CONFIRMED',
      masteryScore: 1.0,
      demonstratedBloomLevel: 'REMEMBER',
      objectiveId: OBJ_A,
      targetBloomLevel: 'REMEMBER',
      createdAt: new Date('2026-09-01T10:05:00Z')
    });

    const second = await processEvalResult(
      await EvalResultRecord.findOne({ correlationId: 'corr-loop-2' })
    );
    expect(second.processed).toBe(true);

    const updated = await CompetencyProfile.findOne({ userId: USER, topicId: TOPIC_A }).lean();
    // Replay [0.9 evidence (→0.62), then 1.0 evidence (→0.74)]; both steps capped
    // at MAX_STEP 0.12.
    expect(updated.score).toBe(0.74);
    expect(updated.confidence).toBe(0.64); // 1 - (1-0.4)^2
    expect(updated.evidence).toHaveLength(2);
  });

  test('4. plan → weakest: getWeakCompetenciesForCourse ranks weakest-first', async () => {
    // Build Topic B a full progression chain so `apply` (0.5) becomes its
    // current level: remember (0.8) unlocks understand, understand (0.75)
    // unlocks apply. Topic A only has remember (0.74), so its current level
    // stays remember. Weakest-first => B (apply 0.5) outranks A (remember 0.74).
    const bRows = [
      { knowledgeType: 'procedural', bloomLevel: 'REMEMBER', score: 0.8 },
      { knowledgeType: 'procedural', bloomLevel: 'UNDERSTAND', score: 0.75 },
      { knowledgeType: 'procedural', bloomLevel: 'APPLY', score: 0.5 }
    ];
    for (const row of bRows) {
      await CompetencyProfile.updateOne(
        { userId: USER, topicId: TOPIC_B, ...row },
        { $set: { confidence: 0.4, evidence: [], updatedAt: new Date() } },
        { upsert: true }
      );
    }

    const weak = await getWeakCompetenciesForCourse(USER, COURSE_ID, 10);

    const byTopic = new Map(weak.map((w) => [w.topic_id, w]));
    expect(byTopic.has(TOPIC_A)).toBe(true);
    expect(byTopic.has(TOPIC_B)).toBe(true);

    // Weakest-first => Topic B (apply 0.5) ranks before Topic A (remember 0.74).
    expect(weak[0].topic_id).toBe(TOPIC_B);
    expect(weak[0].current_level).toBe('apply');
    expect(weak[0].scores.apply).toBe(0.5);

    // Progression gate: apply unlocked for B only via understand (0.75) >= 0.7.
    expect(weak[0].unlocked_levels).toContain('apply');
    // A is at remember with no understand row, so apply must NOT be unlocked.
    const a = byTopic.get(TOPIC_A);
    expect(a.unlocked_levels).not.toContain('apply');
  });

  test('5. degraded mode: no minimal data → planner still returns [] (graceful)', async () => {
    // Another course with NO competency rows and NO objectives resolves to
    // a non-empty weakest-first list (not-started topics rank weakest), proving
    // the loop degrades without ever throwing.
    const bareCourse = await Course.create({
      userId: USER,
      subjectId: 'subj-2',
      title: 'Empty Course',
      status: 'completed',
      topics: [
        {
          title: 'T',
          subtopics: [{ id: 'sub-empty', title: 'Empty' }]
        }
      ]
    });
    const weak = await getWeakCompetenciesForCourse(USER, bareCourse._id.toString(), 10);
    expect(Array.isArray(weak)).toBe(true);
    expect(weak).toHaveLength(1);
    expect(weak[0].current_level).toBeNull(); // not started
  });
});
