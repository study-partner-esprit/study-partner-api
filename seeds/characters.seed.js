/**
 * Character Seed Data
 * Populates the database with all 7 characters and their abilities
 * Run with: node seeds/characters.seed.js
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
});

const Character = require('../services/user-profile/src/character/models').Character;
const CharacterAbility = require('../services/user-profile/src/character/models').CharacterAbility;

const CHARACTER_DATA = [
  // BASE LAYER CHARACTERS (Day 1-30)
  

  // ENDGAME LAYER CHARACTER (Day 90+)
  {
    name: 'Zenith',
    description: 'Apex of mastery. Self-amplifying with hard cap at 1.25x, requires high rank.',
    rarity: 'legendary',
    layer: 'endgame',
    is_purchasable: true,
    purchase_price_usd_cents: 1299,
    image_asset_path: '/characters/zenith.png',
    unlock_condition: {
      type: 'rank',
      value: 15,
      description: 'Reach Master III (rank index 15) or higher',
    },
    icon: '👑',
    abilities: [
      {
        name: 'Ascending Mastery',
        description:
          'Self-amplifying XP multiplier (caps at 1.25x, requires anti-abuse protection)',
        effect_type: 'XP_MULTIPLIER',
        effect_value: 0.5,
        hard_cap: 1.25,
        trigger_condition: 'session_completed',
      },
    ],
  },
];

/**
 * Seed the database with character data
 */
async function seedCharacters() {
  try {
    // Connect to MongoDB
    const mongoUri =
      process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/study-partner';
    console.log(`Connecting to MongoDB: ${mongoUri}`);

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');

    // Clear existing characters
    console.log('Clearing existing characters...');
    await Character.deleteMany({});
    await CharacterAbility.deleteMany({});
    console.log('✅ Cleared existing data\n');

    // Create characters and abilities
    console.log('Seeding characters...\n');

    let totalCreated = 0;

    for (const charData of CHARACTER_DATA) {
      console.log(`Creating character: ${charData.name} (${charData.rarity})`);

      // Create abilities first to get their IDs
      const abilityIds = [];
      if (charData.abilities && charData.abilities.length > 0) {
        for (const abilityData of charData.abilities) {
          const ability = new CharacterAbility({
            name: abilityData.name,
            description: abilityData.description,
            effect_type: abilityData.effect_type,
            effect_value: abilityData.effect_value,
            hard_cap: abilityData.hard_cap,
            trigger_condition: abilityData.trigger_condition,
            rarity: charData.rarity,
          });

          await ability.save();
          abilityIds.push(ability._id);
          console.log(`  └─ Created ability: ${abilityData.name}`);
        }
      }

      // Create character with ability references
      const character = new Character({
        name: charData.name,
        description: charData.description,
        rarity: charData.rarity,
        layer: charData.layer,
        is_purchasable: Boolean(charData.is_purchasable),
        purchase_price_usd_cents: Number(charData.purchase_price_usd_cents || 0),
        image_asset_path: charData.image_asset_path,
        unlock_condition: charData.unlock_condition,
        primary_ability_id: abilityIds[0] || null,
        abilities: abilityIds,
        icon: charData.icon,
      });

      await character.save();
      console.log(`  ✅ Created character with ${abilityIds.length} abilities\n`);

      totalCreated++;
    }

    console.log(`\n========================================`);
    console.log(`✅ SEED COMPLETE`);
    console.log(`========================================`);
    console.log(`Total characters created: ${totalCreated}`);
    console.log(``);
    console.log(`Character Summary:`);
    console.log(`  🫒 Base Layer (3): Chrono, Aurum, Unitas`);
    console.log(`  ⚙️  Progression Layer (3): Aegis, Kairo, Lyra`);
    console.log(`  👑 Endgame Layer (1): Zenith`);
    console.log(`\n✨ Database is ready for use!\n`);

    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error seeding characters:', error.message);
    process.exit(1);
  }
}

// Run seed
seedCharacters();

module.exports = CHARACTER_DATA;
