/**
 * INGEST-07 — course ingestion status tracker.
 *
 * Subscribes to the AI `study.ingest.course` worker's events on `ai.results`:
 *   • progress  (routing key `progress`)  → live stage/percentage for the
 *     ingest-status endpoint
 *   • result    (routing key `result`, own queue) → flips Course to
 *     completed/failed, persists the worker's course structure on completion
 *     and surfaces a sanitized failure reason + retry action.
 *
 * The orchestrator's result inbox (ai.results.inbox) keeps doing complete/fail
 * correlation on AiJob — a direct exchange copies `result` messages to both
 * queues, so nothing here interferes with it.
 */

const {
  consumeAiProgress,
  consumeIngestResults,
  closeAiMessaging
} = require('@study-partner/shared/ai-messaging');
const { logger } = require('@study-partner/shared');
const { Course } = require('../models');
const { INGEST_JOB_TYPE } = require('./ingestionJob');

// Whitelist of subtopic fields a worker result may write into Course.topics.
// Anything else from the AI side is dropped — the curated course structure is
// trusted, everything else is treated as untrusted data and never stored.
const SUBTOPIC_STRING_ARRAY = ['key_concepts', 'formulas', 'examples'];

function sanitizeCourseFromResult(resultCourse) {
  if (!resultCourse || typeof resultCourse !== 'object') return [];
  const topics = Array.isArray(resultCourse.topics) ? resultCourse.topics : [];
  return topics
    .filter((topic) => topic && typeof topic === 'object')
    .map((topic) => ({
      title: String(topic.title || ''),
      subtopics: (Array.isArray(topic.subtopics) ? topic.subtopics : [])
        .filter((sub) => sub && typeof sub === 'object')
        .map((sub) => {
          const clean = {
            id: String(sub.id || ''),
            title: String(sub.title || ''),
            summary: typeof sub.summary === 'string' ? sub.summary : ''
          };
          for (const key of SUBTOPIC_STRING_ARRAY) {
            if (Array.isArray(sub[key])) {
              clean[key] = sub[key].filter((v) => typeof v === 'string').map(String);
            } else if (typeof sub[key] === 'string') {
              clean[key] = [sub[key]];
            }
          }
          if (Array.isArray(sub.definitions)) {
            clean.definitions = sub.definitions
              .filter((d) => d && typeof d === 'object')
              .map((d) => ({
                term: String(d.term || ''),
                definition: String(d.definition || '')
              }));
          }
          if (sub.learning_objectives !== undefined) {
            clean.learning_objectives = sub.learning_objectives;
          }
          return clean;
        }),
      prerequisites: Array.isArray(topic.prerequisites) ? topic.prerequisites.map(String) : []
    }));
}

function retryAction(courseId, status) {
  if (status !== 'failed') return null;
  return {
    action: 're-upload',
    description: 'Re-upload the course files to trigger a new ingestion cycle',
    endpoint: `/api/v1/study/courses/${courseId}/files`,
    method: 'POST'
  };
}

/** Shape returned by GET /api/v1/study/courses/:courseId/ingest-status. */
function buildIngestStatus(course) {
  return {
    courseId: course._id.toString(),
    status: course.status,
    jobId: course.jobId || null,
    stage: course.ingestStage || 'queued',
    progress: typeof course.ingestProgress === 'number' ? course.ingestProgress : 0,
    detail: course.ingestDetail || '',
    error: course.status === 'failed' ? course.ingestError || '' : '',
    processedAt: course.processedAt || null,
    retry: retryAction(course._id.toString(), course.status),
    updatedAt: course.updatedAt || null
  };
}

async function handleIngestProgress(progress) {
  if (progress.type !== INGEST_JOB_TYPE) return;
  const course = await Course.findOne({ correlationId: progress.correlationId });
  if (!course) {
    logger.warn('ingest_progress_unmatched_correlation', {
      correlationId: progress.correlationId
    });
    return;
  }
  course.ingestStage = progress.stage;
  course.ingestProgress = progress.progress;
  course.ingestDetail = progress.detail || '';
  await course.save();
  logger.info('ingest_progress_recorded', {
    courseId: course._id.toString(),
    stage: progress.stage,
    progress: progress.progress
  });
}

async function handleIngestResult(result) {
  if (result.type !== INGEST_JOB_TYPE) return;
  const course = await Course.findOne({ correlationId: result.correlationId });
  if (!course) {
    logger.warn('ingest_result_unmatched_correlation', {
      correlationId: result.correlationId,
      status: result.status
    });
    return;
  }

  if (result.status === 'completed') {
    course.status = 'completed';
    course.ingestStage = 'indexing';
    course.ingestProgress = 1;
    course.ingestDetail = 'done';
    course.ingestError = '';
    if (result.payload && result.payload.course) {
      course.topics = sanitizeCourseFromResult(result.payload.course);
    }
    course.processedAt = new Date();
    logger.info('ingest_completed', { courseId: course._id.toString() });
  } else {
    course.status = 'failed';
    course.ingestError = result.error || 'ingestion failed';
    logger.error('ingest_failed', {
      courseId: course._id.toString(),
      error: course.ingestError
    });
  }
  await course.save();
}

/**
 * Start the ingest-status consumers. Resolves once both subscriptions are live.
 * No-op safe: callers guard with `process.env.RABBITMQ_URL`.
 */
async function startIngestStatusTracker() {
  const [progressChannel, resultChannel] = await Promise.all([
    consumeAiProgress(handleIngestProgress),
    consumeIngestResults(handleIngestResult)
  ]);
  logger.info('ingest_status_tracker_started', {
    progressConsumer: Boolean(progressChannel),
    resultConsumer: Boolean(resultChannel)
  });
}

/** Graceful shutdown for the tracker's consumers. */
function stopIngestStatusTracker() {
  return closeAiMessaging();
}

module.exports = {
  startIngestStatusTracker,
  stopIngestStatusTracker,
  handleIngestProgress,
  handleIngestResult,
  buildIngestStatus,
  sanitizeCourseFromResult
};
