/**
 * Auth Controller
 * Handles authentication endpoints
 */
const { authService } = require('../services');
const { ApiError } = require('@study-partner/shared-utils');

class AuthController {
  /**
   * POST /auth/register
   */
  async register(req, res, next) {
    try {
      const { email, password } = req.body;
      const user = await authService.register({ email, password });

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: { user }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/login
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const meta = {
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      };

      const { user, accessToken, refreshToken } = await authService.login(
        { email, password },
        meta
      );

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user,
          accessToken,
          refreshToken
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/refresh
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw ApiError.badRequest('Refresh token is required');
      }

      const meta = {
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip
      };

      const tokens = await authService.refreshToken(refreshToken, meta);

      res.json({
        success: true,
        data: tokens
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/logout
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        await authService.logout(refreshToken);
      }

      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /auth/logout-all
   * Requires authentication
   */
  async logoutAll(req, res, next) {
    try {
      await authService.logoutAll(req.user.sub);

      res.json({
        success: true,
        message: 'Logged out from all devices'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /auth/me
   * Requires authentication
   */
  async me(req, res, next) {
    try {
      const user = await authService.getUserById(req.user.sub);

      res.json({
        success: true,
        data: { user }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
