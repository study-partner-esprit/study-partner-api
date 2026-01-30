/**
 * Task Service
 */
const { Task, Subject, Topic } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');
const { Op } = require('sequelize');

class TaskService {
  async getTasks(userId, filters = {}) {
    const where = { userId };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.subjectId) {
      where.subjectId = filters.subjectId;
    }
    if (filters.priority) {
      where.priority = filters.priority;
    }
    if (filters.dueFrom) {
      where.dueDate = { ...where.dueDate, [Op.gte]: new Date(filters.dueFrom) };
    }
    if (filters.dueTo) {
      where.dueDate = { ...where.dueDate, [Op.lte]: new Date(filters.dueTo) };
    }

    return Task.findAll({
      where,
      include: [
        { model: Subject, as: 'subject', attributes: ['id', 'name', 'color'] },
        { model: Topic, as: 'topic', attributes: ['id', 'name'] }
      ],
      order: [
        ['priority', 'DESC'],
        ['dueDate', 'ASC'],
        ['createdAt', 'DESC']
      ],
      limit: filters.limit || 100
    });
  }

  async getTaskById(userId, taskId) {
    const task = await Task.findOne({
      where: { id: taskId, userId },
      include: [
        { model: Subject, as: 'subject' },
        { model: Topic, as: 'topic' }
      ]
    });

    if (!task) {
      throw ApiError.notFound('Task not found');
    }

    return task;
  }

  async createTask(userId, data) {
    return Task.create({
      userId,
      subjectId: data.subjectId,
      topicId: data.topicId,
      title: data.title,
      description: data.description,
      taskType: data.taskType,
      priority: data.priority,
      dueDate: data.dueDate,
      estimatedMinutes: data.estimatedMinutes,
      isRecurring: data.isRecurring,
      recurringPattern: data.recurringPattern
    });
  }

  async updateTask(userId, taskId, data) {
    const task = await this.getTaskById(userId, taskId);

    const allowedFields = [
      'title',
      'description',
      'taskType',
      'priority',
      'status',
      'dueDate',
      'estimatedMinutes',
      'isRecurring',
      'recurringPattern',
      'subjectId',
      'topicId'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    // Auto-set completedAt when status changes to completed
    if (updateData.status === 'completed' && task.status !== 'completed') {
      updateData.completedAt = new Date();
    }

    await task.update(updateData);
    return this.getTaskById(userId, taskId);
  }

  async deleteTask(userId, taskId) {
    const task = await this.getTaskById(userId, taskId);
    await task.destroy();
  }

  async completeTask(userId, taskId, actualMinutes = null) {
    const task = await this.getTaskById(userId, taskId);

    if (task.status === 'completed') {
      throw ApiError.badRequest('Task is already completed');
    }

    await task.update({
      status: 'completed',
      completedAt: new Date(),
      actualMinutes
    });

    return task;
  }

  async getDueSoon(userId, days = 7) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    return Task.findAll({
      where: {
        userId,
        status: { [Op.in]: ['pending', 'in_progress'] },
        dueDate: {
          [Op.gte]: now,
          [Op.lte]: futureDate
        }
      },
      include: [{ model: Subject, as: 'subject', attributes: ['id', 'name', 'color'] }],
      order: [['dueDate', 'ASC']]
    });
  }

  async getOverdue(userId) {
    return Task.findAll({
      where: {
        userId,
        status: { [Op.in]: ['pending', 'in_progress'] },
        dueDate: { [Op.lt]: new Date() }
      },
      include: [{ model: Subject, as: 'subject', attributes: ['id', 'name', 'color'] }],
      order: [['dueDate', 'ASC']]
    });
  }

  async getTaskStats(userId) {
    const tasks = await Task.findAll({ where: { userId } });

    const stats = {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
      overdue: 0,
      completionRate: 0
    };

    const now = new Date();
    stats.overdue = tasks.filter(
      (t) => ['pending', 'in_progress'].includes(t.status) && t.dueDate && new Date(t.dueDate) < now
    ).length;

    const completable = stats.total - stats.cancelled;
    stats.completionRate = completable > 0 ? Math.round((stats.completed / completable) * 100) : 0;

    return stats;
  }
}

module.exports = new TaskService();
