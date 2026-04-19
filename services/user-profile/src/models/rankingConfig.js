const RANK_LADDER = [
  { index: 0, tier: 'Novice', division: 'III', name: 'Novice III', minKp: 0 },
  { index: 1, tier: 'Novice', division: 'II', name: 'Novice II', minKp: 150 },
  { index: 2, tier: 'Novice', division: 'I', name: 'Novice I', minKp: 300 },
  { index: 3, tier: 'Explorer', division: 'III', name: 'Explorer III', minKp: 450 },
  { index: 4, tier: 'Explorer', division: 'II', name: 'Explorer II', minKp: 600 },
  { index: 5, tier: 'Explorer', division: 'I', name: 'Explorer I', minKp: 750 },
  { index: 6, tier: 'Scholar', division: 'III', name: 'Scholar III', minKp: 900 },
  { index: 7, tier: 'Scholar', division: 'II', name: 'Scholar II', minKp: 1050 },
  { index: 8, tier: 'Scholar', division: 'I', name: 'Scholar I', minKp: 1200 },
  { index: 9, tier: 'Strategist', division: 'III', name: 'Strategist III', minKp: 1350 },
  {
    index: 10,
    tier: 'Strategist',
    division: 'II',
    name: 'Strategist II',
    minKp: 1500
  },
  { index: 11, tier: 'Strategist', division: 'I', name: 'Strategist I', minKp: 1650 },
  { index: 12, tier: 'Expert', division: 'III', name: 'Expert III', minKp: 1800 },
  { index: 13, tier: 'Expert', division: 'II', name: 'Expert II', minKp: 2000 },
  { index: 14, tier: 'Expert', division: 'I', name: 'Expert I', minKp: 2200 },
  { index: 15, tier: 'Master', division: 'III', name: 'Master III', minKp: 2400 },
  { index: 16, tier: 'Master', division: 'II', name: 'Master II', minKp: 2600 },
  { index: 17, tier: 'Master', division: 'I', name: 'Master I', minKp: 2800 },
  { index: 18, tier: 'Grandmaster', division: null, name: 'Grandmaster', minKp: 3000 },
  { index: 19, tier: 'Legend', division: null, name: 'Legend', minKp: 3500 }
];

const LOW_BRACKET_MAX_INDEX = 8; // Scholar I and below
const DEFAULT_SEASON_FLOOR_INDEX = 3; // Explorer III
const DEFAULT_KP = RANK_LADDER[DEFAULT_SEASON_FLOOR_INDEX].minKp;

function clampRankIndex(index) {
  if (!Number.isFinite(index)) return DEFAULT_SEASON_FLOOR_INDEX;
  if (index < 0) return 0;
  if (index >= RANK_LADDER.length) return RANK_LADDER.length - 1;
  return index;
}

function getRankByIndex(index) {
  return RANK_LADDER[clampRankIndex(index)];
}

function getRankByKp(knowledgePoints) {
  const kp = Math.max(0, Number(knowledgePoints) || 0);
  for (let i = RANK_LADDER.length - 1; i >= 0; i -= 1) {
    if (kp >= RANK_LADDER[i].minKp) {
      return RANK_LADDER[i];
    }
  }
  return RANK_LADDER[0];
}

function isLowBracket(rankIndex) {
  return clampRankIndex(rankIndex) <= LOW_BRACKET_MAX_INDEX;
}

module.exports = {
  RANK_LADDER,
  LOW_BRACKET_MAX_INDEX,
  DEFAULT_SEASON_FLOOR_INDEX,
  DEFAULT_KP,
  getRankByIndex,
  getRankByKp,
  clampRankIndex,
  isLowBracket
};
