/**
 * Subject Service
 */
const { Subject, Topic, StudySession, Task } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');
const { Op } = require('sequelize');

class SubjectService {
  async getSubjects(userId, includeArchived = false) {
    const where = { userId };
    if (!includeArchived) {
      where.isArchived = false;
    }
    
    return Subject.findAll({
      where,
      include: [{ model: Topic, as: 'topics', where: { isArchived: false }, required: false }],
      order: [['name', 'ASC']],
    });
  }

  async getSubjectById(userId, subjectId) {
    const subject = await Subject.findOne({
      where: { id: subjectId, userId },
      include: [{ model: Topic, as: 'topics' }],
    });
    
    if (!subject) {
      throw ApiError.notFound('Subject not found');
    }
    
    return subject;
  }

  async createSubject(userId, data) {
    return Subject.create({
      userId,
      name: data.name,
      description: data.description,
      color: data.color,
      icon: data.icon,
    });
  }

  async updateSubject(userId, subjectId, data) {
    const subject = await this.getSubjectById(userId, subjectId);
    
    const allowedFields = ['name', 'description', 'color', 'icon', 'isArchived'];
    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }
    
    await subject.update(updateData);
    return subject;
  }

  async deleteSubject(userId, subjectId) {
    const subject = await this.getSubjectById(userId, subjectId);
    await subject.destroy();
  }

  async getSubjectStats(userId, subjectId) {
    const subject = await this.getSubjectById(userId, subjectId);
    
    const [sessions, tasks, topics] = await Promise.all([
      StudySession.count({ where: { subjectId, userId } }),
      Task.count({ where: { subjectId, userId } }),
      Topic.count({ where: { subjectId, userId, isArchived: false } }),
    ]);
    
    const completedTasks = await Task.count({
      where: { subjectId, userId, status: 'completed' },
    });
    
    return {
      totalSessions: sessions,
      totalTasks: tasks,
      completedTasks,
      taskCompletionRate: tasks > 0 ? Math.round((completedTasks / tasks) * 100) : 0,
      totalTopics: topics,
      totalStudyTime: subject.totalStudyTime,
    };
  }
}

module.exports = new SubjectService();
