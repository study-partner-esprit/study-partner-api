const express = require('express');
const Joi = require('joi');
// const { hashPassword, verifyPassword, generateToken } = require('@study-partner/shared');
const User = require('../models/User');

// Temporary implementations until shared package is fixed
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });
};

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  name: Joi.string().required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Register
router.post('/register', async (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { email, password, name } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ error: 'User already exists' });
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user
  const user = await User.create({
    email,
    password: hashedPassword,
    name
  });

  // Generate token
  const token = generateToken({
    userId: user._id,
    email: user.email,
    role: user.role
  });

  res.status(201).json({
    message: 'User registered successfully',
    user: user.toJSON(),
    token
  });
});

// Login
router.post('/login', async (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate token
  const token = generateToken({
    userId: user._id,
    email: user.email,
    role: user.role
  });

  res.json({
    message: 'Login successful',
    user: user.toJSON(),
    token
  });
});

// Get current user (protected route)
router.get('/me', async (req, res) => {
  // User is attached to req by authenticate middleware
  const user = await User.findById(req.user.userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user: user.toJSON() });
});

module.exports = router;
