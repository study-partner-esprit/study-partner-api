/**
 * Rank Badge Seed Data
 * Populates rank badge metadata for all rank ladder entries.
 * Run with: node seeds/rank-badges.seed.js
 */

/* eslint-disable no-console */

const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
});

const { RANK_LADDER } = require('../services/user-profile/src/models/rankingConfig');
const RankBadge = require('../services/user-profile/src/models/RankBadge');

const SINGLE_BADGE_TIERS = new Set(['grandmaster', 'legend']);
const DIVISION_TO_BADGE_KEY = {
  III: 'first',
  II: 'second',
  I: 'third'
};

function toBadgeKey(rank) {
  const tier = String(rank?.tier || '').toLowerCase();
  if (SINGLE_BADGE_TIERS.has(tier)) return 'use';
  return DIVISION_TO_BADGE_KEY[String(rank?.division || '').toUpperCase()] || 'use';
}

function buildBadgeDoc(rank) {
  const tier = String(rank.tier || 'novice').toLowerCase();
  const badgeKey = toBadgeKey(rank);

  return {
    rankIndex: rank.index,
    rankName: rank.name,
    tier,
    division: rank.division || null,
    badgeKey,
    imagePath: `/ranking-badges/${tier}/${badgeKey}.png`,
    isActive: true
  };
}

function buildMongoCandidates() {
  const primary =
    process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/study_partner';

  const candidates = [primary];
  if (primary.includes('host.docker.internal')) {
    candidates.push(primary.replace(/host\.docker\.internal/g, 'localhost'));
  }

  const localhostDefault = 'mongodb://localhost:27017/study_partner';
  if (!candidates.includes(localhostDefault)) {
    candidates.push(localhostDefault);
  }

  return candidates;
}

async function connectToMongoWithFallback() {
  const candidates = buildMongoCandidates();
  let lastError = null;

  for (const uri of candidates) {
    try {
      console.log(`Connecting to MongoDB: ${uri}`);
      await mongoose.connect(uri);
      console.log('Connected to MongoDB');
      return uri;
    } catch (error) {
      lastError = error;
      console.warn(`MongoDB connection failed for ${uri}: ${error.message}`);

      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  }

  throw lastError || new Error('Failed to connect to MongoDB');
}

async function seedRankBadges() {
  try {
    await connectToMongoWithFallback();

    const badgeDocs = RANK_LADDER.map(buildBadgeDoc);

    await RankBadge.deleteMany({});
    await RankBadge.insertMany(badgeDocs, { ordered: true });

    console.log(`Seeded ${badgeDocs.length} rank badges`);
    console.log('Rank badge seed complete');

    await mongoose.connection.close();
  } catch (error) {
    console.error('Rank badge seed failed:', error.message);
    process.exit(1);
  }
}

seedRankBadges();
