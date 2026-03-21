const express = require('express');
const Joi = require('joi');
const {
  startVoiceSession,
  endVoiceSession,
  getVoiceStatus,
  joinParticipant,
  leaveParticipant,
  updateMute
} = require('../services/voiceService');

const router = express.Router();

const participantSchema = Joi.object({
  peerId: Joi.string().allow('').optional()
});

const muteSchema = Joi.object({
  isMuted: Joi.boolean().required()
});

router.post('/:sessionId/start', async (req, res, next) => {
  try {
    const session = await startVoiceSession(req.params.sessionId);
    res.status(201).json({ sessionId: session.sessionId, isActive: session.isActive });
  } catch (err) {
    next(err);
  }
});

router.post('/:sessionId/end', async (req, res, next) => {
  try {
    const session = await endVoiceSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Voice session not found' });
    res.json({ sessionId: session.sessionId, isActive: session.isActive });
  } catch (err) {
    next(err);
  }
});

router.get('/:sessionId/status', async (req, res, next) => {
  try {
    const status = await getVoiceStatus(req.params.sessionId);
    if (!status) return res.status(404).json({ error: 'Voice session not found' });
    res.json(status);
  } catch (err) {
    next(err);
  }
});

router.post('/:sessionId/participant', async (req, res, next) => {
  try {
    const { error, value } = participantSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const session = await joinParticipant({
      sessionId: req.params.sessionId,
      userId: req.user.userId,
      peerId: value.peerId || ''
    });

    res.status(201).json({ sessionId: session.sessionId, participants: session.participants });
  } catch (err) {
    next(err);
  }
});

router.delete('/:sessionId/participant', async (req, res, next) => {
  try {
    const session = await leaveParticipant({
      sessionId: req.params.sessionId,
      userId: req.user.userId
    });

    if (!session) return res.status(404).json({ error: 'Voice session not found' });
    res.json({ sessionId: session.sessionId, left: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:sessionId/mute', async (req, res, next) => {
  try {
    const { error, value } = muteSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const session = await updateMute({
      sessionId: req.params.sessionId,
      userId: req.user.userId,
      isMuted: value.isMuted
    });

    if (!session) return res.status(404).json({ error: 'Voice session not found' });
    res.json({ sessionId: session.sessionId, isMuted: value.isMuted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
