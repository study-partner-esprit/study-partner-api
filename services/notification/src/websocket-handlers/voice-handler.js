const { updateSpeakingStatus, updateMute } = require('../services/voiceService');

async function handleVoiceSignal({ payload, context }) {
  const { sessionId, userId, broadcastToSession } = context;

  broadcastToSession(sessionId, {
    type: 'voice_signal',
    sessionId,
    fromUserId: userId,
    signalType: payload?.signalType || 'unknown',
    targetUserId: payload?.targetUserId || null,
    signal: payload?.signal || null,
    createdAt: new Date().toISOString()
  });
}

async function handleMuteState({ payload, context }) {
  const { sessionId, userId, broadcastToSession } = context;
  const isMuted = !!payload?.isMuted;

  await updateMute({ sessionId, userId, isMuted });

  broadcastToSession(sessionId, {
    type: 'voice_mute',
    sessionId,
    userId,
    isMuted,
    createdAt: new Date().toISOString()
  });
}

async function handleSpeakingState({ payload, context }) {
  const { sessionId, userId, broadcastToSession } = context;
  const speakingStatus = payload?.speakingStatus || 'silent';

  await updateSpeakingStatus({ sessionId, userId, speakingStatus });

  broadcastToSession(sessionId, {
    type: 'voice_speaking',
    sessionId,
    userId,
    speakingStatus,
    createdAt: new Date().toISOString()
  });
}

module.exports = {
  handleVoiceSignal,
  handleMuteState,
  handleSpeakingState
};
