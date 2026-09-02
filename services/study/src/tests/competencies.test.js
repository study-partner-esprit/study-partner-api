/**
 * BLOOM-09 — Competency API tests.
 *
 * Exercises the route layer (auth-scoped, subject filter, knowledgeType
 * breakdown, topic detail + needsReview) with the query service mocked,
 * plus direct unit tests of the aggregation helpers in competencyQueries.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../services/competencyQueries', () => ({
  getUserCompetencyMap: jest.fn(),
  getTopicDetail: jest.fn()
}));

const { getUserCompetencyMap, getTopicDetail } = require('../services/competencyQueries');
const competencyRoutes = require('../routes/competencies');

const app = express();
app.use(express.json());

const fakeAuth = (req, res, next) => {
  req.user = { userId: 'user-123' };
  next();
};

app.use('/api/v1/competencies', fakeAuth, competencyRoutes);

const sampleLevel = {
  bloomLevel: 'APPLY',
  score: 0.72,
  confidence: 0.6,
  count: 2
};

const sampleSubject = {
  subjectId: 'subj-1',
  subjectName: 'Algorithms',
  topics: [
    {
      topicId: 't1',
      topicName: 'Sorting',
      parentTopic: 'Core Algorithms',
      subjectId: 'subj-1',
      courseId: 'course-1',
      levels: [sampleLevel]
    }
  ]
};

describe('GET /api/v1/competencies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the competency map grouped by subject', async () => {
    getUserCompetencyMap.mockResolvedValue([sampleSubject]);
    const res = await request(app).get('/api/v1/competencies');
    expect(res.status).toBe(200);
    expect(res.body.competencies).toEqual([sampleSubject]);
    expect(getUserCompetencyMap).toHaveBeenCalledWith('user-123', {
      subjectId: undefined,
      knowledgeTypeBreakdown: false
    });
    expect(res.headers['cache-control']).toMatch(/max-age=/);
  });

  test('forwards subjectId filter and knowledgeType breakdown', async () => {
    getUserCompetencyMap.mockResolvedValue([]);
    const res = await request(app).get(
      '/api/v1/competencies?subjectId=subj-1&knowledgeType=breakdown'
    );
    expect(res.status).toBe(200);
    expect(getUserCompetencyMap).toHaveBeenCalledWith('user-123', {
      subjectId: 'subj-1',
      knowledgeTypeBreakdown: true
    });
  });

  test('does NOT enable breakdown for other knowledgeType values', async () => {
    getUserCompetencyMap.mockResolvedValue([]);
    await request(app).get('/api/v1/competencies?knowledgeType=bogus');
    expect(getUserCompetencyMap).toHaveBeenCalledWith('user-123', {
      subjectId: undefined,
      knowledgeTypeBreakdown: false
    });
  });
});

describe('GET /api/v1/competencies/topics/:topicId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns topic detail with evidence', async () => {
    const detail = {
      topicId: 't1',
      topicName: 'Sorting',
      competencies: [
        {
          bloomLevel: 'APPLY',
          score: 0.72,
          confidence: 0.6,
          needsReview: false,
          evidence: [{ masteryScore: 0.8, evaluatedAt: '2026-01-01' }]
        }
      ]
    };
    getTopicDetail.mockResolvedValue(detail);
    const res = await request(app).get('/api/v1/competencies/topics/t1');
    expect(res.status).toBe(200);
    expect(res.body.topic).toEqual(detail);
    expect(getTopicDetail).toHaveBeenCalledWith('user-123', 't1');
  });

  test('returns 404 when no competency data exists', async () => {
    getTopicDetail.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/competencies/topics/unknown');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ── aggregation unit tests (real competencyQueries helpers) ──────────────────

const realQueries = jest.requireActual('../services/competencyQueries');
const {
  buildTopicIndex,
  groupKnowledgeTypes,
  getUserCompetencyMap: realGetUserCompetencyMap,
  getTopicDetail: realGetTopicDetail,
  NEEDS_REVIEW_MIN_CONFIDENCE
} = realQueries;

const { Subject, Course, CompetencyProfile } = require('../models/index');

jest.mock('../models/index', () => ({
  Subject: { find: jest.fn() },
  Course: { find: jest.fn() },
  CompetencyProfile: { find: jest.fn() }
}));

describe('groupKnowledgeTypes', () => {
  test('aggregates rows by knowledgeType with averaged score/confidence', () => {
    const out = groupKnowledgeTypes([
      { knowledgeType: 'conceptual', score: 0.6, confidence: 0.4, evidence: [1, 2] },
      { knowledgeType: 'conceptual', score: 0.8, confidence: 0.8, evidence: [1] },
      { knowledgeType: 'procedural', score: 0.5, confidence: 0.3, evidence: [] }
    ]);
    expect(out).toHaveLength(2);
    const conceptual = out.find((k) => k.knowledgeType === 'conceptual');
    expect(conceptual.score).toBe(0.7);
    expect(conceptual.confidence).toBe(0.6);
    expect(conceptual.count).toBe(2);
  });
});

describe('getUserCompetencyMap (real implementation, mocked models)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('groups profiles by subject → topic → bloom level', async () => {
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'course-1',
          subjectId: 'subj-1',
          title: 'CS',
          topics: [
            {
              title: 'Core',
              subtopics: [{ id: 't1', title: 'Sorting' }]
            }
          ]
        }
      ])
    });

    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topicId: 't1',
          knowledgeType: 'conceptual',
          bloomLevel: 'REMEMBER',
          score: 0.6,
          confidence: 0.5,
          evidence: []
        },
        {
          topicId: 't1',
          knowledgeType: 'procedural',
          bloomLevel: 'APPLY',
          score: 0.8,
          confidence: 0.7,
          evidence: []
        }
      ])
    });

    Subject.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'subj-1', name: 'Algorithms' }])
    });

    const map = await realGetUserCompetencyMap('u1');
    expect(map).toHaveLength(1);
    expect(map[0].subjectName).toBe('Algorithms');
    expect(map[0].topics[0].topicName).toBe('Sorting');
    const levels = map[0].topics[0].levels;
    expect(levels.map((l) => l.bloomLevel)).toEqual(['REMEMBER', 'APPLY']);
    expect(levels[0].count).toBe(1);
  });

  test('filters by subjectId', async () => {
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'c1',
          subjectId: 'subj-1',
          title: 'A',
          topics: [{ title: 'T', subtopics: [{ id: 't1', title: 'S' }] }]
        },
        {
          _id: 'c2',
          subjectId: 'subj-2',
          title: 'B',
          topics: [{ title: 'T', subtopics: [{ id: 't2', title: 'S2' }] }]
        }
      ])
    });
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topicId: 't1',
          knowledgeType: 'k',
          bloomLevel: 'REMEMBER',
          score: 0.5,
          confidence: 0.5,
          evidence: []
        },
        {
          topicId: 't2',
          knowledgeType: 'k',
          bloomLevel: 'APPLY',
          score: 0.9,
          confidence: 0.8,
          evidence: []
        }
      ])
    });
    Subject.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'subj-1', name: 'A' }])
    });

    const map = await realGetUserCompetencyMap('u1', { subjectId: 'subj-1' });
    expect(map).toHaveLength(1);
    expect(map[0].subjectId).toBe('subj-1');
    expect(map[0].topics[0].topicId).toBe('t1');
  });

  test('drops profiles whose topic is not in any course topic tree', async () => {
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'c1',
          subjectId: 'subj-1',
          title: 'A',
          topics: [{ title: 'T', subtopics: [{ id: 't1', title: 'S' }] }]
        }
      ])
    });
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topicId: 't1',
          knowledgeType: 'k',
          bloomLevel: 'REMEMBER',
          score: 0.5,
          confidence: 0.5,
          evidence: []
        },
        {
          topicId: 'orphan',
          knowledgeType: 'k',
          bloomLevel: 'APPLY',
          score: 0.9,
          confidence: 0.8,
          evidence: []
        }
      ])
    });
    Subject.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'subj-1', name: 'A' }])
    });

    const map = await realGetUserCompetencyMap('u1');
    expect(map[0].topics).toHaveLength(1);
    expect(map[0].topics[0].topicId).toBe('t1');
  });

  test('includes knowledgeType breakdown when requested', async () => {
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'c1',
          subjectId: 'subj-1',
          title: 'A',
          topics: [{ title: 'T', subtopics: [{ id: 't1', title: 'S' }] }]
        }
      ])
    });
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topicId: 't1',
          knowledgeType: 'conceptual',
          bloomLevel: 'APPLY',
          score: 0.6,
          confidence: 0.5,
          evidence: []
        },
        {
          topicId: 't1',
          knowledgeType: 'procedural',
          bloomLevel: 'APPLY',
          score: 0.8,
          confidence: 0.7,
          evidence: []
        }
      ])
    });
    Subject.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'subj-1', name: 'A' }])
    });

    const map = await realGetUserCompetencyMap('u1', { knowledgeTypeBreakdown: true });
    const apply = map[0].topics[0].levels.find((l) => l.bloomLevel === 'APPLY');
    expect(apply.knowledgeTypes).toBeDefined();
    expect(apply.knowledgeTypes).toHaveLength(2);
  });
});

describe('getTopicDetail (real implementation, mocked models)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns per-level competencies with evidence excerpts and needsReview', async () => {
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: 'c1',
          subjectId: 'subj-1',
          title: 'A',
          topics: [{ title: 'T', subtopics: [{ id: 't1', title: 'Sorting' }] }]
        }
      ])
    });
    CompetencyProfile.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topicId: 't1',
          knowledgeType: 'conceptual',
          bloomLevel: 'APPLY',
          score: 0.72,
          confidence: 0.2, // below threshold => needsReview
          evidence: [
            {
              objectiveId: 'o1',
              demonstratedBloomLevel: 'APPLY',
              masteryScore: 0.7,
              evaluatedAt: new Date('2026-01-01'),
              correlationId: 'corr-1'
            },
            {
              objectiveId: 'o1',
              demonstratedBloomLevel: 'APPLY',
              masteryScore: 0.9,
              evaluatedAt: new Date('2026-01-02'),
              correlationId: 'corr-2'
            }
          ]
        }
      ])
    });

    const detail = await realGetTopicDetail('u1', 't1');
    expect(detail.topicName).toBe('Sorting');
    expect(detail.competencies).toHaveLength(1);
    expect(detail.competencies[0].needsReview).toBe(true);
    // evidence excerpts capped at last 5, includes the two provided entries
    expect(detail.competencies[0].evidence).toHaveLength(2);
    expect(detail.competencies[0].evidence[0].objectiveId).toBe('o1');
  });

  test('returns null when the user has no competencies for the topic', async () => {
    Course.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([])
    });
    CompetencyProfile.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const detail = await realGetTopicDetail('u1', 't1');
    expect(detail).toBeNull();
  });
});
