/**
 * Session Controller
 */
const { sessionService } = require('../services');

class SessionController {
  async getSessions(req, res, next) {
    try {
      const sessions = await sessionService.getSessions(req.user.sub, req.query);
      res.json({ success: true, data: { sessions } });
    } catch (error) {
      next(error);
    }
  }

  async getSession(req, res, next) {
    try {
      const session = await sessionService.getSessionById(req.user.sub, req.params.sessionId);
      res.json({ success: true, data: { session } });
    } catch (error) {
      next(error);
    }
  }

  async createSession(req, res, next) {
    try {
      const session = await sessionService.createSession(req.user.sub, req.body);
      res.status(201).json({ success: true, data: { session } });
    } catch (error) {
      next(error);
    }
  }

  async startSession(req, res, next) {
    try {
      const session = await sessionService.startSession(req.user.sub, req.params.sessionId);
      res.json({ success: true, data: { session } });
    } catch (error) {
      next(error);
    }
  }

  async endSession(req, res, next) {
    try {
      const session = await sessionService.endSession(req.user.sub, req.params.sessionId, req.body);
      res.json({ success: true, data: { session } });
    } catch (error) {
      next(error);
    }
  }

  async cancelSession(req, res, next) {
    try {
      const session = await sessionService.cancelSession(req.user.sub, req.params.sessionId);
      res.json({ success: true, data: { session } });
    } catch (error) {
      next(error);
    }
  }

  async getActiveSession(req, res, next) {
    try {
      const session = await sessionService.getActiveSession(req.user.sub);
      res.json({ success: true, data: { session } });
    } catch (error) {
      next(error);
    }
  }

  async getTodayStats(req, res, next) {
    try {
      const stats = await sessionService.getTodayStats(req.user.sub);
      res.json({ success: true, data: { stats } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SessionController();
