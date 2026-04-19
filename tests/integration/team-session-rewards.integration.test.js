const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

jest.mock('@study-partner/shared/auth', () => ({
  generateToken: jest.fn(() => 'delegated-test-token')
}));

jest.mock('../../services/study/src/models', () => ({
  StudySession: {
    findOne: jest.fn()
  }
}));

const sessionsRouter = require('../../services/study/src/routes/sessions');
const { StudySession } = require('../../services/study/src/models');
const { generateToken } = require('@study-partner/shared/auth');

function buildApp(authUserId = 'host-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { userId: authUserId };
    next();
  });
  app.use('/api/v1/study/sessions', sessionsRouter);
  return app;
}

function makeActiveTeamSession() {
  const now = Date.now();
  return {
    _id: 'session-1',
    type: 'team',
    status: 'active',
    userId: 'host-1',
    startTime: new Date(now - 60 * 60 * 1000),
    participants: [
      {
        userId: 'host-1',
        role: 'host',
        joinedAt: new Date(now - 60 * 60 * 1000),
        leftAt: null
      },
      {
        userId: 'member-2',
        role: 'member',
        joinedAt: new Date(now - 45 * 60 * 1000),
        leftAt: null
      }
    ],
    save: jest.fn().mockResolvedValue(undefined)
  };
}

describe('Team Session Rewards Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    axios.post.mockImplementation(async (url, payload) => {
      if (String(url).includes('/api/v1/abilities/trigger')) {
        const activityType = payload?.sessionData?.activity_type;
        const sessionType = payload?.sessionData?.session_type;

        if (activityType === 'team_session_host') {
          return {
            data: {
              success: true,
              data: {
                success: true,
                applied: true,
                abilityId: 'ability-host',
                abilityName: 'Leader Boost',
                effectType: 'TEAM_XP_BOOST',
                xpGain: 45,
                xpBonus: 15,
                multiplier: 1.5
              }
            }
          };
        }

        if (activityType === 'team_session') {
          return {
            data: {
              success: true,
              data: {
                success: true,
                applied: true,
                abilityId: 'ability-member',
                abilityName: 'Unity Bond',
                effectType: 'TEAM_XP_BOOST',
                xpGain: 24,
                xpBonus: 4,
                multiplier: 1.2
              }
            }
          };
        }

        if (sessionType === 'challenge') {
          return {
            data: {
              success: false,
              data: {
                success: false,
                applied: false,
                reason: 'not_applicable'
              }
            }
          };
        }

        return { data: { success: false, data: { success: false, applied: false } } };
      }

      if (String(url).includes('/api/v1/users/gamification/award-xp')) {
        return {
          data: {
            rank_name: 'Scholar III',
            rank_index: 6,
            total_knowledge_points: 1200
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
                name: 'Unitas'
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
              challengesCompleted: 2,
              groupSessions: 7
            },
            xp_history: []
          }
        };
      }

      return { data: {} };
    });
  });

  test('PUT /team/:sessionId/end returns teamRewards with participant-specific awards', async () => {
    const session = makeActiveTeamSession();
    StudySession.findOne.mockResolvedValue(session);

    const response = await request(buildApp('host-1'))
      .put('/api/v1/study/sessions/team/session-1/end')
      .set('Authorization', 'Bearer host-auth-token');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Team session ended');
    expect(Array.isArray(response.body.teamRewards)).toBe(true);
    expect(response.body.teamRewards).toHaveLength(2);

    const hostReward = response.body.teamRewards.find((reward) => reward.userId === 'host-1');
    const memberReward = response.body.teamRewards.find((reward) => reward.userId === 'member-2');

    expect(hostReward).toEqual(
      expect.objectContaining({
        action: 'team_session_host',
        baseXP: 30,
        awardedXP: 45,
        multiplier: 1.5
      })
    );

    expect(memberReward).toEqual(
      expect.objectContaining({
        action: 'team_session',
        baseXP: 20,
        awardedXP: 24,
        multiplier: 1.2
      })
    );

    expect(session.save).toHaveBeenCalledTimes(1);
    expect(
      session.participants.every(
        (participant) => participant.leftAt instanceof Date && participant.leftAt.getTime() > 0
      )
    ).toBe(true);

    const awardedActions = axios.post.mock.calls.map((call) => call[1]?.action).sort();
    expect(awardedActions).toEqual(['team_session', 'team_session_host']);

    const delegatedUserIds = generateToken.mock.calls.map((call) => call[0]?.userId).sort();
    expect(delegatedUserIds).toEqual(['host-1', 'member-2']);

    const unlockSyncCalls = axios.post.mock.calls.filter((call) =>
      String(call[0] || '').includes('/api/v1/user/unlock-progress/sync')
    );
    expect(unlockSyncCalls).toHaveLength(2);
    expect(unlockSyncCalls[0][1]).toEqual(
      expect.objectContaining({
        metrics: expect.objectContaining({
          groupSessions: 7,
          challengesCompleted: 2
        })
      })
    );
  });

  test('PUT /team/:sessionId/end blocks non-host users', async () => {
    const session = makeActiveTeamSession();
    StudySession.findOne.mockResolvedValue(session);

    const response = await request(buildApp('member-2'))
      .put('/api/v1/study/sessions/team/session-1/end')
      .set('Authorization', 'Bearer member-auth-token');

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/only the host/i);
    expect(session.save).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('PUT /:sessionId emits challenge action and challenge XP rewards for exam-mode sessions', async () => {
    const now = Date.now();
    const challengeSession = {
      _id: 'challenge-session-1',
      userId: 'host-1',
      status: 'active',
      type: 'solo',
      mode: 'exam',
      taskId: 'challenge-task-1',
      courseId: 'course-1',
      duration: 45,
      startTime: new Date(now - 45 * 60 * 1000),
      save: jest.fn().mockResolvedValue(undefined)
    };

    StudySession.findOne.mockResolvedValueOnce(challengeSession).mockResolvedValueOnce(null);

    const response = await request(buildApp('host-1'))
      .put('/api/v1/study/sessions/challenge-session-1')
      .set('Authorization', 'Bearer host-auth-token')
      .send({ status: 'completed' });

    expect(response.status).toBe(200);
    expect(response.body.completionRewards).toEqual(
      expect.objectContaining({
        action: 'challenge_complete',
        baseXP: 30,
        awardedXP: 60,
        multiplier: 2
      })
    );

    const awardCall = axios.post.mock.calls.find((call) =>
      String(call[0] || '').includes('/gamification/award-xp')
    );
    expect(awardCall).toBeTruthy();
    expect(awardCall[1]).toEqual(
      expect.objectContaining({
        action: 'challenge_complete',
        xp_amount: 60,
        metadata: expect.objectContaining({
          sessionType: 'challenge',
          challengeId: 'challenge-task-1',
          challengeDifficulty: 'hard'
        })
      })
    );
  });
});
