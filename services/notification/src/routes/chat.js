const express = require('express');
const Joi = require('joi');
const { processSearchQuery, getHistory, deleteMessage } = require('../services/chatService');

const router = express.Router();

const querySchema = Joi.object({
  query: Joi.string().trim().min(2).max(1000).required()
});

router.get('/:sessionId/history', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const offset = Number(req.query.offset || 0);

    const items = await getHistory({ sessionId, limit, offset });
    res.json({ sessionId, items, count: items.length });
  } catch (err) {
    next(err);
  }
});

router.post('/:sessionId/query', async (req, res, next) => {
  try {
    const { error, value } = querySchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const result = await processSearchQuery({
      sessionId: req.params.sessionId,
      userId: req.user.userId,
      query: value.query
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:sessionId/:messageId', async (req, res, next) => {
  try {
    const result = await deleteMessage({
      sessionId: req.params.sessionId,
      messageId: req.params.messageId,
      userId: req.user.userId
    });

    if (!result.deleted && result.reason === 'forbidden') {
      return res.status(403).json({ error: 'Not allowed to delete this message' });
    }

    if (!result.deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({ deleted: true, messageId: req.params.messageId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
