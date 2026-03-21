const VoiceSession = require('../models/VoiceSession');

function findParticipantIndex(session, userId) {
  return session.participants.findIndex((p) => p.userId === userId && !p.leftAt);
}

async function ensureVoiceSession(sessionId) {
  let session = await VoiceSession.findOne({ sessionId });
  if (!session) {
    session = await VoiceSession.create({ sessionId, isActive: true, participants: [] });
  }
  return session;
}

async function startVoiceSession(sessionId) {
  const session = await ensureVoiceSession(sessionId);
  session.isActive = true;
  session.startedAt = session.startedAt || new Date();
  session.endedAt = null;
  await session.save();
  return session;
}

async function endVoiceSession(sessionId) {
  const session = await VoiceSession.findOne({ sessionId });
  if (!session) return null;
  session.isActive = false;
  session.endedAt = new Date();
  await session.save();
  return session;
}

async function joinParticipant({ sessionId, userId, peerId }) {
  const session = await ensureVoiceSession(sessionId);
  const idx = findParticipantIndex(session, userId);

  if (idx >= 0) {
    session.participants[idx].peerId = peerId || session.participants[idx].peerId;
    session.participants[idx].connectionState = 'connected';
    session.participants[idx].lastHeartbeat = new Date();
  } else {
    session.participants.push({
      userId,
      peerId: peerId || '',
      connectionState: 'connected',
      joinedAt: new Date(),
      lastHeartbeat: new Date()
    });
  }

  await session.save();
  return session;
}

async function leaveParticipant({ sessionId, userId }) {
  const session = await VoiceSession.findOne({ sessionId });
  if (!session) return null;

  const idx = findParticipantIndex(session, userId);
  if (idx >= 0) {
    session.participants[idx].leftAt = new Date();
    session.participants[idx].connectionState = 'disconnected';
  }

  await session.save();
  return session;
}

async function updateMute({ sessionId, userId, isMuted }) {
  const session = await VoiceSession.findOne({ sessionId });
  if (!session) return null;

  const idx = findParticipantIndex(session, userId);
  if (idx >= 0) {
    session.participants[idx].isMuted = !!isMuted;
    session.participants[idx].lastHeartbeat = new Date();
  }

  await session.save();
  return session;
}

async function updateSpeakingStatus({ sessionId, userId, speakingStatus }) {
  const session = await VoiceSession.findOne({ sessionId });
  if (!session) return null;

  const idx = findParticipantIndex(session, userId);
  if (idx >= 0) {
    session.participants[idx].speakingStatus = speakingStatus || 'silent';
    session.participants[idx].lastHeartbeat = new Date();
  }

  await session.save();
  return session;
}

async function getVoiceStatus(sessionId) {
  const session = await VoiceSession.findOne({ sessionId }).lean();
  if (!session) return null;

  return {
    sessionId,
    isActive: session.isActive,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    participants: (session.participants || []).filter((p) => !p.leftAt)
  };
}

module.exports = {
  startVoiceSession,
  endVoiceSession,
  joinParticipant,
  leaveParticipant,
  updateMute,
  updateSpeakingStatus,
  getVoiceStatus
};
