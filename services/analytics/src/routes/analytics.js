const express = require('express');
const Joi = require('joi');
const AnalyticsEvent = require('../models/AnalyticsEvent');

const router = express.Router();

// Validation schema
const trackEventSchema = Joi.object({
  eventType: Joi.string().valid(
    'study_session_started',
    'study_session_completed',
    'task_created',
    'task_completed',
    'course_ingested',
    'plan_generated',
    'focus_tracked',
    'login',
    'profile_updated'
  ).required(),
  metadata: Joi.object().optional()
});

// Track an event
router.post('/track', async (req, res) => {
  const { error } = trackEventSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const userId = req.user.userId;
  const { eventType, metadata } = req.body;

  await AnalyticsEvent.create({
    userId,
    eventType,
    metadata
  });

  res.status(201).json({ message: 'Event tracked' });
});

// Get user activity timeline
router.get('/timeline', async (req, res) => {
  const userId = req.user.userId;
  const { startDate, endDate, limit = 50 } = req.query;

  const filter = { userId };
  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = new Date(startDate);
    if (endDate) filter.timestamp.$lte = new Date(endDate);
  }

  const events = await AnalyticsEvent.find(filter)
    .sort({ timestamp: -1 })
    .limit(parseInt(limit));

  res.json({ events });
});

// Get activity summary
router.get('/summary', async (req, res) => {
  const userId = req.user.userId;
  const { startDate, endDate } = req.query;

  const filter = { userId };
  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = new Date(startDate);
    if (endDate) filter.timestamp.$lte = new Date(endDate);
  }

  const events = await AnalyticsEvent.find(filter);

  // Count events by type
  const eventCounts = events.reduce((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] || 0) + 1;
    return acc;
  }, {});

  // Calculate streaks
  const dailyActivity = {};
  events.forEach(event => {
    const date = event.timestamp.toISOString().split('T')[0];
    dailyActivity[date] = true;
  });

  const sortedDates = Object.keys(dailyActivity).sort();
  let currentStreak = 0;
  let longestStreak = 0;
  let streakCount = 0;

  for (let i = sortedDates.length - 1; i >= 0; i--) {
    if (i === sortedDates.length - 1 || 
        new Date(sortedDates[i + 1]) - new Date(sortedDates[i]) === 86400000) {
      streakCount++;
      currentStreak = streakCount;
      longestStreak = Math.max(longestStreak, streakCount);
    } else {
      streakCount = 1;
    }
  }

  res.json({
    totalEvents: events.length,
    eventCounts,
    activeDays: Object.keys(dailyActivity).length,
    currentStreak,
    longestStreak
  });
});

// Get event statistics by type
router.get('/stats/:eventType', async (req, res) => {
  const userId = req.user.userId;
  const { eventType } = req.params;
  const { startDate, endDate } = req.query;

  const filter = { userId, eventType };
  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = new Date(startDate);
    if (endDate) filter.timestamp.$lte = new Date(endDate);
  }

  const events = await AnalyticsEvent.find(filter);

  // Group by day
  const dailyStats = events.reduce((acc, event) => {
    const date = event.timestamp.toISOString().split('T')[0];
    if (!acc[date]) {
      acc[date] = { count: 0, events: [] };
    }
    acc[date].count++;
    acc[date].events.push(event);
    return acc;
  }, {});

  res.json({
    eventType,
    totalCount: events.length,
    dailyStats
  });
});

// Get insights
router.get('/insights', async (req, res) => {
  const userId = req.user.userId;
  const { days = 30 } = req.query;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(days));

  const events = await AnalyticsEvent.find({
    userId,
    timestamp: { $gte: startDate }
  });

  // Calculate insights
  const studySessions = events.filter(e => e.eventType === 'study_session_completed');
  const completedTasks = events.filter(e => e.eventType === 'task_completed');
  
  const totalStudyTime = studySessions.reduce((sum, e) => {
    return sum + (e.metadata?.duration || 0);
  }, 0);

  const avgStudyTime = studySessions.length > 0 
    ? totalStudyTime / studySessions.length 
    : 0;

  // Calculate most active day of the week
  const dayOfWeekCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const dayOfWeekDuration = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const session of studySessions) {
    const dayOfWeek = new Date(session.timestamp).getDay();
    dayOfWeekCount[dayOfWeek]++;
    dayOfWeekDuration[dayOfWeek] += (session.metadata?.duration || 0);
  }

  // Find the day with the highest weighted activity score
  let mostActiveDay = null;
  let maxScore = 0;

  for (let day = 0; day < 7; day++) {
    // Weighted score: frequency (40%) + total study duration (60%)
    const frequencyScore = dayOfWeekCount[day];
    const durationScore = dayOfWeekDuration[day];
    const score = frequencyScore * 0.4 + durationScore * 0.6;

    if (score > maxScore) {
      maxScore = score;
      mostActiveDay = {
        day: day,
        name: dayNames[day],
        sessionCount: dayOfWeekCount[day],
        totalDuration: Math.round(dayOfWeekDuration[day]),
        avgDuration: dayOfWeekCount[day] > 0 ? Math.round(dayOfWeekDuration[day] / dayOfWeekCount[day]) : 0
      };
    }
  }

  // Calculate peak study hours (group by hour of day)
  const hourlyActivity = {};
  for (const session of studySessions) {
    const hour = new Date(session.timestamp).getHours();
    if (!hourlyActivity[hour]) {
      hourlyActivity[hour] = { count: 0, totalDuration: 0 };
    }
    hourlyActivity[hour].count++;
    hourlyActivity[hour].totalDuration += (session.metadata?.duration || 0);
  }

  let peakHour = null;
  let maxHourScore = 0;
  for (const [hour, data] of Object.entries(hourlyActivity)) {
    if (data.count > maxHourScore) {
      maxHourScore = data.count;
      peakHour = parseInt(hour);
    }
  }

  // Weekly consistency: how many distinct days of the week had at least one study session
  const activeDaysCount = Object.values(dayOfWeekCount).filter(count => count > 0).length;
  const weeklyConsistencyScore = Math.round((activeDaysCount / 7) * 100);

  const insights = {
    period: `${days} days`,
    studySessions: studySessions.length,
    completedTasks: completedTasks.length,
    totalStudyTime: Math.round(totalStudyTime),
    avgStudyTime: Math.round(avgStudyTime),
    mostActiveDay: mostActiveDay,
    peakStudyHour: peakHour !== null ? `${peakHour}:00 - ${peakHour + 1}:00` : null,
    weeklyConsistency: weeklyConsistencyScore,
    dayOfWeekBreakdown: dayNames.map((name, i) => ({
      day: name,
      sessions: dayOfWeekCount[i],
      totalDuration: Math.round(dayOfWeekDuration[i])
    })),
    productivity: completedTasks.length > 0 
      ? Math.round((completedTasks.length / (completedTasks.length + studySessions.length)) * 100)
      : 0
  };

  res.json({ insights });
});

module.exports = router;
