import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://host.docker.internal:27017/study_partner';
const EMAIL = process.argv[2] || 'kammounaziz12@gmail.com';
const SEED_BATCH = `seed-${Date.now()}`;

const dayStart = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const daysAgo = (days, hour, minute = 0) => {
  const d = dayStart(new Date());
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const sessionPlan = [
  { daysAgo: 29, hour: 9, duration: 60, tasks: 4, focus: 78, topic: 'Linear Algebra' },
  { daysAgo: 28, hour: 14, duration: 45, tasks: 3, focus: 72, topic: 'Calculus Review' },
  { daysAgo: 27, hour: 19, duration: 90, tasks: 5, focus: 85, topic: 'Data Structures' },
  { daysAgo: 26, hour: 10, duration: 60, tasks: 4, focus: 80, topic: 'Algorithms' },
  { daysAgo: 25, hour: 16, duration: 75, tasks: 4, focus: 83, topic: 'Operating Systems' },
  { daysAgo: 24, hour: 11, duration: 50, tasks: 3, focus: 75, topic: 'Networking' },
  { daysAgo: 23, hour: 20, duration: 40, tasks: 2, focus: 70, topic: 'Machine Learning' },
  { daysAgo: 22, hour: 9, duration: 55, tasks: 3, focus: 77, topic: 'Databases' },
  { daysAgo: 21, hour: 14, duration: 85, tasks: 5, focus: 88, topic: 'Security' },
  { daysAgo: 20, hour: 16, duration: 45, tasks: 3, focus: 72, topic: 'Web Development' },
  { daysAgo: 19, hour: 10, duration: 60, tasks: 4, focus: 79, topic: 'System Design' },
  { daysAgo: 18, hour: 18, duration: 50, tasks: 3, focus: 74, topic: 'Probability' },
  { daysAgo: 17, hour: 12, duration: 95, tasks: 6, focus: 90, topic: 'Statistics' },
  { daysAgo: 16, hour: 15, duration: 40, tasks: 2, focus: 68, topic: 'Exam Practice' },
  { daysAgo: 15, hour: 9, duration: 65, tasks: 4, focus: 82, topic: 'Capstone Review' },
  { daysAgo: 14, hour: 13, duration: 50, tasks: 3, focus: 76, topic: 'Flashcards' },
  { daysAgo: 13, hour: 18, duration: 70, tasks: 4, focus: 84, topic: 'Final Review' },
  { daysAgo: 12, hour: 10, duration: 55, tasks: 3, focus: 78, topic: 'Review Session' },
  { daysAgo: 11, hour: 16, duration: 80, tasks: 5, focus: 87, topic: 'Deep Dive' },
  { daysAgo: 10, hour: 11, duration: 45, tasks: 3, focus: 73, topic: 'Quick Review' },
  { daysAgo: 9, hour: 14, duration: 90, tasks: 5, focus: 89, topic: 'Project Work' },
  { daysAgo: 8, hour: 9, duration: 60, tasks: 4, focus: 81, topic: 'Reading' },
  { daysAgo: 7, hour: 17, duration: 50, tasks: 3, focus: 75, topic: 'Practice Problems' },
  { daysAgo: 6, hour: 10, duration: 40, tasks: 2, focus: 69, topic: 'Quiz Prep' },
  { daysAgo: 5, hour: 15, duration: 75, tasks: 5, focus: 86, topic: 'Lab Work' },
  { daysAgo: 4, hour: 12, duration: 60, tasks: 4, focus: 80, topic: 'Group Study' },
  { daysAgo: 3, hour: 9, duration: 50, tasks: 3, focus: 77, topic: 'Review Notes' },
  { daysAgo: 2, hour: 13, duration: 85, tasks: 5, focus: 91, topic: 'Mock Exam' },
  { daysAgo: 1, hour: 16, duration: 45, tasks: 3, focus: 74, topic: 'Final Polish' },
  { daysAgo: 0, hour: 10, duration: 60, tasks: 4, focus: 85, topic: 'Last Minute Review' },
];

const buildEvents = (userId) => {
  const events = [];

  sessionPlan.forEach((session, sessionIndex) => {
    const sessionId = `session-${SEED_BATCH}-${sessionIndex}`;
    const startedAt = daysAgo(session.daysAgo, session.hour, 0);
    const completedAt = daysAgo(session.daysAgo, session.hour, Math.min(55, session.duration));

    events.push({
      userId,
      eventType: 'study_session_started',
      metadata: { seedBatch: SEED_BATCH, sessionId, topic: session.topic },
      timestamp: startedAt,
    });

    for (let taskIndex = 0; taskIndex < session.tasks; taskIndex += 1) {
      const taskTimestamp = daysAgo(
        session.daysAgo,
        session.hour,
        Math.min(55, 5 + taskIndex * 10)
      );
      events.push({
        userId,
        eventType: 'task_completed',
        metadata: {
          seedBatch: SEED_BATCH,
          sessionId,
          taskId: `task-${sessionIndex}-${taskIndex}`,
          taskIndex,
          taskTitle: `${session.topic} task ${taskIndex + 1}`,
          xpEarned: 15 + (taskIndex % 2) * 5,
        },
        timestamp: taskTimestamp,
      });
    }

    if (sessionIndex % 2 === 0) {
      const focusTimestamp = daysAgo(session.daysAgo, session.hour, 15);
      events.push({
        userId,
        eventType: 'focus_tracked',
        metadata: { seedBatch: SEED_BATCH, sessionId, focusScore: session.focus },
        timestamp: focusTimestamp,
      });
    }

    events.push({
      userId,
      eventType: 'study_session_completed',
      metadata: {
        seedBatch: SEED_BATCH,
        sessionId,
        duration: session.duration,
        focusScore: session.focus,
        completedTasks: session.tasks,
        totalTasks: session.tasks,
        topic: session.topic,
      },
      timestamp: completedAt,
    });
  });

  const loginPlan = [
    { daysAgo: 0, hour: 8 },
    { daysAgo: 1, hour: 8 },
    { daysAgo: 2, hour: 8 },
    { daysAgo: 3, hour: 9 },
    { daysAgo: 4, hour: 8 },
    { daysAgo: 5, hour: 9 },
    { daysAgo: 6, hour: 10 },
    { daysAgo: 7, hour: 8 },
    { daysAgo: 8, hour: 8 },
    { daysAgo: 9, hour: 8 },
    { daysAgo: 10, hour: 9 },
    { daysAgo: 11, hour: 8 },
    { daysAgo: 12, hour: 8 },
    { daysAgo: 13, hour: 9 },
    { daysAgo: 14, hour: 8 },
  ];

  loginPlan.forEach((login, i) => {
    events.push({
      userId,
      eventType: 'login',
      metadata: { seedBatch: SEED_BATCH, loginIndex: i },
      timestamp: daysAgo(login.daysAgo, login.hour, 0),
    });
  });

  return events;
};

async function run() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const users = db.collection('users');
    const events = db.collection('analytics_events');
    const profiles = db.collection('user_profiles');

    const user = await users.findOne({ email: EMAIL.toLowerCase() });
    if (!user) {
      throw new Error(`No user found with email ${EMAIL}`);
    }
    const userId = user._id.toString();
    console.log(`Found user: ${userId}`);

    const allEvents = buildEvents(userId);
    console.log(`Generated ${allEvents.length} events`);

    await events.deleteMany({ userId, 'metadata.seedBatch': { $regex: '^seed-' } });
    await events.insertMany(allEvents, { ordered: false });
    console.log('Events inserted');

    const totalStudyTime = sessionPlan.reduce((sum, s) => sum + s.duration, 0);
    const totalTasks = sessionPlan.reduce((sum, s) => sum + s.tasks, 0);

    await profiles.updateOne(
      { userId },
      {
        $inc: {
          'stats.totalStudyTime': totalStudyTime,
          'stats.completedTasks': totalTasks,
          'stats.currentStreak': 7,
          'stats.longestStreak': 14,
        },
        $set: { 'stats.activeDays': 14 },
      },
      { upsert: true }
    );
    console.log(`Profile stats updated: ${totalStudyTime} min, ${totalTasks} tasks`);

    console.log('\nSeed complete! Summary:');
    console.log(`  Study sessions: ${sessionPlan.length}`);
    console.log(`  Completed tasks: ${totalTasks}`);
    console.log(`  Total study time: ${totalStudyTime} min`);
    console.log(`  Days covered: ${sessionPlan.length} days`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
}

run();