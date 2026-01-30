/**
 * Task Controller
 */
const { taskService } = require('../services');

class TaskController {
  async getTasks(req, res, next) {
    try {
      const tasks = await taskService.getTasks(req.user.sub, req.query);
      res.json({ success: true, data: { tasks } });
    } catch (error) {
      next(error);
    }
  }

  async getTask(req, res, next) {
    try {
      const task = await taskService.getTaskById(req.user.sub, req.params.taskId);
      res.json({ success: true, data: { task } });
    } catch (error) {
      next(error);
    }
  }

  async createTask(req, res, next) {
    try {
      const task = await taskService.createTask(req.user.sub, req.body);
      res.status(201).json({ success: true, data: { task } });
    } catch (error) {
      next(error);
    }
  }

  async updateTask(req, res, next) {
    try {
      const task = await taskService.updateTask(req.user.sub, req.params.taskId, req.body);
      res.json({ success: true, data: { task } });
    } catch (error) {
      next(error);
    }
  }

  async deleteTask(req, res, next) {
    try {
      await taskService.deleteTask(req.user.sub, req.params.taskId);
      res.json({ success: true, message: 'Task deleted' });
    } catch (error) {
      next(error);
    }
  }

  async completeTask(req, res, next) {
    try {
      const { actualMinutes } = req.body;
      const task = await taskService.completeTask(req.user.sub, req.params.taskId, actualMinutes);
      res.json({ success: true, data: { task } });
    } catch (error) {
      next(error);
    }
  }

  async getDueSoon(req, res, next) {
    try {
      const { days } = req.query;
      const tasks = await taskService.getDueSoon(req.user.sub, days ? parseInt(days) : 7);
      res.json({ success: true, data: { tasks } });
    } catch (error) {
      next(error);
    }
  }

  async getOverdue(req, res, next) {
    try {
      const tasks = await taskService.getOverdue(req.user.sub);
      res.json({ success: true, data: { tasks } });
    } catch (error) {
      next(error);
    }
  }

  async getStats(req, res, next) {
    try {
      const stats = await taskService.getTaskStats(req.user.sub);
      res.json({ success: true, data: { stats } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TaskController();
