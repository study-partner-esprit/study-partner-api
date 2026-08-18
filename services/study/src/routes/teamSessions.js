const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { StudySession, Course } = require('../models');
const {
  DEFAULT_TASK_ESTIMATED_MINUTES,
  toSafeInteger,
  getAxiosErrorDetails,
  buildInternalHeaders,
  isTeamSessionMember,
  toParticipantCharacterSummary
} = require('../utils/sessionHelpers');
const {
  BASE_TEAM_SESSION_XP,
  BASE_TEAM_HOST_XP,
  calculateSocialXPWithCharacter,
  fetchGamificationProfile,
  syncUnlockProgressFromMetrics,
  buildUnlockMetricsFromAward,
  trackAnalyticsEvent,
  getSelectedCharacterForAuthorization
} = require('../utils/gamificationService');

const router = express.Router();

const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007';

// POST /team — Create team session
router.post('/team', async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      taskId,
      topicId,
      courseId,
      studyPlanId,
      mode,
      maxParticipants,
      selectedCharacterId = null
    } = req.body;

    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    // Build task list from course if provided
    const tasks = [];
    if (courseId) {
      const course = await Course.findOne({ _id: courseId });
      if (course && course.topics) {
        course.topics.forEach((topic, tIdx) => {
          if (topic.subtopics && topic.subtopics.length > 0) {
            topic.subtopics.forEach((sub, sIdx) => {
              tasks.push({
                taskId: sub.id || `t${tIdx}-s${sIdx}`,
                title: sub.title || `${topic.title} - Part ${sIdx + 1}`,
                description: sub.summary || '',
                estimatedMinutes: DEFAULT_TASK_ESTIMATED_MINUTES,
                status: 'pending',
                xpEarned: 0
              });
            });
          } else {
            tasks.push({
              taskId: `topic-${tIdx}`,
              title: topic.title,
              description: '',
              estimatedMinutes: DEFAULT_TASK_ESTIMATED_MINUTES,
              status: 'pending',
              xpEarned: 0
            });
          }
        });
      }
    }

    if (tasks.length > 0) {
      tasks[0].status = 'in-progress';
      tasks[0].startedAt = new Date();
    }

    const session = await StudySession.create({
      userId,
      taskId,
      topicId,
      courseId,
      studyPlanId,
      selectedCharacterId,
      mode: mode || 'focus',
      type: 'team',
      status: 'active',
      inviteCode,
      maxParticipants: Math.min(maxParticipants || 4, 4),
      participants: [
        {
          userId,
          name: req.user.name || 'Host',
          role: 'host',
          joinedAt: new Date()
        }
      ],
      startTime: new Date(),
      taskProgress:
        tasks.length > 0
          ? {
              currentTaskIndex: 0,
              tasks,
              totalTasks: tasks.length,
              completedTasks: 0
            }
          : undefined,
      xpMultiplier: 1.0 // Will be updated when session starts based on team size
    });

    res.status(201).json({
      message: 'Team session created',
      session,
      inviteCode
    });
  } catch (error) {
    console.error('Error creating team session:', error);
    res.status(500).json({ error: 'Failed to create team session' });
  }
});

// POST /team/:sessionId/join — Join team session
router.post('/team/:sessionId/join', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { inviteCode } = req.body;
    const { sessionId } = req.params;

    const session = await StudySession.findOne({
      _id: sessionId,
      type: 'team',
      status: 'active'
    });

    if (!session) return res.status(404).json({ error: 'Team session not found' });
    if (session.inviteCode !== inviteCode)
      return res.status(403).json({ error: 'Invalid invite code' });
    if (session.participants.some((p) => p.userId === userId && !p.leftAt)) {
      return res.status(409).json({ error: 'Already in this session' });
    }
    if (session.participants.filter((p) => !p.leftAt).length >= session.maxParticipants) {
      return res.status(400).json({ error: 'Session is full' });
    }

    session.participants.push({
      userId,
      name: req.user.name || 'Member',
      role: 'member',
      joinedAt: new Date()
    });

    // Update XP multiplier based on team size
    const activeCount = session.participants.filter((p) => !p.leftAt).length;
    const multipliers = { 1: 1.0, 2: 1.15, 3: 1.2, 4: 1.25 };
    session.xpMultiplier = multipliers[Math.min(activeCount, 4)] || 1.25;

    await session.save();

    // Notify host
    try {
      await axios.post(
        `${NOTIFICATION_URL}/api/v1/notifications`,
        {
          userId: session.userId,
          type: 'team_join',
          title: 'Someone joined your session',
          message: `A study partner joined your team session!`,
          metadata: { sessionId: session._id.toString() }
        },
        { headers: buildInternalHeaders(req.headers.authorization) }
      );
    } catch (err) {
      console.warn('Team join notification failed:', err.message);
    }

    res.json({ message: 'Joined team session', session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// POST /team/join-by-code — Join session using invite code only (no sessionId needed)
router.post('/team/join-by-code', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { inviteCode } = req.body;

    if (!inviteCode) return res.status(400).json({ error: 'inviteCode is required' });

    const session = await StudySession.findOne({
      inviteCode: inviteCode.toUpperCase(),
      type: 'team',
      status: 'active'
    });

    if (!session)
      return res.status(404).json({ error: 'No active session found with that invite code' });
    if (session.participants.some((p) => p.userId === userId && !p.leftAt)) {
      return res.status(409).json({ error: 'Already in this session' });
    }
    if (session.participants.filter((p) => !p.leftAt).length >= session.maxParticipants) {
      return res.status(400).json({ error: 'Session is full' });
    }

    session.participants.push({
      userId,
      name: req.user.name || 'Member',
      role: 'member',
      joinedAt: new Date()
    });

    const activeCount = session.participants.filter((p) => !p.leftAt).length;
    const multipliers = { 1: 1.0, 2: 1.15, 3: 1.2, 4: 1.25 };
    session.xpMultiplier = multipliers[Math.min(activeCount, 4)] || 1.25;

    await session.save();

    // Notify host
    try {
      await axios.post(
        `${NOTIFICATION_URL}/api/v1/notifications`,
        {
          userId: session.userId,
          type: 'team_join',
          title: 'Someone joined your session',
          message: `A study partner joined your team session!`,
          metadata: { sessionId: session._id.toString() }
        },
        { headers: buildInternalHeaders(req.headers.authorization) }
      );
    } catch (err) {
      console.warn('Team join notification failed:', err.message);
    }

    res.json({
      message: 'Joined team session',
      session,
      sessionId: session._id.toString(),
      inviteCode: session.inviteCode
    });
  } catch (error) {
    console.error('Error joining by code:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// POST /team/:sessionId/leave — Leave team session
router.post('/team/:sessionId/leave', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const participant = session.participants.find((p) => p.userId === userId && !p.leftAt);
    if (!participant) return res.status(404).json({ error: 'Not in this session' });

    participant.leftAt = new Date();
    await session.save();

    res.json({ message: 'Left team session' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave session' });
  }
});

// POST /team/:sessionId/invite — Invite friend
router.post('/team/:sessionId/invite', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) {
      console.warn(`[Team Invite] Session not found: ${req.params.sessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!isTeamSessionMember(session, userId)) {
      return res.status(403).json({ error: 'Only session members can invite others' });
    }

    const { friendId } = req.body;
    if (!friendId) {
      console.warn('[Team Invite] friendId not provided in request body');
      return res.status(400).json({ error: 'friendId required' });
    }

    console.log(`[Team Invite] Inviting ${friendId} to session ${session._id}`);

    // Lookup inviter nickname and course title for a personalised notification
    let inviterName = 'A friend';
    let courseName = null;
    try {
      const USER_PROFILE_URL =
        process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
      const profileRes = await axios.get(`${USER_PROFILE_URL}/api/v1/users/profile`, {
        headers: { Authorization: req.headers.authorization }
      });
      inviterName = profileRes.data?.nickname || profileRes.data?.profile?.nickname || inviterName;
    } catch (_e) {
      /* best-effort */
    }
    if (session.courseId) {
      try {
        const { Course } = require('../models');
        const course = await Course.findById(session.courseId).select('title').lean();
        if (course) courseName = course.title;
      } catch (_e) {
        /* best-effort */
      }
    }

    // Send team invite notification
    try {
      const notificationPayload = {
        userId: friendId,
        type: 'team_invite',
        title: 'Game Room Invite',
        message: `${inviterName} invited you to join a Game Room!`,
        metadata: {
          sessionId: session._id.toString(),
          inviteCode: session.inviteCode,
          inviterName,
          ...(courseName && { courseName })
        }
      };

      console.log('[Team Invite] Sending notification:', notificationPayload);

      await axios.post(`${NOTIFICATION_URL}/api/v1/notifications`, notificationPayload, {
        headers: buildInternalHeaders(req.headers.authorization)
      });

      console.log(`[Team Invite] Notification sent successfully to ${friendId}`);
    } catch (err) {
      console.warn('Team invite notification failed:', err.message, err.response?.data);
    }

    res.json({ message: 'Invite sent' });
  } catch (error) {
    console.error('[Team Invite] Error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// PUT /team/:sessionId/start — Leader starts the session for everyone
router.put('/team/:sessionId/start', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.userId !== userId)
      return res.status(403).json({ error: 'Only the session leader can start' });

    // Broadcast session_start to all active participants (including leader)
    const activeUserIds = session.participants.filter((p) => !p.leftAt).map((p) => p.userId);

    // Also include the host if not already in participants list
    if (!activeUserIds.includes(userId)) activeUserIds.push(userId);

    try {
      await axios.post(
        `${NOTIFICATION_URL}/api/v1/notifications/broadcast`,
        {
          userIds: activeUserIds,
          payload: {
            type: 'session_start',
            sessionId: session._id.toString(),
            inviteCode: session.inviteCode
          }
        },
        { headers: buildInternalHeaders(req.headers.authorization) }
      );
    } catch (err) {
      console.warn('[Team Start] Broadcast failed:', err.message);
    }

    res.json({ message: 'Session started', sessionId: session._id.toString() });
  } catch (error) {
    console.error('[Team Start] Error:', error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// GET /team/:sessionId/participants — List participants
router.get('/team/:sessionId/participants', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({ _id: req.params.sessionId, type: 'team' });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (!isTeamSessionMember(session, userId)) {
      return res.status(403).json({ error: 'Not a member of this session' });
    }

    const participantUserIds = Array.from(
      new Set(session.participants.map((p) => String(p.userId)).filter(Boolean))
    );

    let characterByUserId = new Map();
    if (participantUserIds.length > 0) {
      const characterEntries = await Promise.all(
        participantUserIds.map(async (participantUserId) => {
          const userCharacter = await getSelectedCharacterForAuthorization({
            authorization: req.headers.authorization,
            userId: participantUserId
          });
          return [String(participantUserId), toParticipantCharacterSummary(userCharacter)];
        })
      );

      characterByUserId = new Map(characterEntries);
    }

    const participants = session.participants.map((p) => ({
      userId: p.userId,
      name: p.name,
      avatar: p.avatar,
      character: characterByUserId.get(String(p.userId)) || null,
      role: p.role,
      joinedAt: p.joinedAt,
      leftAt: p.leftAt,
      durationMinutes: p.leftAt
        ? Math.round((new Date(p.leftAt) - new Date(p.joinedAt)) / 60000)
        : Math.round((new Date() - new Date(p.joinedAt)) / 60000)
    }));

    res.json({ participants });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get participants' });
  }
});

// PUT /team/:sessionId/end — End team session (host only)
router.put('/team/:sessionId/end', async (req, res) => {
  try {
    const userId = req.user.userId;
    const session = await StudySession.findOne({
      _id: req.params.sessionId,
      type: 'team',
      status: 'active'
    });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Only host can end
    if (session.userId !== userId)
      return res.status(403).json({ error: 'Only the host can end the session' });

    const now = new Date();
    session.status = 'completed';
    session.endTime = now;
    session.duration = Math.round((now - session.startTime) / 60000);

    // Set leftAt for all active participants
    session.participants.forEach((p) => {
      if (!p.leftAt) p.leftAt = now;
    });

    await session.save();

    // Award XP to each participant with participant-specific auth context.
    const participantMap = new Map();
    for (const participant of session.participants) {
      if (!participant?.userId) continue;
      participantMap.set(String(participant.userId), participant);
    }

    if (!participantMap.has(String(session.userId))) {
      participantMap.set(String(session.userId), {
        userId: String(session.userId),
        role: 'host'
      });
    }

    const teamRewards = [];
    for (const participant of participantMap.values()) {
      const participantUserId = String(participant.userId);

      try {
        const action = participant.role === 'host' ? 'team_session_host' : 'team_session';
        const baseXP = action === 'team_session_host' ? BASE_TEAM_HOST_XP : BASE_TEAM_SESSION_XP;
        let socialXpResult = null;

        try {
          socialXpResult = await calculateSocialXPWithCharacter({
            authorization: req.headers.authorization,
            userId: participantUserId,
            activityType: action,
            baseXP,
            sessionId: session._id.toString()
          });
        } catch (xpError) {
          console.warn(
            `[Team Session] Character social XP calculation failed for ${participantUserId}:`,
            getAxiosErrorDetails(xpError)
          );
        }

        const computedAwardedXP = toSafeInteger(socialXpResult?.totalXP, baseXP);
        const awardResponse = await axios.post(
          `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
          {
            action,
            xp_amount: computedAwardedXP,
            userId: participantUserId,
            metadata: {
              sessionId: session._id.toString(),
              participantUserId,
              participantRole: participant.role || 'member',
              teamSize: participantMap.size,
              characterMultiplier: Number(socialXpResult?.multiplier || 1)
            }
          },
          { headers: buildInternalHeaders(req.headers.authorization) }
        );

        const awardData = awardResponse?.data || {};
        const gamificationProfile = await fetchGamificationProfile({
          authorization: req.headers.authorization,
          userId: participantUserId
        });
        let unlockSync = null;

        try {
          unlockSync = await syncUnlockProgressFromMetrics({
            authorization: req.headers.authorization,
            userId: participantUserId,
            metrics: buildUnlockMetricsFromAward({
              awardData,
              gamificationProfile
            })
          });
        } catch (unlockError) {
          console.warn(
            `[Team Session] Unlock sync failed for ${participantUserId}:`,
            getAxiosErrorDetails(unlockError)
          );
        }

        teamRewards.push({
          userId: participantUserId,
          action,
          baseXP,
          awardedXP: computedAwardedXP,
          abilityBonuses: socialXpResult?.abilityBonuses || [],
          multiplier: Number(socialXpResult?.multiplier || 1),
          rank: {
            name: awardData.rank_name || null,
            index: Number.isFinite(Number(awardData.rank_index))
              ? Number(awardData.rank_index)
              : null,
            totalKnowledgePoints: Number.isFinite(Number(awardData.total_knowledge_points))
              ? Number(awardData.total_knowledge_points)
              : null,
            knowledgePointsAwarded: Number.isFinite(Number(awardData.knowledge_points_awarded))
              ? Number(awardData.knowledge_points_awarded)
              : null,
            kpToNextRank: Number.isFinite(Number(awardData.kp_to_next_rank))
              ? Number(awardData.kp_to_next_rank)
              : null
          },
          unlockSync
        });
      } catch (err) {
        console.warn('Team XP award failed for', participantUserId, getAxiosErrorDetails(err));
      }

      await trackAnalyticsEvent({
        authorization: req.headers.authorization,
        eventType: 'study_session_completed',
        metadata: {
          sessionId: session._id.toString(),
          duration: session.duration || 0,
          sessionType: 'team',
          participantRole: participant.role || 'member',
          teamSize: participantMap.size,
          completedTasks: session.taskProgress?.completedTasks || 0,
          totalTasks: session.taskProgress?.totalTasks || 0
        }
      });
    }

    res.json({
      message: 'Team session ended',
      session,
      teamRewards
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to end session' });
  }
});

module.exports = router;
