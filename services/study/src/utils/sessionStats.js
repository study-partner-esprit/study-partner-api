/**
 * Session-stats derivation for the coach nudge payload (COACH-13).
 *
 * The bounded `session_stats` block is derived SERVER-SIDE from the user's
 * active StudySession — it is never trusted from the client. Every figure is
 * clamped to its published bound so the payload can never leave the 16 KB
 * CoachRequest envelope or fail the worker's schema.
 *
 * Bounds mirror `shared/ai-messaging/payloadSchemas.js` and
 * `study-partner-ai/workers/schemas.py`.
 */

const STATS_BOUNDS = {
  progress_pct: [0, 100],
  minutes_elapsed: [0, 600],
  task_switches: [0, 50],
  break_count: [0, 20],
  current_streak_days: [0, 365]
};

function clampInt(value, lo, hi) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Resolve session stats from a StudySession doc. Missing/stale data degrades
 * to the bounds floor (0) — it must never fail the job.
 *
 * @param {object}  opts.session            Leaned/plain session object.
 * @param {Date}    opts.now                Reference instant (defaults to now).
 * @param {number}  opts.currentStreakDays  Daily streak from the user profile.
 */
function resolveSessionStats({ session, now = new Date(), currentStreakDays = 0 } = {}) {
  const tp = session?.taskProgress || {};
  const total = Number(tp.totalTasks) || 0;
  const completed = Number(tp.completedTasks) || 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  let minutesElapsed = 0;
  if (session?.startTime) {
    const startMs = new Date(session.startTime).getTime();
    if (Number.isFinite(startMs)) {
      minutesElapsed = Math.floor((now.getTime() - startMs) / 60000);
    }
  }

  return {
    progress_pct: clampInt(progressPct, ...STATS_BOUNDS.progress_pct),
    minutes_elapsed: clampInt(minutesElapsed, ...STATS_BOUNDS.minutes_elapsed),
    // Number of task transitions performed so far = the index of the task in
    // progress (0 = still on the first task).
    task_switches: clampInt(tp.currentTaskIndex, ...STATS_BOUNDS.task_switches),
    break_count: clampInt(session?.breakStats?.totalBreaks, ...STATS_BOUNDS.break_count),
    current_streak_days: clampInt(
      currentStreakDays,
      ...STATS_BOUNDS.current_streak_days
    )
  };
}

module.exports = { resolveSessionStats, STATS_BOUNDS };