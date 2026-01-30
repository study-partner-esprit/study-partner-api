/**
 * Role Controller
 * Handles role management endpoints
 */
const { roleService } = require('../services');

class RoleController {
  /**
   * GET /roles
   */
  async getAllRoles(req, res, next) {
    try {
      const roles = await roleService.getAllRoles();

      res.json({
        success: true,
        data: { roles }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /roles
   * Admin only
   */
  async createRole(req, res, next) {
    try {
      const { name, description } = req.body;
      const role = await roleService.createRole({ name, description });

      res.status(201).json({
        success: true,
        message: 'Role created successfully',
        data: { role }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /roles/:roleId
   * Admin only
   */
  async deleteRole(req, res, next) {
    try {
      const { roleId } = req.params;
      await roleService.deleteRole(roleId);

      res.json({
        success: true,
        message: 'Role deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /users/:userId/roles
   */
  async getUserRoles(req, res, next) {
    try {
      const { userId } = req.params;
      const roles = await roleService.getUserRoles(userId);

      res.json({
        success: true,
        data: { roles }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /users/:userId/roles
   * Admin only
   */
  async assignRole(req, res, next) {
    try {
      const { userId } = req.params;
      const { roleId } = req.body;

      const assignment = await roleService.assignRole(userId, roleId);

      res.status(201).json({
        success: true,
        message: 'Role assigned successfully',
        data: assignment
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /users/:userId/roles/:roleId
   * Admin only
   */
  async removeRole(req, res, next) {
    try {
      const { userId, roleId } = req.params;
      await roleService.removeRole(userId, roleId);

      res.json({
        success: true,
        message: 'Role removed successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new RoleController();
