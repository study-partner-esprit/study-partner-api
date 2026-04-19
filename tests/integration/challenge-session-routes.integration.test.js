const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

jest.mock('@study-partner/shared/auth', () => ({
  generateToken: jest.fn(() => 'delegated-test-token')
}));

const mockFindOne = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../services/study/src/models', () => ({
  StudySession: {
    findOne: (...args) => mockFindOne(...args),
    create: (...args) => mockCreate(...args)
  }
}));

const sessionsRouter = require('../../services/study/src/routes/sessions');

function buildApp(authUserId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { userId: authUserId };
    next();
  });
  app.use('/api/v1/study/sessions', sessionsRouter);
  return app;
}

describe('Challenge Session Routes Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    axios.post.mockImplementation(async (url) => {
      if (String(url).includes('/api/v1/abilities/trigger')) {
        return {
          data: {
            success: false,
            data: {
              success: false,
              applied: false,
              reason: 'rate_limited'
            }
          }
        };
      }

      if (String(url).includes('/api/v1/users/gamification/award-xp')) {
        return {
          data: {
            rank_name: 'Scholar III',
            rank_index: 6,
            total_knowledge_points: 1200,
            knowledge_points_awarded: 60,
            kp_to_next_rank: 140
          }
        };
      }

      if (String(url).includes('/api/v1/user/unlock-progress/sync')) {
        return {
          data: {
            success: true,
            data: {
              updatedCount: 1,
              unlockedCharacterIds: []
            }
          }
        };
      }

      if (String(url).includes('/api/v1/users/quests/progress')) {
        return {
          data: {
            status: 'success'
          }
        };
      }

      return { data: {} };
    });

    axios.get.mockImplementation(async (url) => {
      if (String(url).includes('/api/v1/user/character')) {
        return {
          data: {
            success: true,
            data: {
              character_id: {
                _id: 'character-1',
                name: 'Kairo'
              }
            }
          }
        };
      }

      if (String(url).includes('/api/v1/users/gamification')) {
        return {
          data: {
            total_xp: 5000,
            stats: {
              challengesCompleted: 8,
              groupSessions: 3
            },
            xp_history: []
          }
        };
      }

      return { data: {} };
    });
  });

  test('POST /challenge/start creates an active exam-mode session', async () => {
    const createdSession = {
      _id: 'challenge-session-1',
      taskId: 'challenge-123',
      courseId: 'course-1',
      topicId: 'topic-1',
      mode: 'exam',
      type: 'solo',
      status: 'active',
      challengeDifficulty: 'expert',
      startTime: new Date()
    };

    mockCreate.mockResolvedValue(createdSession);

    const response = await request(buildApp()).post('/api/v1/study/sessions/challenge/start').send({
      challengeId: 'challenge-123',
      courseId: 'course-1',
      topicId: 'topic-1',
      difficulty: 'expert'
    });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe('Challenge session started');
    expect(response.body.session).toEqual(
      expect.objectContaining({
        _id: 'challenge-session-1',
        challengeId: 'challenge-123',
        mode: 'exam',
        status: 'active',
        challengeDifficulty: 'expert'
      })
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        taskId: 'challenge-123',
        mode: 'exam',
        type: 'solo',
        status: 'active',
        challengeDifficulty: 'expert'
      })
    );
  });

  test('PUT /challenge/:sessionId/complete applies challenge XP pipeline and returns completionRewards', async () => {
    const activeChallengeSession = {
      _id: 'challenge-session-1',
      userId: 'user-1',
      taskId: 'challenge-123',
      mode: 'exam',
      type: 'solo',
      status: 'active',
      challengeDifficulty: 'expert',
      duration: 45,
      startTime: new Date(Date.now() - 45 * 60 * 1000),
      endTime: null,
      save: jest.fn().mockResolvedValue(undefined)
    };

    mockFindOne.mockResolvedValueOnce(activeChallengeSession).mockResolvedValueOnce(null);

    const response = await request(buildApp())
      .put('/api/v1/study/sessions/challenge/challenge-session-1/complete')
      .set('Authorization', 'Bearer user-auth-token')
      .send({ focusScore: 87 });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Challenge session completed');
    expect(response.body.completionRewards).toEqual(
      expect.objectContaining({
        action: 'challenge_complete',
        baseXP: 30,
        awardedXP: 75,
        multiplier: 2.5,
        rank: expect.objectContaining({
          name: 'Scholar III',
          index: 6,
          totalKnowledgePoints: 1200,
          knowledgePointsAwarded: 60,
          kpToNextRank: 140
        })
      })
    );

    const questProgressCall = axios.post.mock.calls.find((call) =>
      String(call[0] || '').includes('/users/quests/progress')
    );
    expect(questProgressCall).toBeTruthy();
    expect(questProgressCall[1]).toEqual({ action: 'challenge_complete' });

    const unlockSyncCall = axios.post.mock.calls.find((call) =>
      String(call[0] || '').includes('/api/v1/user/unlock-progress/sync')
    );
    expect(unlockSyncCall).toBeTruthy();
    expect(unlockSyncCall[1]).toEqual(
      expect.objectContaining({
        metrics: expect.objectContaining({
          challengesCompleted: 8
        })
      })
    );
  });
});
