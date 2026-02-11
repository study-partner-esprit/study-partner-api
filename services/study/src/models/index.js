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

const StudySession = mongoose.model('StudySession', studySessionSchema);
const Task = mongoose.model('Task', taskSchema);
const Topic = mongoose.model('Topic', topicSchema);

module.exports = { StudySession, Task, Topic };
