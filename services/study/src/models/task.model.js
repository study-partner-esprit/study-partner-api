/**
 * Task Model
 * Study tasks (assignments, reading, exercises)
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Task = sequelize.define('Task', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
  },
  subjectId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'subject_id',
  },
  topicId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'topic_id',
  },
  title: {
    type: DataTypes.STRING(300),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  taskType: {
    type: DataTypes.ENUM('reading', 'exercise', 'assignment', 'quiz', 'review', 'project', 'other'),
    allowNull: false,
    defaultValue: 'other',
    field: 'task_type',
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    allowNull: false,
    defaultValue: 'medium',
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'due_date',
  },
  estimatedMinutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'estimated_minutes',
  },
  actualMinutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'actual_minutes',
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'completed_at',
  },
  isRecurring: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_recurring',
  },
  recurringPattern: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'recurring_pattern',
    comment: 'e.g., daily, weekly, custom CRON',
  },
}, {
  tableName: 'tasks',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['user_id', 'status'] },
    { fields: ['subject_id'] },
    { fields: ['due_date'] },
    { fields: ['user_id', 'due_date'] },
  ],
});

module.exports = Task;
