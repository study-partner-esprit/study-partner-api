const mongoose = require('mongoose');

const studySessionSchema = new mongoose.Schema({
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
  duration: {
    type: Number, // in minutes
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
  }
}, {
  timestamps: true
});

const taskSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  studyPlanId: {
    type: String,
    index: true  // Link to study plan if task came from planner
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
  tags: [{
    type: String
  }]
}, {
  timestamps: true
});

const topicSchema = new mongoose.Schema({
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
}, {
  timestamps: true
});

const subjectSchema = new mongoose.Schema({
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
}, {
  timestamps: true
});

const courseSchema = new mongoose.Schema({
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
  topics: [{
    title: String,
    subtopics: [{
      id: String,
      title: String,
      summary: String,
      key_concepts: [String],
      definitions: [{
        term: String,
        definition: String
      }],
      formulas: [String],
      examples: [String],
      tokenized_chunks: [String]
    }]
  }],
  files: [{
    filename: String,
    originalName: String,
    size: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  processedAt: {
    type: Date
  },
  aiCourseId: {
    type: String,
    index: true  // Link to AI service course record
  }
}, {
  timestamps: true
});

const studyPlanSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  courseId: {
    type: String,
    index: true  // Optional: link to course if plan was generated from course
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
    tasks: [{
      id: String,
      title: String,
      description: String,
      estimated_minutes: Number,
      difficulty: Number,
      prerequisites: [String],
      is_review: Boolean
    }]
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
}, {
  timestamps: true
});

const StudySession = mongoose.model('StudySession', studySessionSchema);
const Task = mongoose.model('Task', taskSchema);
const Topic = mongoose.model('Topic', topicSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Course = mongoose.model('Course', courseSchema);
const StudyPlan = mongoose.model('StudyPlan', studyPlanSchema);

module.exports = { StudySession, Task, Topic, Subject, Course, StudyPlan };
