function normalizeSignalPayload(payload = {}) {
  return {
    signalType: payload.signalType || 'unknown',
    targetUserId: payload.targetUserId || null,
    signal: payload.signal || null
  };
}

module.exports = {
  normalizeSignalPayload
};
