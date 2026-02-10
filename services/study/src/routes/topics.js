const express = require('express');
const Joi = require('joi');
const { Topic } = require('../models');

const router = express.Router();

// Validation schemas
const createTopicSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().optional(),
  category: Joi.string().optional(),
  color: Joi.string().optional()
});

const updateTopicSchema = Joi.object({
  name: Joi.string().optional(),
  description: Joi.string().optional(),
  category: Joi.string().optional(),
  color: Joi.string().optional(),
  mastery: Joi.number().min(0).max(100).optional()
});

// Get all topics
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  
  const topics = await Topic.find({ userId }).sort({ name: 1 });
  
  res.json({ topics });
});

// Get topic by ID
router.get('/:topicId', async (req, res) => {
  const userId = req.user.userId;
  const { topicId } = req.params;
  
  const topic = await Topic.findOne({ _id: topicId, userId });
  
  if (!topic) {
    return res.status(404).json({ error: 'Topic not found' });
  }
  
  res.json({ topic });
});

// Create topic
router.post('/', async (req, res) => {
  const { error } = createTopicSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  
  const topic = await Topic.create({
    userId,
    ...req.body
  });
  
  res.status(201).json({ 
    message: 'Topic created',
    topic 
  });
});

// Update topic
router.put('/:topicId', async (req, res) => {
  const { error } = updateTopicSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { topicId } = req.params;
  
  const topic = await Topic.findOne({ _id: topicId, userId });
  
  if (!topic) {
    return res.status(404).json({ error: 'Topic not found' });
  }
  
  Object.assign(topic, req.body);
  await topic.save();
  
  res.json({ 
    message: 'Topic updated',
    topic 
  });
});

// Delete topic
router.delete('/:topicId', async (req, res) => {
  const userId = req.user.userId;
  const { topicId } = req.params;
  
  const result = await Topic.deleteOne({ _id: topicId, userId });
  
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Topic not found' });
  }
  
  res.json({ message: 'Topic deleted' });
});

module.exports = router;
