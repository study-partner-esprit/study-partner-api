/**
 * AiJob — persisted AI job state machine (F01 / AI-COM-07).
 *
 * Every AI operation creates an AiJob in PENDING and returns its jobId
 * immediately (202). Result events correlate via correlationId. Terminal jobs
 * get expireAt = +30d so Mongo's TTL index cleans them up.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const JOB_STATUSES = ['PENDING', 'PROCESSING', 'RETRYING', 'COMPLETED', 'FAILED'];

// Allowed transitions; anything else is rejected.
// PENDING -> COMPLETED/FAILED covers result races (worker finishes before
// the orchestrator observes PROCESSING).
const TRANSITIONS = {
  PENDING: ['PROCESSING', 'COMPLETED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED', 'RETRYING'],
  RETRYING: ['PROCESSING', 'COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: []
};

const aiJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, default: () => crypto.randomUUID(), unique: true },
    type: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    requestId: { type: String },
    correlationId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    status: {
      type: String,
      enum: JOB_STATUSES,
      default: 'PENDING',
      index: true
    },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: {
      type: String,
      default: null,
      maxlength: 512 // sanitized only — no stacks / connection strings
    },
    attempts: { type: Number, default: 0 },
    fallbackUsed: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    expireAt: { type: Date, default: null }
  },
  {
    collection: 'ai_jobs'
  }
);

aiJobSchema.index({ userId: 1, createdAt: -1 });

// TTL sweep for terminal jobs (expireAt set on completion/failure).
aiJobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

aiJobSchema.methods.transitionTo = function transitionTo(nextStatus) {
  const allowed = TRANSITIONS[this.status] || [];
  if (!allowed.includes(nextStatus)) {
    const err = new Error(`invalid job transition ${this.status} -> ${nextStatus}`);
    err.code = 'EINVALIDTRANSITION';
    throw err;
  }
  this.status = nextStatus;
  if (nextStatus === 'COMPLETED' || nextStatus === 'FAILED') {
    this.expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  this.updatedAt = new Date();
  return this.save();
};

/** Create a PENDING job from a published envelope's identifiers. */
aiJobSchema.statics.createPending = function createPending({
  type,
  userId,
  requestId,
  correlationId,
  messageId,
  payloadSnapshot = undefined
}) {
  return this.create({
    type,
    userId,
    requestId,
    correlationId,
    messageId,
    status: 'PENDING',
    ...(payloadSnapshot !== undefined ? {} : {})
  });
};

/** Correlated completion — idempotent: replayed results are ignored once terminal. */
aiJobSchema.statics.completeByCorrelation = async function completeByCorrelation(
  correlationId,
  payload
) {
  const job = await this.findOne({ correlationId });
  if (!job) return null;
  if (job.status === 'COMPLETED') return job; // duplicate result event
  job.result = payload || {};
  await job.transitionTo('COMPLETED');
  return job;
};

aiJobSchema.statics.failByCorrelation = async function failByCorrelation(
  correlationId,
  sanitizedError
) {
  const job = await this.findOne({ correlationId });
  if (!job) return null;
  if (job.status === 'FAILED' || job.status === 'COMPLETED') return job;
  job.error = String(sanitizedError || 'AI job failed').slice(0, 512);
  await job.transitionTo('FAILED');
  return job;
};

module.exports = mongoose.models.AiJob || mongoose.model('AiJob', aiJobSchema);
