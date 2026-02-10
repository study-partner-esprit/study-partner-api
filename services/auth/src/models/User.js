const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['student', 'admin'],
    default: 'student'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  refreshTokens: [{
    token: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastLogin: {
    type: Date
  }
}, {
  timestamps: true
});

// Remove password from JSON representation
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.refreshTokens;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
