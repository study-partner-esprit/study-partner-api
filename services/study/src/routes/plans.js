const express = require('express');
const Joi = require('joi');
const axios = require('axios');
const mongoose = require('mongoose');
const { StudyPlan, Task, Course } = require('../models');

const router = express.Router();

// Validation schemas
const createPlanSchema = Joi.object({
  goal: Joi.string().required(),
  availableTimeMinutes: Joi.number().min(30).required(),
  courseId: Joi.string().optional(),
  startDate: Joi.date().optional()
});

const schedulePlanSchema = Joi.object({
  calendarEvents: Joi.array().items(Joi.object()).optional(),
  maxMinutesPerDay: Joi.number().min(30).max(480).optional(),
  allowLateNight: Joi.boolean().optional()
});

// Create study plan from goal (with optional course)
router.post('/create', async (req, res) => {
  try {
    const { error } = createPlanSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;
    const { goal, availableTimeMinutes, courseId, startDate } = req.body;

    // CourseId is required for plan generation
    if (!courseId) {
      return res.status(400).json({ error: 'courseId is required for plan generation' });
    }

    // Verify course exists and belongs to user
    let course;
    try {
      console.log('Looking for course with:', { courseId, userId });
      course = await Course.findOne({ _id: courseId, userId });
      console.log('Course found:', course ? 'Yes' : 'No');
      if (course) {
        console.log('Course details:', {
          id: course._id.toString(),
          userId: course.userId,
          status: course.status
        });
      }
    } catch (error) {
      console.error('Error finding course:', error.message);
      return res.status(400).json({ error: 'Invalid course ID format' });
    }

    if (!course) {
      // Try to find the course without userId filter to see if it exists at all
      try {
        const anyCourse = await Course.findOne({ _id: courseId });
        if (anyCourse) {
          console.log('Course exists but belongs to different user:', {
            courseUserId: anyCourse.userId,
            requestUserId: userId
          });
        } else {
          console.log('Course does not exist in database');
        }
      } catch (e) {
        console.error('Error checking course existence:', e.message);
      }
      return res.status(404).json({ error: 'Course not found' });
    }

    if (course.status !== 'completed') {
      return res
        .status(400)
        .json({
          error: 'Course is still being processed. Please wait until processing is complete.'
        });
    }

    // Call AI planner service
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    let aiResponse;
    try {
      aiResponse = await axios.post(
        `${aiServiceUrl}/api/ai/planner/create-plan`,
        {
          user_id: userId,
          goal: goal,
          available_time_minutes: availableTimeMinutes,
          course_id: courseId || null,
          start_date: startDate || new Date().toISOString()
        },
        {
          timeout: 120000 // 2 minutes timeout
        }
      );
    } catch (aiError) {
      console.error('AI planner service error:', aiError.message, aiError.code);

      // If AI service is not available, provide a mock response for testing
      if (
        aiError.code === 'ECONNREFUSED' ||
        aiError.message.includes('ECONNREFUSED') ||
        aiError.message.includes('connect') ||
        aiError.message.includes('timeout')
      ) {
        console.log('AI service not available, using mock response for testing');
        aiResponse = {
          data: {
            tasks: [
              {
                id: 'mock-task-1',
                title: `Introduction to ${goal}`,
                description: `Learn the basics of ${goal}`,
                estimatedTime: 30,
                difficulty: 0.3,
                prerequisites: [],
                is_review: false
              },
              {
                id: 'mock-task-2',
                title: `Core Concepts of ${goal}`,
                description: `Dive deeper into ${goal} concepts`,
                estimatedTime: 45,
                difficulty: 0.5,
                prerequisites: ['mock-task-1'],
                is_review: false
              },
              {
                id: 'mock-task-3',
                title: `Advanced ${goal} Topics`,
                description: `Master advanced ${goal} techniques`,
                estimatedTime: 60,
                difficulty: 0.7,
                prerequisites: ['mock-task-2'],
                is_review: false
              },
              {
                id: 'mock-task-4',
                title: `Practice and Review ${goal}`,
                description: `Apply your knowledge and review key concepts`,
                estimatedTime: 30,
                difficulty: 0.4,
                prerequisites: ['mock-task-3'],
                is_review: true
              }
            ],
            warning:
              'AI service is currently starting up. This is a mock study plan for testing purposes.'
          }
        };
      } else {
        return res.status(500).json({
          error: 'Failed to create study plan',
          details: aiError.response?.data?.detail || aiError.message
        });
      }
    }

    // Extract task graph from AI response
    const aiTasks = aiResponse.data.tasks || [];
    const taskGraph = {
      goal: goal,
      tasks: aiTasks.map((task) => ({
        id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: task.title,
        description: task.description,
        estimated_minutes: task.estimatedTime || task.estimated_minutes || 30,
        difficulty: task.difficulty || 0.5,
        prerequisites: task.prerequisites || [],
        is_review: task.is_review || false
      }))
    };

    // Calculate total time
    const totalEstimatedMinutes = taskGraph.tasks.reduce((sum, t) => sum + t.estimated_minutes, 0);

    // Create study plan in database
    console.log('Creating study plan with data:', {
      userId,
      courseId: courseId || null,
      goal,
      availableTimeMinutes,
      totalEstimatedMinutes,
      taskGraphTasksCount: taskGraph.tasks.length
    });

    try {
      const studyPlan = await StudyPlan.create({
        userId,
        courseId: courseId || null,
        goal,
        availableTimeMinutes,
        taskGraph,
        totalEstimatedMinutes,
        warning: aiResponse.data.warning || null,
        status: 'created'
      });
      console.log('Study plan created successfully:', studyPlan._id);

      // Create tasks linked to this study plan
      const createdTasks = [];
      console.log('Creating tasks for study plan:', studyPlan._id);

      try {
        for (const taskData of taskGraph.tasks) {
          const task = await Task.create({
            userId,
            studyPlanId: studyPlan._id.toString(),
            title: taskData.title,
            description: taskData.description,
            priority:
              taskData.difficulty < 0.4 ? 'low' : taskData.difficulty < 0.7 ? 'medium' : 'high',
            estimatedTime: taskData.estimated_minutes,
            tags: [goal.substring(0, 50)],
            status: 'todo'
          });
          createdTasks.push(task);
        }
        console.log('Created', createdTasks.length, 'tasks for study plan');
      } catch (taskError) {
        console.error('Error creating tasks:', taskError);
        // Don't fail the whole request if tasks fail to create
        console.log('Continuing without tasks...');
      }

      res.status(201).json({
        message: 'Study plan created successfully',
        plan: {
          id: studyPlan._id.toString(),
          userId: studyPlan.userId,
          courseId: studyPlan.courseId,
          goal: studyPlan.goal,
          availableTimeMinutes: studyPlan.availableTimeMinutes,
          totalEstimatedMinutes: studyPlan.totalEstimatedMinutes,
          tasksCount: taskGraph.tasks.length,
          status: studyPlan.status,
          warning: studyPlan.warning,
          createdAt: studyPlan.createdAt,
          taskGraph: studyPlan.taskGraph
        },
        tasks: createdTasks
      });
    } catch (dbError) {
      console.error('Database error creating study plan:', dbError);
      return res.status(500).json({ error: 'Failed to save study plan to database' });
    }
  } catch (error) {
    console.error('Error creating study plan:', error);
    res.status(500).json({ error: 'Failed to create study plan' });
  }
});

// Get all study plans for user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, courseId } = req.query;

    const filter = { userId };
    if (status) filter.status = status;
    if (courseId) filter.courseId = courseId;

    const plans = await StudyPlan.find(filter).sort({ createdAt: -1 }).lean();

    // Format response
    const formattedPlans = plans.map((plan) => ({
      id: plan._id.toString(),
      userId: plan.userId,
      courseId: plan.courseId,
      goal: plan.goal,
      availableTimeMinutes: plan.availableTimeMinutes,
      totalEstimatedMinutes: plan.totalEstimatedMinutes,
      tasksCount: plan.taskGraph?.tasks?.length || 0,
      status: plan.status,
      warning: plan.warning,
      createdAt: plan.createdAt,
      scheduledAt: plan.scheduledAt
    }));

    res.json({ plans: formattedPlans });
  } catch (error) {
    console.error('Error fetching study plans:', error);
    res.status(500).json({ error: 'Failed to fetch study plans' });
  }
});

// Get calendar entries for the user within upcoming weeks (default 2 weeks)
router.get('/calendar', async (req, res) => {
  try {
    const userId = req.user.userId;
    const weeks = parseInt(req.query.weeks, 10) || 2;
    const start = req.query.startDate ? new Date(req.query.startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + weeks * 7);

    console.log(`\n=== Fetching calendar entries ===`);
    console.log(`User ID: ${userId}`);
    console.log(`Date range: ${start.toISOString()} to ${end.toISOString()}`);
    console.log(`Weeks: ${weeks}`);

    const calendarColl = mongoose.connection.collection('calendar');

    // Get total count for this user
    const totalCount = await calendarColl.countDocuments({ userId });
    console.log(`Total entries for user: ${totalCount}`);

    const entries = await calendarColl
      .find({
        userId,
        startTime: { $gte: start, $lte: end }
      })
      .sort({ startTime: 1 })
      .toArray();

    console.log(`Found ${entries.length} entries in date range`);
    if (entries.length > 0) {
      console.log('Sample entry:', entries[0]);
    }

    res.json({ entries });
  } catch (error) {
    console.error('Error fetching calendar entries:', error);
    res.status(500).json({ error: 'Failed to fetch calendar entries' });
  }
});

// Get specific study plan by ID
router.get('/:planId([0-9a-fA-F]{24})', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { planId } = req.params;

    const plan = await StudyPlan.findOne({ _id: planId, userId }).lean();

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    // Get associated tasks
    const tasks = await Task.find({ studyPlanId: planId, userId }).lean();

    res.json({
      plan: {
        id: plan._id.toString(),
        userId: plan.userId,
        courseId: plan.courseId,
        goal: plan.goal,
        availableTimeMinutes: plan.availableTimeMinutes,
        totalEstimatedMinutes: plan.totalEstimatedMinutes,
        tasksCount: plan.taskGraph?.tasks?.length || 0,
        status: plan.status,
        warning: plan.warning,
        createdAt: plan.createdAt,
        scheduledAt: plan.scheduledAt,
        taskGraph: plan.taskGraph
      },
      tasks
    });
  } catch (error) {
    console.error('Error fetching study plan:', error);
    res.status(500).json({ error: 'Failed to fetch study plan' });
  }
});

// Schedule a study plan (call Python AI scheduler)
router.post('/:planId/schedule', async (req, res) => {
  try {
    const { error } = schedulePlanSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.userId;
    const { planId } = req.params;
    const { calendarEvents, maxMinutesPerDay, allowLateNight } = req.body;

    // Find the study plan
    const plan = await StudyPlan.findOne({ _id: planId, userId });

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    // Get tasks for this plan
    const tasks = await Task.find({ studyPlanId: planId, userId }).lean();

    if (tasks.length === 0) {
      return res.status(400).json({ error: 'No tasks found for this study plan' });
    }

    // Call Python AI scheduler service
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    try {
      const axios = require('axios');

      // Call the new Python scheduler endpoint
      const schedulerResponse = await axios.post(`${aiServiceUrl}/api/ai/scheduler/schedule`, {
        user_id: userId,
        tasks: tasks,
        calendar_events: calendarEvents || [],
        max_minutes_per_day: maxMinutesPerDay || 240,
        allow_late_night: allowLateNight || false
      });

      const schedule = schedulerResponse.data.schedule;

      // Persist schedule into `calendar` collection for user's calendar view
      try {
        const calendarColl = mongoose.connection.collection('calendar');
        const entries = (schedule.sessions || schedule || []).map((s) => ({
          userId,
          planId: plan._id.toString(),
          taskId: s.taskId || s.task_id || s.task || null,
          title: s.title || s.name || null,
          description: s.description || s.note || null,
          startTime: s.startTime
            ? new Date(s.startTime)
            : s.start_time
              ? new Date(s.start_time)
              : null,
          endTime: s.endTime ? new Date(s.endTime) : s.end_time ? new Date(s.end_time) : null,
          estimatedMinutes: s.estimatedMinutes || s.estimated_minutes || s.duration || null,
          status: 'scheduled',
          source: 'plan',
          createdAt: new Date()
        }));

        if (entries.length > 0) {
          await calendarColl.insertMany(entries);
        }
      } catch (saveErr) {
        console.error('Failed to save schedule to calendar collection:', saveErr.message);
      }

      // Update plan status
      plan.status = 'scheduled';
      plan.scheduledAt = new Date();
      await plan.save();

      res.json({
        message: 'Study plan scheduled successfully',
        planId: plan._id.toString(),
        schedule: schedule
      });
    } catch (aiError) {
      console.error('Scheduler service error:', aiError.message);
      return res.status(500).json({
        error: 'Failed to schedule study plan',
        details: aiError.response?.data?.detail || aiError.message
      });
    }
  } catch (error) {
    console.error('Error scheduling study plan:', error);
    res.status(500).json({ error: 'Failed to schedule study plan' });
  }
});

// Get schedule for a study plan
router.get('/:planId/schedule', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { planId } = req.params;

    const plan = await StudyPlan.findOne({ _id: planId, userId });

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    if (plan.status !== 'scheduled') {
      return res.status(400).json({ error: 'Study plan has not been scheduled yet' });
    }

    // Get tasks with their schedule info
    const tasks = await Task.find({ studyPlanId: planId, userId }).lean();

    // Generate schedule view
    const schedule = {
      planId: plan._id.toString(),
      goal: plan.goal,
      scheduledAt: plan.scheduledAt,
      sessions: tasks.map((task, index) => {
        const startDate = new Date(plan.scheduledAt);
        startDate.setDate(startDate.getDate() + index);
        startDate.setHours(9, 0, 0, 0);

        return {
          taskId: task._id.toString(),
          title: task.title,
          description: task.description,
          status: task.status,
          startTime: startDate.toISOString(),
          endTime: new Date(startDate.getTime() + (task.estimatedTime || 30) * 60000).toISOString(),
          estimatedMinutes: task.estimatedTime || 30
        };
      })
    };

    res.json({ schedule });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// Delete study plan and associated tasks
router.delete('/:planId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { planId } = req.params;

    const plan = await StudyPlan.findOne({ _id: planId, userId });

    if (!plan) {
      return res.status(404).json({ error: 'Study plan not found' });
    }

    // Delete associated tasks
    await Task.deleteMany({ studyPlanId: planId, userId });

    // Delete study plan
    await StudyPlan.deleteOne({ _id: planId, userId });

    res.json({ message: 'Study plan and associated tasks deleted successfully' });
  } catch (error) {
    console.error('Error deleting study plan:', error);
    res.status(500).json({ error: 'Failed to delete study plan' });
  }
});

// Schedule user's tasks (all or filtered)
router.post('/schedule-tasks', async (req, res) => {
  console.log('=== Schedule tasks endpoint called ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('User from auth:', req.user);
  try {
    const userId = req.user.userId;
    const { taskIds, calendarEvents, maxMinutesPerDay, allowLateNight } = req.body;

    // Get tasks - either specific IDs or all user tasks with status 'todo' or 'in-progress'
    let tasks;
    if (taskIds && Array.isArray(taskIds) && taskIds.length > 0) {
      tasks = await Task.find({ _id: { $in: taskIds }, userId }).lean();
    } else {
      // Get all pending tasks
      tasks = await Task.find({
        userId,
        status: { $in: ['todo', 'in-progress'] }
      }).lean();
    }

    console.log(`Found ${tasks.length} tasks to schedule for user ${userId}`);

    if (tasks.length === 0) {
      return res.status(400).json({ error: 'No tasks found to schedule' });
    }

    // Check for existing scheduled entries to prevent duplicates
    const calendarColl = mongoose.connection.collection('calendar');
    const taskIdsToSchedule = tasks.map(t => t._id.toString());
    const existingScheduled = await calendarColl.find({
      userId,
      taskId: { $in: taskIdsToSchedule },
      source: 'auto'
    }).toArray();

    console.log(`Found ${existingScheduled.length} already scheduled tasks`);

    if (existingScheduled.length > 0) {
      // Remove already scheduled tasks from the list
      const scheduledTaskIds = new Set(existingScheduled.map(e => e.taskId));
      tasks = tasks.filter(t => !scheduledTaskIds.has(t._id.toString()));
      console.log(`After filtering duplicates: ${tasks.length} tasks remain`);

      if (tasks.length === 0) {
        return res.status(200).json({
          message: 'All tasks are already scheduled',
          schedule: { sessions: existingScheduled },
          tasksCount: 0
        });
      }
    }

    // Call Python AI scheduler service
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

    try {
      const axios = require('axios');

      const schedulerResponse = await axios.post(`${aiServiceUrl}/api/ai/scheduler/schedule`, {
        user_id: userId,
        tasks: tasks,
        calendar_events: calendarEvents || [],
        max_minutes_per_day: maxMinutesPerDay || 240,
        allow_late_night: allowLateNight || false
      });

      const schedule = schedulerResponse.data.schedule;

      // Persist schedule into `calendar` collection (task-scheduling flow)
      try {
        const calendarColl = mongoose.connection.collection('calendar');
        const entries = (schedule.sessions || schedule || []).map((s) => ({
          userId,
          planId: null,
          taskId: s.taskId || s.task_id || s.task || null,
          title: s.title || s.name || null,
          description: s.description || s.note || null,
          startTime: s.startTime
            ? new Date(s.startTime)
            : s.start_time
              ? new Date(s.start_time)
              : null,
          endTime: s.endTime ? new Date(s.endTime) : s.end_time ? new Date(s.end_time) : null,
          estimatedMinutes: s.estimatedMinutes || s.estimated_minutes || s.duration || null,
          status: 'scheduled',
          source: 'auto',
          createdAt: new Date()
        }));

        console.log(`Attempting to save ${entries.length} entries to calendar collection`);
        console.log('Sample entry:', JSON.stringify(entries[0], null, 2));

        if (entries.length > 0) {
          const result = await calendarColl.insertMany(entries);
          console.log(`✓ Successfully saved ${result.insertedCount} entries to calendar`);
        } else {
          console.log('⚠ No entries to save to calendar');
        }
      } catch (saveErr) {
        console.error('❌ Failed to save scheduled tasks to calendar collection:', saveErr);
        throw saveErr; // Propagate error to main handler
      }

      res.json({
        message: 'Tasks scheduled successfully',
        schedule: schedule,
        tasksCount: tasks.length
      });
    } catch (aiError) {
      console.error('Scheduler service error:', aiError.message);
      return res.status(500).json({
        error: 'Failed to schedule tasks',
        details: aiError.response?.data?.detail || aiError.message
      });
    }
  } catch (error) {
    console.error('Error scheduling tasks:', error);
    res.status(500).json({ error: 'Failed to schedule tasks' });
  }
});

module.exports = router;
