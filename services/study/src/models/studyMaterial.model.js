/**
 * Study Material Model
 * Study materials/resources
 */
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StudyMaterial = sequelize.define('StudyMaterial', {
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
  materialType: {
    type: DataTypes.ENUM('note', 'document', 'video', 'audio', 'link', 'flashcard_set', 'other'),
    allowNull: false,
    defaultValue: 'note',
    field: 'material_type',
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'For notes and text content',
  },
  externalUrl: {
    type: DataTypes.STRING(1000),
    allowNull: true,
    field: 'external_url',
  },
  fileUrl: {
    type: DataTypes.STRING(1000),
    allowNull: true,
    field: 'file_url',
  },
  fileMimeType: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'file_mime_type',
  },
  tags: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    allowNull: true,
    defaultValue: [],
  },
  isFavorite: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_favorite',
  },
  viewCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'view_count',
  },
}, {
  tableName: 'study_materials',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['subject_id'] },
    { fields: ['topic_id'] },
    { fields: ['material_type'] },
  ],
});

module.exports = StudyMaterial;
