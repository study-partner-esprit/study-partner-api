const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const DEFAULT_TASK_ESTIMATED_MINUTES = 30;

const toSafeInteger = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(numeric));
};

const countXpHistoryActions = (xpHistory = [], predicate) => {
  if (!Array.isArray(xpHistory)) return 0;
  return xpHistory.reduce((count, entry) => {
    const action = String(entry?.action || '');
    return predicate(action) ? count + 1 : count;
  }, 0);
};

const getAxiosErrorDetails = (error) => ({
  message: error.message,
  status: error.response?.status,
  data: error.response?.data
});

const buildInternalHeaders = (authorization) => ({
  ...(authorization ? { Authorization: authorization } : {}),
  ...(INTERNAL_API_SECRET ? { 'x-internal-secret': INTERNAL_API_SECRET } : {})
});

const isTeamSessionMember = (session, userId) => {
  if (!session || !userId) return false;
  if (String(session.userId) === String(userId)) return true;
  return session.participants?.some((p) => String(p.userId) === String(userId) && !p.leftAt);
};

const isObjectId = (str) => /^[a-f\d]{24}$/i.test(str);

const toParticipantCharacterSummary = (userCharacter) => {
  const character = userCharacter?.character_id;
  if (!character) return null;
  return {
    id: character._id,
    name: character.name,
    rarity: character.rarity,
    icon: character.icon || null
  };
};

module.exports = {
  DEFAULT_TASK_ESTIMATED_MINUTES,
  toSafeInteger,
  countXpHistoryActions,
  getAxiosErrorDetails,
  buildInternalHeaders,
  isTeamSessionMember,
  isObjectId,
  toParticipantCharacterSummary
};
