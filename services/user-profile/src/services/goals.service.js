/**
 * Learning Goals Service
 */
const { LearningGoal } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');

class GoalsService {
  /**
   * Get all goals for user
   */
  async getGoals(userId, filters = {}) {
    const where = { userId };

    if (filters.status) {
      where.status = filters.status;
    }

    const goals = await LearningGoal.findAll({
      where,
      order: [
        ['priority', 'DESC'],
        ['createdAt', 'DESC']
      ]
    });

    return goals;
  }

  /**
   * Get single goal
   */
  async getGoalById(userId, goalId) {
    const goal = await LearningGoal.findOne({
      where: { id: goalId, userId }
    });

    if (!goal) {
      throw ApiError.notFound('Goal not found');
    }

    return goal;
  }

  /**
   * Create goal
   */
  async createGoal(userId, data) {
    const goal = await LearningGoal.create({
      userId,
      title: data.title,
      description: data.description,
      category: data.category,
      targetDate: data.targetDate,
      priority: data.priority || 'medium'
    });

    return goal;
  }

  /**
   * Update goal
   */
  async updateGoal(userId, goalId, data) {
    const goal = await this.getGoalById(userId, goalId);

    const allowedFields = [
      'title',
      'description',
      'category',
      'targetDate',
      'priority',
      'status',
      'progressPercent'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    // Auto-complete if progress reaches 100%
    if (updateData.progressPercent === 100 && goal.status === 'active') {
      updateData.status = 'completed';
      updateData.completedAt = new Date();
    }

    await goal.update(updateData);
    return goal;
  }

  /**
   * Delete goal
   */
  async deleteGoal(userId, goalId) {
    const goal = await this.getGoalById(userId, goalId);
    await goal.destroy();
  }

  /**
   * Get goal statistics
   */
  async getGoalStats(userId) {
    const goals = await LearningGoal.findAll({ where: { userId } });

    const stats = {
      total: goals.length,
      active: goals.filter((g) => g.status === 'active').length,
      completed: goals.filter((g) => g.status === 'completed').length,
      paused: goals.filter((g) => g.status === 'paused').length,
      abandoned: goals.filter((g) => g.status === 'abandoned').length,
      averageProgress: 0
    };

    const activeGoals = goals.filter((g) => g.status === 'active');
    if (activeGoals.length > 0) {
      stats.averageProgress = Math.round(
        activeGoals.reduce((sum, g) => sum + g.progressPercent, 0) / activeGoals.length
      );
    }

    return stats;
  }
}

module.exports = new GoalsService();
