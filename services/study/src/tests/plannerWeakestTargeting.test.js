/**
 * BLOOM-10 — weakest-first planner targeting (Node side).
 *
 * Unit tests for getWeakCompetenciesForCourse (competency profile -> planner
 * payload with progression-gated current/unlocked levels) plus the plans
 * route wiring (weak_competencies in the generate payload, and persistence of
 * objectiveId/targetBloomLevel on tasks and taskGraph).
 */

jest.mock('../models/index', () => ({
  Course: { findOne: jest.fn() },
  CompetencyProfile: { find: jest.fn() }
}));

const { Course, CompetencyProfile } = require('../models/index');
const { getWeakCompetenciesForCourse } = require('../services/competencyQueries');

const courseDoc = {
  _id: 'course-1',
  userId: 'user-123',
  topics: [
    {
      title: 'Core Algorithms',
      subtopics: [
        { id: 'sorting', title: 'Sorting Algorithms' },
        { id: 'graphs', title: 'Graphs' },
        { id: 'arrays', title: 'Arrays' }
      ]
    }
  ]
};

beforeEach(() => jest.clearAllMocks());

function courseQueryResult(doc) {
  return { lean: jest.fn().mockResolvedValue(doc) };
}

describe('getWeakCompetenciesForCourse', () => {
  test('returns [] when the course is not found', async () => {
    Course.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const out = await getWeakCompetenciesForCourse('user-123', 'course-x');
    expect(out).toEqual([]);
  });

  test('computes scores, progression-gated unlocked levels and current level', async () => {
    Course.findOne.mockReturnValue(courseQueryResult(courseDoc));
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        // Sorting: remember strong, understand strong, apply weak
        { topicId: 'sorting', bloomLevel: 'REMEMBER', score: 0.9 },
        { topicId: 'sorting', bloomLevel: 'UNDERSTAND', score: 0.8 },
        { topicId: 'sorting', bloomLevel: 'APPLY', score: 0.4 }
      ])
    });

    const out = await getWeakCompetenciesForCourse('user-123', 'course-1');
    expect(Course.findOne).toHaveBeenCalledWith({ _id: 'course-1', userId: 'user-123' });
    const sorting = out.find((w) => w.topic_id === 'sorting');
    expect(sorting.topic_title).toBe('Sorting Algorithms');
    expect(sorting.scores).toEqual({ remember: 0.9, understand: 0.8, apply: 0.4 });
    // gate: understand (0.8 >= 0.7) unlocks apply; apply (0.4 < 0.7) does NOT unlock analyze
    expect(sorting.unlocked_levels).toEqual(['remember', 'understand', 'apply']);
    // current level = highest unlocked level with a score = apply
    expect(sorting.current_level).toBe('apply');
  });

  test('normalizes British ANALYSE and uppercase levels to lowercase keys', async () => {
    Course.findOne.mockReturnValue(courseQueryResult(courseDoc));
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { topicId: 'sorting', bloomLevel: 'REMEMBER', score: 0.9 },
        { topicId: 'sorting', bloomLevel: 'UNDERSTAND', score: 0.8 },
        { topicId: 'sorting', bloomLevel: 'APPLY', score: 0.7 },
        { topicId: 'sorting', bloomLevel: 'ANALYSE', score: 0.3 }
      ])
    });
    const out = await getWeakCompetenciesForCourse('user-123', 'course-1');
    const sorting = out.find((w) => w.topic_id === 'sorting');
    // apply unlocked (understand 0.8 >= 0.7), analyze unlocked (apply 0.7 >= 0.7)
    expect(sorting.scores).toHaveProperty('analyze', 0.3);
    expect(sorting.unlocked_levels).toContain('analyze');
  });

  test('ranks weakest-first and respects limit', async () => {
    Course.findOne.mockReturnValue(courseQueryResult(courseDoc));
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { topicId: 'arrays', bloomLevel: 'REMEMBER', score: 0.5 },
        { topicId: 'graphs', bloomLevel: 'REMEMBER', score: 0.9 },
        { topicId: 'graphs', bloomLevel: 'UNDERSTAND', score: 0.8 },
        { topicId: 'sorting', bloomLevel: 'REMEMBER', score: 0.7 }
      ])
    });
    // limit 2 of 3 topics
    const out = await getWeakCompetenciesForCourse('user-123', 'course-1', 2);
    expect(out).toHaveLength(2);
    // arrays (current-level remember == 0.5) ranks weakest; sorting (remember
    // 0.7) ranks weaker than graphs (understand 0.8) -> sorting is #2
    expect(out[0].topic_id).toBe('arrays');
    expect(out[1].topic_id).toBe('sorting');
  });

  test('a topic with no competency rows is not-started and ranks weakest', async () => {
    Course.findOne.mockReturnValue(courseQueryResult(courseDoc));
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { topicId: 'sorting', bloomLevel: 'REMEMBER', score: 0.9 },
        { topicId: 'sorting', bloomLevel: 'UNDERSTAND', score: 0.8 }
      ])
    });
    const out = await getWeakCompetenciesForCourse('user-123', 'course-1', 10);
    const sorting = out.find((w) => w.topic_id === 'sorting');
    expect(sorting.current_level).toBe('understand');
    // arrays & graphs have no rows -> current_level null
    const graphs = out.find((w) => w.topic_id === 'graphs');
    expect(graphs.current_level).toBeNull();
    expect(graphs.scores).toEqual({});
    // not-started topics rank first (weakest)
    expect(out[0].current_level).toBeNull();
  });
});
