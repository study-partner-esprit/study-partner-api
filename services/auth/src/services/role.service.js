/**
 * Role Service
 * Handles role management
 */
const { Role, User, UserRole } = require('../models');
const { ApiError } = require('@study-partner/shared-utils');

class RoleService {
  /**
   * Get all roles
   * @returns {Promise<Array>}
   */
  async getAllRoles() {
    const roles = await Role.findAll({
      attributes: ['id', 'name', 'description'],
      order: [['name', 'ASC']],
    });
    return roles;
  }

  /**
   * Create a new role
   * @param {Object} data - { name, description }
   * @returns {Promise<Object>}
   */
  async createRole({ name, description }) {
    const existingRole = await Role.findOne({ where: { name } });
    if (existingRole) {
      throw ApiError.conflict('Role already exists');
    }
    
    const role = await Role.create({ name, description });
    return {
      id: role.id,
      name: role.name,
      description: role.description,
    };
  }

  /**
   * Delete a role
   * @param {number} roleId
   */
  async deleteRole(roleId) {
    const role = await Role.findByPk(roleId);
    if (!role) {
      throw ApiError.notFound('Role not found');
    }
    
    // Prevent deletion of default roles
    if (['student', 'admin'].includes(role.name)) {
      throw ApiError.badRequest('Cannot delete default roles');
    }
    
    await role.destroy();
  }

  /**
   * Get user's roles
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getUserRoles(userId) {
    const user = await User.findByPk(userId, {
      include: [{ model: Role, as: 'roles', attributes: ['id', 'name', 'description'] }],
    });
    
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    
    return user.roles;
  }

  /**
   * Assign role to user
   * @param {string} userId
   * @param {number} roleId
   * @returns {Promise<Object>}
   */
  async assignRole(userId, roleId) {
    const user = await User.findByPk(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    
    const role = await Role.findByPk(roleId);
    if (!role) {
      throw ApiError.notFound('Role not found');
    }
    
    // Check if already assigned
    const existing = await UserRole.findOne({
      where: { userId, roleId },
    });
    
    if (existing) {
      throw ApiError.conflict('Role already assigned to user');
    }
    
    await user.addRole(role);
    
    return {
      userId,
      roleId,
      roleName: role.name,
      assignedAt: new Date(),
    };
  }

  /**
   * Remove role from user
   * @param {string} userId
   * @param {number} roleId
   */
  async removeRole(userId, roleId) {
    const user = await User.findByPk(userId);
    if (!user) {
      throw ApiError.notFound('User not found');
    }
    
    const role = await Role.findByPk(roleId);
    if (!role) {
      throw ApiError.notFound('Role not found');
    }
    
    await user.removeRole(role);
  }

  /**
   * Seed default roles
   */
  async seedDefaultRoles() {
    const defaultRoles = [
      { name: 'student', description: 'Regular student user' },
      { name: 'admin', description: 'Administrator with full access' },
      { name: 'moderator', description: 'Content moderator' },
    ];
    
    for (const roleData of defaultRoles) {
      await Role.findOrCreate({
        where: { name: roleData.name },
        defaults: roleData,
      });
    }
  }
}

module.exports = new RoleService();
