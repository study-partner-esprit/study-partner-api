const { BASE_KP_MAP } = require('../services/rankingService');

describe('Ranking KP map', () => {
  test('includes challenge completion KP actions', () => {
    expect(Number(BASE_KP_MAP.challenge_complete)).toBeGreaterThan(0);
    expect(Number(BASE_KP_MAP.challenge_completed)).toBeGreaterThan(0);
  });

  test('keeps session completion KP actions mapped', () => {
    expect(Number(BASE_KP_MAP.session_complete)).toBeGreaterThan(0);
    expect(Number(BASE_KP_MAP.team_session)).toBeGreaterThan(0);
    expect(Number(BASE_KP_MAP.team_session_host)).toBeGreaterThan(0);
  });
});
