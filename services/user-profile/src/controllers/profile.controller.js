/**
 * Profile Controller
 */
const { profileService } = require('../services');

class ProfileController {
  async getProfile(req, res, next) {
    try {
      const profile = await profileService.getOrCreateProfile(req.user.sub);
      res.json({ success: true, data: { profile } });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const profile = await profileService.updateProfile(req.user.sub, req.body);
      res.json({ success: true, data: { profile } });
    } catch (error) {
      next(error);
    }
  }

  async completeOnboarding(req, res, next) {
    try {
      await profileService.completeOnboarding(req.user.sub);
      res.json({ success: true, message: 'Onboarding completed' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProfileController();
