/**
 * Models Index
 * Setup associations and export all models
 */
const User = require('./user.model');
const Credential = require('./credential.model');
const Role = require('./role.model');
const UserRole = require('./userRole.model');
const RefreshToken = require('./refreshToken.model');

// ==================== ASSOCIATIONS ====================

// User <-> Credential (1:1)
User.hasOne(Credential, {
  foreignKey: 'userId',
  as: 'credential',
  onDelete: 'CASCADE'
});
Credential.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// User <-> Role (M:N through UserRole)
User.belongsToMany(Role, {
  through: UserRole,
  foreignKey: 'userId',
  otherKey: 'roleId',
  as: 'roles'
});
Role.belongsToMany(User, {
  through: UserRole,
  foreignKey: 'roleId',
  otherKey: 'userId',
  as: 'users'
});

// User <-> RefreshToken (1:M)
User.hasMany(RefreshToken, {
  foreignKey: 'userId',
  as: 'refreshTokens',
  onDelete: 'CASCADE'
});
RefreshToken.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

module.exports = {
  User,
  Credential,
  Role,
  UserRole,
  RefreshToken
};
