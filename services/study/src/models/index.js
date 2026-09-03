const mongoose = require('mongoose');

const studySessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    taskId: {
      type: String
    },
    topicId: {
      type: String
    },
    // Course-based session fields
    courseId: {
      type: String,
      index: true
    },
    studyPlanId: {
      type: String,
      index: true
    },
    mode: {
      type: String,
      enum: ['focus', 'pomodoro', 'exam'],
      default: 'focus'
    },
    challengeDifficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard', 'expert'],
      default: 'medium'
    },
    selectedCharacterId: {
      type: String,
      index: true
    },
    // Task-by-task progression
    taskProgress: {
      currentTaskIndex: { type: Number, default: 0 },
      tasks: [
        {
          taskId: String,
          title: String,
          description: String,
          status: {
            type: String,
            enum: ['pending', 'in-progress', 'completed', 'skipped'],
            default: 'pending'
          },
          startedAt: Date,
          completedAt: Date,
          xpEarned: { type: Number, default: 0 }
        }
      ],
      totalTasks: { type: Number, default: 0 },
      completedTasks: { type: Number, default: 0 }
    },
    // XP multiplier for team sessions
    xpMultiplier: {
      type: Number,
      default: 1.0
    },
    duration: {
      type: Number // in minutes
    },
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'completed'
    },
    startTime: {
      type: Date,
      default: Date.now
    },
    endTime: {
      type: Date
    },
    focusScore: {
      type: Number,
      min: 0,
      max: 100
    },
    completedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      maxlength: 1000
    },
    signalHistory: [
      {
        timestamp: Date,
        focusLevel: Number,
        fatigueLevel: Number,
        isDistracted: Boolean
      }
    ],
    breakStats: {
      totalBreaks: { type: Number, default: 0 },
      totalBreakDuration: { type: Number, default: 0 }, // seconds
      avgBreakDuration: { type: Number, default: 0 }
    },
    // Team session fields
    type: {
      type: String,
      enum: ['solo', 'team'],
      default: 'solo'
    },
    participants: [
      {
        userId: { type: String, required: true },
        name: { type: String },
        avatar: { type: String },
        role: { type: String, enum: ['host', 'member'], default: 'member' },
        joinedAt: { type: Date, default: Date.now },
        leftAt: { type: Date }
      }
    ],
    inviteCode: {
      type: String,
      unique: true,
      sparse: true
    },
    maxParticipants: {
      type: Number,
      default: 5,
      max: 10
    }
  },
  {
    timestamps: true
  }
);

const taskSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    studyPlanId: {
      type: String,
      index: true // Link to study plan if task came from planner
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String
    },
    topicId: {
      type: String
    },
    // BLOOM-10: competency target for weakest-first planning. `objectiveId`
    // is the learning objective / subtopic id the task strengthens at
    // `targetBloomLevel`. Optional — absent for fallback/degraded plans.
    objectiveId: {
      type: String
    },
    targetBloomLevel: {
      type: String
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    estimatedTime: {
      type: Number // in minutes
    },
    actualTime: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['todo', 'in-progress', 'completed', 'cancelled'],
      default: 'todo'
    },
    dueDate: {
      type: Date
    },
    completedAt: {
      type: Date
    },
    tags: [
      {
        type: String
      }
    ]
  },
  {
    timestamps: true
  }
);

const topicSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    description: {
      type: String
    },
    category: {
      type: String
    },
    color: {
      type: String,
      default: '#ff4655'
    },
    totalStudyTime: {
      type: Number,
      default: 0
    },
    mastery: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

const subjectSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    description: {
      type: String
    },
    image: {
      type: String // URL to subject image
    },
    color: {
      type: String,
      default: '#ff4655'
    }
  },
  {
    timestamps: true
  }
);

const courseSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    subjectId: {
      type: String,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String
    },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing'
    },
    topics: [
      {
        title: String,
        subtopics: [
          {
            id: String,
            title: String,
            summary: String,
            key_concepts: [String],
            definitions: [
              {
                term: String,
                definition: String
              }
            ],
            formulas: [String],
            examples: [String],
            tokenized_chunks: [String],
            learning_objectives: [mongoose.Schema.Types.Mixed]
          }
        ]
      }
    ],
    files: [
      {
        filename: String,
        originalName: String,
        size: Number,
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    processedAt: {
      type: Date
    },
    aiCourseId: {
      type: String,
      index: true // Link to AI service course record
    }
  },
  {
    timestamps: true
  }
);

const learningObjectiveSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true
    },
    documentId: {
      type: String,
      required: true
    },
    objectiveId: {
      type: String,
      required: true
    },
    topicId: {
      type: String,
      required: true
    },
    knowledgeType: {
      type: String,
      required: true
    },
    bloomLevel: {
      type: String,
      required: true
    },
    verb: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true
    },
    textHash: {
      type: String,
      required: true
    },
    version: {
      type: Number,
      default: 1
    },
    isActive: {
      type: Boolean,
      default: true
    },
    supersededAt: {
      type: Date
    },
    classification: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const competencyProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true
    },
    topicId: {
      type: String,
      required: true
    },
    knowledgeType: {
      type: String,
      required: true
    },
    bloomLevel: {
      type: String,
      required: true
    },
    score: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 1
    },
    confidence: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 1
    },
    evidence: {
      type: [
        {
          objectiveId: String,
          demonstratedBloomLevel: String,
          masteryScore: Number,
          evaluatedAt: Date,
          correlationId: String
        }
      ],
      default: [],
      validate: {
        validator: function (v) {
          return v.length <= 20;
        },
        message: 'Evidence array capped at 20 entries'
      }
    }
  },
  {
    timestamps: true
  }
);

// ── BLOOM-08: EvalResultRecord (read-only view of eval_results collection) ───
// The orchestrator writes eval_results; the study service reads them to
// feed the competency updater. Shared DB, separate process.
const evalResultRecordSchema = new mongoose.Schema(
  {
    correlationId: { type: String, required: true },
    messageId: { type: String },
    userId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true },
    step: { type: Number, required: true },
    status: { type: String },
    masteryScore: { type: Number, default: null },
    scores: { type: mongoose.Schema.Types.Mixed, default: {} },
    nextQuestion: { type: String, default: null },
    demonstratedBloomLevel: { type: String, default: null },
    objectiveId: { type: String, default: null },
    targetBloomLevel: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  {
    collection: 'eval_results',
    timestamps: false
  }
);

evalResultRecordSchema.index({ demonstratedBloomLevel: 1 });
evalResultRecordSchema.index({ objectiveId: 1 });

// ── BLOOM-08: CompetencyProcessing (idempotency claim store) ─────────────────
// Each eval result is claimed exactly once via unique correlationId.
// Replays/retries find the existing claim and skip (ACK-skip semantics).
const competencyProcessingSchema = new mongoose.Schema(
  {
    correlationId: {
      type: String,
      required: true,
      unique: true
    },
    processedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

const studyPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    courseId: {
      type: String,
      index: true // Optional: link to course if plan was generated from course
    },
    goal: {
      type: String,
      required: true
    },
    availableTimeMinutes: {
      type: Number,
      required: true
    },
    taskGraph: {
      goal: String,
      tasks: [
        {
          id: String,
          title: String,
          description: String,
          estimated_minutes: Number,
          difficulty: Number,
          prerequisites: [String],
          is_review: Boolean,
          // BLOOM-10: competency target echoed from the AI result (snake_case).
          objective_id: String,
          target_bloom_level: String
        }
      ]
    },
    totalEstimatedMinutes: {
      type: Number
    },
    warning: {
      type: String
    },
    status: {
      type: String,
      enum: ['created', 'scheduled', 'in-progress', 'completed', 'cancelled'],
      default: 'created'
    },
    scheduledAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// --- Compound indexes for hot query patterns ---
studySessionSchema.index({ userId: 1, completedAt: -1 });
studySessionSchema.index({ userId: 1, status: 1, createdAt: -1 });
taskSchema.index({ userId: 1, status: 1, createdAt: -1 });

// BLOOM-06: learning objective indexes
learningObjectiveSchema.index({ topicId: 1, bloomLevel: 1 });
learningObjectiveSchema.index({ documentId: 1 });
learningObjectiveSchema.index({ documentId: 1, topicId: 1, textHash: 1 }, { unique: true });

// BLOOM-07: competency profile indexes
competencyProfileSchema.index({ userId: 1, topicId: 1 });
competencyProfileSchema.index(
  { userId: 1, topicId: 1, knowledgeType: 1, bloomLevel: 1 },
  { unique: true }
);

const StudySession = mongoose.model('StudySession', studySessionSchema);
const Task = mongoose.model('Task', taskSchema);
const Topic = mongoose.model('Topic', topicSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Course = mongoose.model('Course', courseSchema);
const StudyPlan = mongoose.model('StudyPlan', studyPlanSchema);
const LearningObjective = mongoose.model(
  'LearningObjective',
  learningObjectiveSchema,
  'learning_objectives'
);
const CompetencyProfile = mongoose.model(
  'CompetencyProfile',
  competencyProfileSchema,
  'competency_profiles'
);

// BLOOM-08: read-only view of eval_results (written by orchestrator)
const EvalResultRecord = mongoose.model('EvalResultRecord', evalResultRecordSchema, 'eval_results');

// BLOOM-08: idempotency claim store for competency updates
const CompetencyProcessing = mongoose.model(
  'CompetencyProcessing',
  competencyProcessingSchema,
  'competency_processing'
);

module.exports = {
  StudySession,
  Task,
  Topic,
  Subject,
  Course,
  StudyPlan,
  LearningObjective,
  CompetencyProfile,
  EvalResultRecord,
  CompetencyProcessing
};
