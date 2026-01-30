/**
 * Goals Controller
 */
const { goalsService } = require('../services');

class GoalsController {
  async getGoals(req, res, next) {
    try {
      const { status } = req.query;
      const goals = await goalsService.getGoals(req.user.sub, { status });
      res.json({ success: true, data: { goals } });
    } catch (error) {
      next(error);
    }
  }

  async getGoal(req, res, next) {
    try {
      const goal = await goalsService.getGoalById(req.user.sub, req.params.goalId);
      res.json({ success: true, data: { goal } });
    } catch (error) {
      next(error);
    }
  }

  async createGoal(req, res, next) {
    try {
      const goal = await goalsService.createGoal(req.user.sub, req.body);
      res.status(201).json({ success: true, data: { goal } });
    } catch (error) {
      next(error);
    }
  }

  async updateGoal(req, res, next) {
    try {
      const goal = await goalsService.updateGoal(req.user.sub, req.params.goalId, req.body);
      res.json({ success: true, data: { goal } });
    } catch (error) {
      next(error);
    }
  }

  async deleteGoal(req, res, next) {
    try {
      await goalsService.deleteGoal(req.user.sub, req.params.goalId);
      res.json({ success: true, message: 'Goal deleted' });
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const stats = await goalsService.getGoalStats(req.user.sub);
      res.json({ success: true, data: { stats } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new GoalsController();
