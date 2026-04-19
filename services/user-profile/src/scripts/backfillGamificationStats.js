const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../../../../.env')
});

const Gamification = require('../models/Gamification');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner';

const isChallengeCompletionAction = (action = '') => {
  const normalizedAction = String(action || '')
    .trim()
    .toLowerCase();
  if (!normalizedAction) return false;

  if (
    normalizedAction.includes('fail') ||
    normalizedAction.includes('failed') ||
    normalizedAction.includes('abandon') ||
    normalizedAction.includes('cancel')
  ) {
    return false;
  }

  return (
    normalizedAction === 'challenge_complete' ||
    normalizedAction === 'challenge_completed' ||
    normalizedAction.startsWith('challenge_') ||
    normalizedAction.endsWith('_challenge')
  );
};

const isGroupSessionAction = (action = '') => /^team_session(_host)?$/i.test(String(action || ''));

const toSafeInt = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(numeric));
};

function deriveStatsFromHistory(xpHistory = []) {
  const challengeCount = xpHistory.reduce((count, entry) => {
    return isChallengeCompletionAction(entry?.action) ? count + 1 : count;
  }, 0);

  const groupSessionCount = xpHistory.reduce((count, entry) => {
    return isGroupSessionAction(entry?.action) ? count + 1 : count;
  }, 0);

  return {
    challengeCount,
    groupSessionCount
  };
}

async function backfill({ dryRun = false } = {}) {
  const cursor = Gamification.find({}).cursor();

  let scanned = 0;
  let changed = 0;

  for await (const profile of cursor) {
    scanned += 1;

    const stats = profile.stats || {};
    const { challengeCount, groupSessionCount } = deriveStatsFromHistory(profile.xpHistory || []);

    const existingChallenges = toSafeInt(
      stats.challengesCompleted ?? stats.challenges_completed ?? stats.challengeCount,
      0
    );
    const existingGroupSessions = toSafeInt(
      stats.groupSessions ?? stats.group_sessions ?? stats.teamSessions ?? stats.team_sessions,
      0
    );

    const nextChallenges = Math.max(existingChallenges, challengeCount);
    const nextGroupSessions = Math.max(existingGroupSessions, groupSessionCount);

    const hasChanges =
      nextChallenges !== existingChallenges ||
      nextGroupSessions !== existingGroupSessions ||
      stats.challengesCompleted !== nextChallenges ||
      stats.groupSessions !== nextGroupSessions;

    if (!hasChanges) {
      continue;
    }

    changed += 1;
    profile.stats = {
      ...stats,
      challengesCompleted: nextChallenges,
      groupSessions: nextGroupSessions
    };

    if (!dryRun) {
      await profile.save();
    }
  }

  return { scanned, changed, dryRun };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const startedAt = Date.now();

  try {
    await mongoose.connect(MONGODB_URI);

    const result = await backfill({ dryRun });
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(2);

    // eslint-disable-next-line no-console
    console.log(
      `[Backfill] completed. scanned=${result.scanned}, changed=${result.changed}, dryRun=${result.dryRun}, elapsed=${elapsedSeconds}s`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Backfill] failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  backfill,
  deriveStatsFromHistory,
  isChallengeCompletionAction,
  isGroupSessionAction
};
