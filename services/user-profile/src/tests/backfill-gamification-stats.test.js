const {
  deriveStatsFromHistory,
  isChallengeCompletionAction,
  isGroupSessionAction
} = require('../scripts/backfillGamificationStats');

describe('Gamification stats backfill helpers', () => {
  test('detects challenge completion actions and ignores failed variants', () => {
    expect(isChallengeCompletionAction('challenge_complete')).toBe(true);
    expect(isChallengeCompletionAction('challenge_completed')).toBe(true);
    expect(isChallengeCompletionAction('challenge_failed')).toBe(false);
    expect(isChallengeCompletionAction('challenge_abandoned')).toBe(false);
  });

  test('detects group session actions', () => {
    expect(isGroupSessionAction('team_session')).toBe(true);
    expect(isGroupSessionAction('team_session_host')).toBe(true);
    expect(isGroupSessionAction('session_complete')).toBe(false);
  });

  test('derives challenge and group counters from xp history', () => {
    const { challengeCount, groupSessionCount } = deriveStatsFromHistory([
      { action: 'challenge_complete' },
      { action: 'challenge_completed' },
      { action: 'challenge_failed' },
      { action: 'team_session' },
      { action: 'team_session_host' },
      { action: 'session_complete' }
    ]);

    expect(challengeCount).toBe(2);
    expect(groupSessionCount).toBe(2);
  });
});
