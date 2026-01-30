/**
 * Session Service
 */
const { StudySession, Subject, Topic } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

class SessionService {
  async getSessions(userId, filters = {}) {
    const where = { userId };
    
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.subjectId) {
      where.subjectId = filters.subjectId;
    }
    if (filters.topicId) {
      where.topicId = filters.topicId;
    }
    if (filters.from) {
      where.startedAt = { ...where.startedAt, [Op.gte]: new Date(filters.from) };
    }
    if (filters.to) {
      where.startedAt = { ...where.startedAt, [Op.lte]: new Date(filters.to) };
    }
    
    return StudySession.findAll({
      where,
      include: [
        { model: Subject, as: 'subject', attributes: ['id', 'name', 'color'] },
        { model: Topic, as: 'topic', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: filters.limit || 50,
    });
  }

  async getSessionById(userId, sessionId) {
    const session = await StudySession.findOne({
      where: { id: sessionId, userId },
      include: [
        { model: Subject, as: 'subject' },
        { model: Topic, as: 'topic' },
      ],
    });
    
    if (!session) {
      throw ApiError.notFound('Session not found');
    }
    
    return session;
  }

  async createSession(userId, data) {
    return StudySession.create({
      userId,
      subjectId: data.subjectId,
      topicId: data.topicId,
      title: data.title,
      notes: data.notes,
      sessionType: data.sessionType,
      plannedDuration: data.plannedDuration,
      scheduledFor: data.scheduledFor,
      status: data.startNow ? 'in_progress' : 'planned',
      startedAt: data.startNow ? new Date() : null,
    });
  }

  async startSession(userId, sessionId) {
    const session = await this.getSessionById(userId, sessionId);
    
    if (session.status !== 'planned') {
      throw ApiError.badRequest('Session cannot be started');
    }
    
    await session.update({
      status: 'in_progress',
      startedAt: new Date(),
    });
    
    return session;
  }

  async endSession(userId, sessionId, data = {}) {
    const session = await this.getSessionById(userId, sessionId);
    
    if (session.status !== 'in_progress') {
      throw ApiError.badRequest('Session is not in progress');
    }
    
    const endedAt = new Date();
    const actualDuration = Math.round(
      (endedAt - session.startedAt) / 60000 // Convert to minutes
    );
    
    const transaction = await sequelize.transaction();
    
    try {
      await session.update({
        status: 'completed',
        endedAt,
        actualDuration,
        notes: data.notes || session.notes,
        focusScore: data.focusScore,
        productivityScore: data.productivityScore,
        aiSummary: data.aiSummary,
      }, { transaction });
      
      // Update subject/topic study time
      if (session.subjectId) {
        await Subject.increment('totalStudyTime', {
          by: actualDuration,
          where: { id: session.subjectId },
          transaction,
        });
      }
      
      if (session.topicId) {
        await Topic.increment('totalStudyTime', {
          by: actualDuration,
          where: { id: session.topicId },
          transaction,
        });
        
        await Topic.update(
          { lastStudiedAt: endedAt },
          { where: { id: session.topicId }, transaction }
        );
      }
      
      await transaction.commit();
      return this.getSessionById(userId, sessionId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async cancelSession(userId, sessionId) {
    const session = await this.getSessionById(userId, sessionId);
    
    if (!['planned', 'in_progress'].includes(session.status)) {
      throw ApiError.badRequest('Session cannot be cancelled');
    }
    
    await session.update({ status: 'cancelled' });
    return session;
  }

  async getActiveSession(userId) {
    return StudySession.findOne({
      where: { userId, status: 'in_progress' },
      include: [
        { model: Subject, as: 'subject', attributes: ['id', 'name', 'color'] },
        { model: Topic, as: 'topic', attributes: ['id', 'name'] },
      ],
    });
  }

  async getTodayStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const sessions = await StudySession.findAll({
      where: {
        userId,
        status: 'completed',
        startedAt: { [Op.gte]: today },
      },
    });
    
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.actualDuration || 0), 0);
    const avgFocus = sessions.length > 0
      ? Math.round(sessions.reduce((sum, s) => sum + (s.focusScore || 0), 0) / sessions.length)
      : 0;
    
    return {
      sessionsCompleted: sessions.length,
      totalStudyTime: totalMinutes,
      averageFocusScore: avgFocus,
    };
  }
}

module.exports = new SessionService();
