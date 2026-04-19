const mongoose = require('mongoose');

// Achievement catalog
const ACHIEVEMENT_CATALOG = [
  {
    id: 'first_course',
    name: 'Knowledge Seeker',
    description: 'Upload your first course',
    icon: '📚',
    condition: (stats) => stats.coursesUploaded >= 1
  },
  {
    id: 'five_courses',
    name: 'Librarian',
    description: 'Upload 5 courses',
    icon: '🏛️',
    condition: (stats) => stats.coursesUploaded >= 5
  },
  {
    id: 'first_task',
    name: 'Task Tackler',
    description: 'Complete your first task',
    icon: '✅',
    condition: (stats) => stats.tasksCompleted >= 1
  },
  {
    id: 'ten_tasks',
    name: 'Productivity Machine',
    description: 'Complete 10 tasks',
    icon: '⚡',
    condition: (stats) => stats.tasksCompleted >= 10
  },
  {
    id: 'fifty_tasks',
    name: 'Task Master',
    description: 'Complete 50 tasks',
    icon: '🏆',
    condition: (stats) => stats.tasksCompleted >= 50
  },
  {
    id: 'first_focus',
    name: 'Laser Focus',
    description: 'Achieve your first perfect focus session',
    icon: '🎯',
    condition: (stats) => stats.perfectSessions >= 1
  },
  {
    id: 'ten_focus',
    name: 'Focus Guru',
    description: 'Achieve 10 perfect focus sessions',
    icon: '🧘',
    condition: (stats) => stats.perfectSessions >= 10
  },
  {
    id: 'level_5',
    name: 'Rising Star',
    description: 'Reach level 5',
    icon: '⭐',
    condition: (_, profile) => profile.level >= 5
  },
  {
    id: 'level_10',
    name: 'Veteran Scholar',
    description: 'Reach level 10',
    icon: '🌟',
    condition: (_, profile) => profile.level >= 10
  },
  {
    id: 'level_25',
    name: 'Grand Master',
    description: 'Reach level 25',
    icon: '👑',
    condition: (_, profile) => profile.level >= 25
  },
  {
    id: 'streak_7',
    name: 'Week Warrior',
    description: 'Maintain a 7-day streak',
    icon: '🔥',
    condition: (stats) => stats.currentStreak >= 7
  },
  {
    id: 'streak_30',
    name: 'Unstoppable',
    description: 'Maintain a 30-day streak',
    icon: '💎',
    condition: (stats) => stats.currentStreak >= 30
  },
  // Social achievements
  {
    id: 'first_friend',
    name: 'Social Butterfly',
    description: 'Add your first friend',
    icon: '🤝',
    condition: (stats) => (stats.friendsAdded || 0) >= 1
  },
  {
    id: 'five_friends',
    name: 'Study Circle',
    description: 'Have 5 friends',
    icon: '👥',
    condition: (stats) => (stats.friendsAdded || 0) >= 5
  },
  {
    id: 'first_team_session',
    name: 'Team Player',
    description: 'Complete your first team study session',
    icon: '🎮',
    condition: (stats) => (stats.teamSessions || 0) >= 1
  },
  {
    id: 'ten_team_sessions',
    name: 'Squad Leader',
    description: 'Complete 10 team study sessions',
    icon: '🏅',
    condition: (stats) => (stats.teamSessions || 0) >= 10
  }
];

const gamificationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    totalXp: {
      type: Number,
      default: 0,
      min: 0
    },
    level: {
      type: Number,
      default: 1,
      min: 1
    },
    xpHistory: [
      {
        action: {
          type: String,
          required: true
        },
        xp: {
          type: Number,
          required: true
        },
        timestamp: {
          type: Date,
          default: Date.now
        },
        metadata: {
          type: mongoose.Schema.Types.Mixed
        }
      }
    ],
    achievements: [
      {
        id: String,
        name: String,
        description: String,
        unlockedAt: Date,
        icon: String
      }
    ],
    stats: {
      coursesUploaded: {
        type: Number,
        default: 0
      },
      tasksCompleted: {
        type: Number,
        default: 0
      },
      perfectSessions: {
        type: Number,
        default: 0
      },
      currentStreak: {
        type: Number,
        default: 0
      },
      longestStreak: {
        type: Number,
        default: 0
      },
      friendsAdded: {
        type: Number,
        default: 0
      },
      teamSessions: {
        type: Number,
        default: 0
      },
      groupSessions: {
        type: Number,
        default: 0
      },
      challengesCompleted: {
        type: Number,
        default: 0
      }
    }
  },
  {
    timestamps: true
  }
);

// Calculate level based on XP (100 XP per level)
gamificationSchema.methods.calculateLevel = function () {
  return Math.floor(this.totalXp / 100) + 1;
};

// Award XP and check for level up
gamificationSchema.methods.awardXp = function (xp, action, metadata = {}) {
  const oldLevel = this.level;
  this.totalXp += xp;
  this.level = this.calculateLevel();

  this.xpHistory.push({
    action,
    xp,
    metadata,
    timestamp: new Date()
  });

  // Check for new achievements
  const newAchievements = this.checkAndUnlockAchievements();

  return {
    xpAwarded: xp,
    totalXp: this.totalXp,
    oldLevel,
    newLevel: this.level,
    leveledUp: this.level > oldLevel,
    newAchievements
  };
};

// Check all achievement conditions and unlock any newly earned ones
gamificationSchema.methods.checkAndUnlockAchievements = function () {
  const unlockedIds = new Set(this.achievements.map((a) => a.id));
  const newlyUnlocked = [];

  for (const achievement of ACHIEVEMENT_CATALOG) {
    if (unlockedIds.has(achievement.id)) continue;
    if (achievement.condition(this.stats, this)) {
      const unlocked = {
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        unlockedAt: new Date()
      };
      this.achievements.push(unlocked);
      newlyUnlocked.push(unlocked);
    }
  }

  return newlyUnlocked;
};

const Gamification = mongoose.model('Gamification', gamificationSchema);

module.exports = Gamification;
