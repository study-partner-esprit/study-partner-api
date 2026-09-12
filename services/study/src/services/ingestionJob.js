/**
 * INGEST-05 — async course-ingestion trigger.
 *
 * Uploaded (and validated) course files enqueue a `study.ingest.course` job
 * instead of blocking the request on a 5-minute synchronous AI call. The
 * background worker (INGEST-06) performs OCR/parsing/embedding and reports back
 * via AI result events.
 */

const { publishAiJob } = require('@study-partner/shared/ai-messaging');
const { validateJobPayload } = require('@study-partner/shared/ai-messaging/payloadSchemas');
const { logger } = require('@study-partner/shared');

const INGEST_JOB_TYPE = 'study.ingest.course';

/**
 * Enqueue an async course-ingestion job.
 *
 * @param {{ userId: string, courseId: string, fileRef: string,
 *           files: Array<{filename, originalName, mimetype, size, path}>,
 *           requestId?: string }} params
 * @returns {Promise<{jobId: string, correlationId: string}>}
 */
async function publishCourseIngestionJob({ userId, courseId, fileRef, files, requestId }) {
  const payload = { courseId, fileRef, files: files || [] };
  const check = validateJobPayload(INGEST_JOB_TYPE, payload);
  if (!check.valid) {
    const err = new Error(`invalid ingestion payload: ${check.errors.join('; ')}`);
    err.code = 'INGEST_PAYLOAD_INVALID';
    throw err;
  }

  const { messageId, correlationId } = await publishAiJob(INGEST_JOB_TYPE, userId, payload, {
    requestId: requestId || `req-${Date.now()}`
  });

  logger.info('ingest_job_enqueued', {
    jobId: messageId,
    courseId,
    correlationId,
    userId,
    fileCount: payload.files.length
  });
  return { jobId: messageId, correlationId };
}

module.exports = { publishCourseIngestionJob, INGEST_JOB_TYPE };