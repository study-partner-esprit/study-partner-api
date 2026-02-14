const express = require('express');
const Joi = require('joi');
const AvailabilitySlot = require('../models/AvailabilitySlot');

const router = express.Router();

// Validation schemas
const createSlotSchema = Joi.object({
  day_of_week: Joi.string()
    .valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
    .required(),
  start_time: Joi.string()
    .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .required(),
  end_time: Joi.string()
    .pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .required(),
  label: Joi.string().required(),
  is_recurring: Joi.boolean().default(true),
  color: Joi.string().default('#ff6b6b')
});

// Get all availability slots for current user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const slots = await AvailabilitySlot.find({ userId }).sort({ dayOfWeek: 1, startTime: 1 });
    
    // Convert to frontend format
    const formattedSlots = slots.map(slot => ({
      _id: slot._id.toString(),
      day_of_week: slot.dayOfWeek,
      start_time: slot.startTime,
      end_time: slot.endTime,
      label: slot.label,
      is_recurring: slot.isRecurring,
      color: slot.color,
      created_at: slot.createdAt,
      updated_at: slot.updatedAt
    }));
    
    res.json(formattedSlots);
  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Create new availability slot
router.post('/', async (req, res) => {
  try {
    const { error, value } = createSlotSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    
    const userId = req.user.userId;
    
    const slot = await AvailabilitySlot.create({
      userId,
      dayOfWeek: value.day_of_week,
      startTime: value.start_time,
      endTime: value.end_time,
      label: value.label,
      isRecurring: value.is_recurring,
      color: value.color
    });
    
    // Return in frontend format
    res.status(201).json({
      _id: slot._id.toString(),
      day_of_week: slot.dayOfWeek,
      start_time: slot.startTime,
      end_time: slot.endTime,
      label: slot.label,
      is_recurring: slot.isRecurring,
      color: slot.color,
      created_at: slot.createdAt,
      updated_at: slot.updatedAt
    });
  } catch (error) {
    console.error('Error creating availability slot:', error);
    res.status(500).json({ error: 'Failed to create availability slot' });
  }
});

// Delete availability slot
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const slotId = req.params.id;
    
    const result = await AvailabilitySlot.deleteOne({ _id: slotId, userId });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Slot not found' });
    }
    
    res.json({ status: 'success', message: 'Slot deleted' });
  } catch (error) {
    console.error('Error deleting availability slot:', error);
    res.status(500).json({ error: 'Failed to delete availability slot' });
  }
});

// Get free time slots (calculated from blocked slots)
router.get('/free-slots', async (req, res) => {
  try {
    const userId = req.user.userId;
    const durationMinutes = parseInt(req.query.duration_minutes) || 60;
    
    const blockedSlots = await AvailabilitySlot.find({ userId });
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const startHour = 7;
    const endHour = 21;
    const freeSlots = [];
    
    for (const day of days) {
      const dayBlocked = blockedSlots
        .filter(slot => slot.dayOfWeek === day)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      
      let currentTime = `${startHour.toString().padStart(2, '0')}:00`;
      const dayEnd = `${endHour.toString().padStart(2, '0')}:00`;
      
      for (const blocked of dayBlocked) {
        if (currentTime < blocked.startTime) {
          const startMinutes = parseInt(currentTime.split(':')[0]) * 60 + parseInt(currentTime.split(':')[1]);
          const endMinutes = parseInt(blocked.startTime.split(':')[0]) * 60 + parseInt(blocked.startTime.split(':')[1]);
          const duration = endMinutes - startMinutes;
          
          if (duration >= durationMinutes) {
            freeSlots.push({
              day_of_week: day,
              start_time: currentTime,
              end_time: blocked.startTime,
              duration_minutes: duration
            });
          }
        }
        currentTime = blocked.endTime;
      }
      
      // Check remaining time after last blocked slot
      if (currentTime < dayEnd) {
        const startMinutes = parseInt(currentTime.split(':')[0]) * 60 + parseInt(currentTime.split(':')[1]);
        const endMinutes = endHour * 60;
        const duration = endMinutes - startMinutes;
        
        if (duration >= durationMinutes) {
          freeSlots.push({
            day_of_week: day,
            start_time: currentTime,
            end_time: dayEnd,
            duration_minutes: duration
          });
        }
      }
    }
    
    res.json(freeSlots);
  } catch (error) {
    console.error('Error calculating free slots:', error);
    res.status(500).json({ error: 'Failed to calculate free slots' });
  }
});

module.exports = router;
