/**
 * Preferences Controller
 */
const { preferencesService } = require('../services');

class PreferencesController {
  async getPreferences(req, res, next) {
    try {
      const preferences = await preferencesService.getPreferences(req.user.sub);
      res.json({ success: true, data: { preferences } });
    } catch (error) {
      next(error);
    }
  }

  async updatePreferences(req, res, next) {
    try {
      const preferences = await preferencesService.updatePreferences(req.user.sub, req.body);
      res.json({ success: true, data: { preferences } });
    } catch (error) {
      next(error);
    }
  }

  async resetPreferences(req, res, next) {
    try {
      const preferences = await preferencesService.resetPreferences(req.user.sub);
      res.json({ success: true, data: { preferences } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new PreferencesController();
