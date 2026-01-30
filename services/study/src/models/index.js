/**
 * Models Index - Study Service
 */
const Subject = require('./subject.model');
const Topic = require('./topic.model');
const StudySession = require('./studySession.model');
const Task = require('./task.model');
const StudyMaterial = require('./studyMaterial.model');
const { sequelize } = require('../config/database');

// Subject -> Topics (One to Many)
Subject.hasMany(Topic, {
  foreignKey: 'subjectId',
  as: 'topics',
  onDelete: 'CASCADE'
});
Topic.belongsTo(Subject, {
  foreignKey: 'subjectId',
  as: 'subject'
});

// Subject -> Study Sessions
Subject.hasMany(StudySession, {
  foreignKey: 'subjectId',
  as: 'sessions'
});
StudySession.belongsTo(Subject, {
  foreignKey: 'subjectId',
  as: 'subject'
});

// Topic -> Study Sessions
Topic.hasMany(StudySession, {
  foreignKey: 'topicId',
  as: 'sessions'
});
StudySession.belongsTo(Topic, {
  foreignKey: 'topicId',
  as: 'topic'
});

// Subject -> Tasks
Subject.hasMany(Task, {
  foreignKey: 'subjectId',
  as: 'tasks'
});
Task.belongsTo(Subject, {
  foreignKey: 'subjectId',
  as: 'subject'
});

// Topic -> Tasks
Topic.hasMany(Task, {
  foreignKey: 'topicId',
  as: 'tasks'
});
Task.belongsTo(Topic, {
  foreignKey: 'topicId',
  as: 'topic'
});

// Subject -> Study Materials
Subject.hasMany(StudyMaterial, {
  foreignKey: 'subjectId',
  as: 'materials'
});
StudyMaterial.belongsTo(Subject, {
  foreignKey: 'subjectId',
  as: 'subject'
});

// Topic -> Study Materials
Topic.hasMany(StudyMaterial, {
  foreignKey: 'topicId',
  as: 'materials'
});
StudyMaterial.belongsTo(Topic, {
  foreignKey: 'topicId',
  as: 'topic'
});

module.exports = {
  sequelize,
  Subject,
  Topic,
  StudySession,
  Task,
  StudyMaterial
};
