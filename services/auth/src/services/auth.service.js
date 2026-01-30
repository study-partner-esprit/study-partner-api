/**
 * Auth Service
 * Handles authentication logic: login, register, tokens
 */
const { User, Credential, Role, RefreshToken } = require('../models');
const { generateAccessToken, getExpirationMs } = require('../utils/jwt');
const { ApiError } = require('@study-partner/shared-utils');
const config = require('../config');
const { sequelize } = require('../config/database');

class AuthService {
  /**
   * Register a new user
   * @param {Object} data - { email, password }
   * @returns {Promise<Object>} - User object
   */
  async register({ email, password }) {
    const transaction = await sequelize.transaction();
    
    try {
      // Check if user exists
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        throw ApiError.conflict('Email already registered');
      }
      
      // Create user
      const user = await User.create({ email }, { transaction });
      
      // Create credential (password will be hashed by hook)
      await Credential.create({
        userId: user.id,
        passwordHash: password,
      }, { transaction });
      
      // Assign default role (student)
      const studentRole = await Role.findOne({ where: { name: 'student' } });
      if (studentRole) {
        await user.addRole(studentRole, { transaction });
      }
      
      await transaction.commit();
      
      // Fetch user with roles
      const newUser = await User.findByPk(user.id, {
        include: [{ model: Role, as: 'roles', attributes: ['name'] }],
      });
      
      return {
        id: newUser.id,
        email: newUser.email,
        status: newUser.status,
        roles: newUser.roles.map(r => r.name),
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Login user
   * @param {Object} data - { email, password }
   * @param {Object} meta - { userAgent, ipAddress }
   * @returns {Promise<Object>} - { user, accessToken, refreshToken }
   */
  async login({ email, password }, meta = {}) {
    // Find user with credential
    const user = await User.findOne({
      where: { email },
      include: [
        { model: Credential, as: 'credential' },
        { model: Role, as: 'roles', attributes: ['name'] },
      ],
    });
    
    if (!user || !user.credential) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    
    if (user.status !== 'active') {
      throw ApiError.forbidden('Account is not active');
    }
    
    // Verify password
    const isValidPassword = await user.credential.verifyPassword(password);
    if (!isValidPassword) {
      throw ApiError.unauthorized('Invalid email or password');
    }
    
    // Generate tokens
    const accessToken = this._generateAccessToken(user);
    const refreshToken = await this._createRefreshToken(user.id, meta);
    
    return {
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        roles: user.roles.map(r => r.name),
      },
      accessToken,
      refreshToken: refreshToken.token,
    };
  }

  /**
   * Refresh access token
   * @param {string} token - Refresh token
   * @param {Object} meta - { userAgent, ipAddress }
   * @returns {Promise<Object>} - { accessToken, refreshToken }
   */
  async refreshToken(token, meta = {}) {
    const refreshToken = await RefreshToken.findOne({
      where: { token },
      include: [{ 
        model: User, 
        as: 'user',
        include: [{ model: Role, as: 'roles', attributes: ['name'] }],
      }],
    });
    
    if (!refreshToken) {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    
    if (!refreshToken.isActive()) {
      // Token reuse detection - revoke all tokens for this user
      if (refreshToken.revoked) {
        await RefreshToken.update(
          { revoked: true, revokedAt: new Date() },
          { where: { userId: refreshToken.userId } }
        );
      }
      throw ApiError.unauthorized('Refresh token is invalid or expired');
    }
    
    const { user } = refreshToken;
    if (user.status !== 'active') {
      throw ApiError.forbidden('Account is not active');
    }
    
    // Rotate refresh token
    const newRefreshToken = await this._rotateRefreshToken(refreshToken, meta);
    const accessToken = this._generateAccessToken(user);
    
    return {
      accessToken,
      refreshToken: newRefreshToken.token,
    };
  }

  /**
   * Logout - revoke refresh token
   * @param {string} token - Refresh token
   */
  async logout(token) {
    const refreshToken = await RefreshToken.findOne({ where: { token } });
    
    if (refreshToken && !refreshToken.revoked) {
      await refreshToken.update({
        revoked: true,
        revokedAt: new Date(),
      });
    }
  }

  /**
   * Logout from all devices
   * @param {string} userId
   */
  async logoutAll(userId) {
    await RefreshToken.update(
      { revoked: true, revokedAt: new Date() },
      { where: { userId, revoked: false } }
    );
  }

  /**
   * Get user by ID
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getUserById(userId) {
    const user = await User.findByPk(userId, {
      include: [{ model: Role, as: 'roles', attributes: ['name'] }],
    });
    
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles.map(r => r.name),
      createdAt: user.createdAt,
    };
  }

  // ==================== PRIVATE METHODS ====================

  _generateAccessToken(user) {
    return generateAccessToken({
      sub: user.id,
      email: user.email,
      roles: user.roles.map(r => r.name),
    });
  }

  async _createRefreshToken(userId, meta = {}) {
    const expiresAt = new Date(
      Date.now() + getExpirationMs(config.jwt.refreshExpiresIn)
    );
    
    return RefreshToken.create({
      userId,
      token: RefreshToken.generateToken(),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
  }

  async _rotateRefreshToken(oldToken, meta = {}) {
    const newToken = await this._createRefreshToken(oldToken.userId, meta);
    
    await oldToken.update({
      revoked: true,
      revokedAt: new Date(),
      replacedByToken: newToken.token,
    });
    
    return newToken;
  }
}

module.exports = new AuthService();
