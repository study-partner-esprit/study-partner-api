/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const UserRankProfile = require('../models/UserRankProfile');
const Gamification = require('../models/Gamification');
const RankSeason = require('../models/RankSeason');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toSeasonCode(date = new Date()) {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}-S${quarter}`;
}

function toInitialKp(totalXp) {
  return clamp(300 + Math.floor(Math.max(0, Number(totalXp) || 0) * 0.15), 300, 1600);
}

async function ensureActiveSeason() {
  const now = new Date();
  const seasonCode = toSeasonCode(now);

  let activeSeason = await RankSeason.findOne({
    status: 'active',
    startAt: { $lte: now },
    $or: [{ endAt: null }, { endAt: { $gt: now } }]
  }).sort({ startAt: -1 });

  if (activeSeason) return activeSeason;

  activeSeason = await RankSeason.findOne({ seasonCode, status: { $in: ['upcoming', 'active'] } });
  if (activeSeason) {
    activeSeason.status = 'active';
    if (!activeSeason.startAt) activeSeason.startAt = now;
    if (activeSeason.endAt && activeSeason.endAt <= now) activeSeason.endAt = null;
    await activeSeason.save();
    return activeSeason;
  }

  return RankSeason.create({
    seasonCode,
    name: `Season ${seasonCode}`,
    status: 'active',
    startAt: now,
    resetPolicy: {
      lowBracketDrop: 3,
      highBracketDrop: 5,
      seasonFloorIndex: 3
    }
  });
}

async function upsertProfile(userId, totalXp, activeSeasonId, dryRun) {
  const initialKP = toInitialKp(totalXp);
  let profile = await UserRankProfile.findOne({ userId });
  const isNew = !profile;

  if (!profile) {
    profile = new UserRankProfile({ userId });
  }

  profile.currentSeasonId = profile.currentSeasonId || activeSeasonId;
  profile.knowledgePoints = initialKP;
  profile.seasonPeakKp = Math.max(initialKP, Number(profile.seasonPeakKp || 0));
  profile.allTimePeakKp = Math.max(initialKP, Number(profile.allTimePeakKp || 0));
  profile.learningSkillRating = Number.isFinite(profile.learningSkillRating)
    ? profile.learningSkillRating
    : 1000;
  profile.currentStreak = Number.isFinite(profile.currentStreak) ? profile.currentStreak : 0;
  profile.comebackBonusRemaining = Number.isFinite(profile.comebackBonusRemaining)
    ? profile.comebackBonusRemaining
    : 0;

  profile.syncRankFromPoints();

  if (!dryRun) {
    await profile.save();
  }

  return { isNew, initialKP };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner';

  await mongoose.connect(mongoUri);
  console.log(`[KP Migration] Connected to MongoDB (${dryRun ? 'dry-run' : 'write'})`);

  const activeSeason = await ensureActiveSeason();
  const activeSeasonId = activeSeason._id;

  const gamificationRows = await Gamification.find({}).select('userId totalXp').lean();
  const processedUserIds = new Set();

  let created = 0;
  let updated = 0;

  for (const row of gamificationRows) {
    processedUserIds.add(row.userId);
    const result = await upsertProfile(row.userId, row.totalXp, activeSeasonId, dryRun);
    if (result.isNew) created += 1;
    else updated += 1;
  }

  // Profiles without gamification rows still get minimum KP baseline.
  const orphanProfiles = await UserRankProfile.find({
    userId: { $nin: [...processedUserIds] }
  }).select('userId');

  for (const profile of orphanProfiles) {
    const result = await upsertProfile(profile.userId, 0, activeSeasonId, dryRun);
    if (result.isNew) created += 1;
    else updated += 1;
  }

  console.log('[KP Migration] Completed');
  console.log(`[KP Migration] Created profiles: ${created}`);
  console.log(`[KP Migration] Updated profiles: ${updated}`);
  console.log(`[KP Migration] Season used: ${activeSeason.seasonCode}`);

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('[KP Migration] Failed:', error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('[KP Migration] Disconnect failed:', disconnectError.message);
  }
  process.exit(1);
});
