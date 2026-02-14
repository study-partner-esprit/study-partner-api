const mongoose = require('mongoose');

const availabilitySlotSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  dayOfWeek: {
    type: String,
    required: true,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  isRecurring: {
    type: Boolean,
    default: true
  },
  color: {
    type: String,
    default: '#ff6b6b'
  }
}, {
  timestamps: true
});

// Index for efficient queries
availabilitySlotSchema.index({ userId: 1, dayOfWeek: 1 });

const AvailabilitySlot = mongoose.model('AvailabilitySlot', availabilitySlotSchema);

module.exports = AvailabilitySlot;
