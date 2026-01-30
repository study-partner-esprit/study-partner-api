/**
 * Subject Controller
 */
const { subjectService } = require('../services');

class SubjectController {
  async getSubjects(req, res, next) {
    try {
      const { includeArchived } = req.query;
      const subjects = await subjectService.getSubjects(req.user.sub, includeArchived === 'true');
      res.json({ success: true, data: { subjects } });
    } catch (error) {
      next(error);
    }
  }

  async getSubject(req, res, next) {
    try {
      const subject = await subjectService.getSubjectById(req.user.sub, req.params.subjectId);
      res.json({ success: true, data: { subject } });
    } catch (error) {
      next(error);
    }
  }

  async createSubject(req, res, next) {
    try {
      const subject = await subjectService.createSubject(req.user.sub, req.body);
      res.status(201).json({ success: true, data: { subject } });
    } catch (error) {
      next(error);
    }
  }

  async updateSubject(req, res, next) {
    try {
      const subject = await subjectService.updateSubject(
        req.user.sub,
        req.params.subjectId,
        req.body
      );
      res.json({ success: true, data: { subject } });
    } catch (error) {
      next(error);
    }
  }

  async deleteSubject(req, res, next) {
    try {
      await subjectService.deleteSubject(req.user.sub, req.params.subjectId);
      res.json({ success: true, message: 'Subject deleted' });
    } catch (error) {
      next(error);
    }
  }

  async getSubjectStats(req, res, next) {
    try {
      const stats = await subjectService.getSubjectStats(req.user.sub, req.params.subjectId);
      res.json({ success: true, data: { stats } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubjectController();
