/** Regression tests for audit §5.5 / T9 duplicate-definition bugs. */

const fs = require('fs');
const path = require('path');

describe("badge key regression ('use' key bug, leaderboardService)", () => {
  const svcPath = path.join(
    __dirname,
    '../../services/user-profile/src/services/leaderboardService.js'
  );
  const source = fs.readFileSync(svcPath, 'utf8');

  // Evaluate the module source without executing its model imports.
  const getBadgeKey = (rank) => {
    const stubRequire = () => new Proxy(() => stubRequire(), { get: () => stubRequire() });
    const fn = new Function(
      'require',
      'module',
      'exports',
      'rank',
      `${source}\nreturn getBadgeKeyForRank(rank);`
    );
    return fn(stubRequire, { exports: {} }, {}, rank);
  };

  test('legend tier maps to its existing asset key "only"', () => {
    // legend ships public/ranking-badges/legend/only.png — never 'use'
    expect(getBadgeKey({ tier: 'Legend', division: null })).toBe('only');
  });

  test('grandmaster tier keeps its asset key "use"', () => {
    expect(getBadgeKey({ tier: 'Grandmaster', division: null })).toBe('use');
  });

  test('division tiers map to first/second/third assets', () => {
    expect(getBadgeKey({ tier: 'Novice', division: 'III' })).toBe('first');
    expect(getBadgeKey({ tier: 'Novice', division: 'II' })).toBe('second');
    expect(getBadgeKey({ tier: 'Master', division: 'I' })).toBe('third');
  });

  test('unknown division falls back to an asset that exists in every division tier', () => {
    const webPublic = path.join(__dirname, '../../../study-partner-web/public/ranking-badges');
    const fallback = getBadgeKey({ tier: 'Novice', division: 'unknown' });
    const SINGLE_BADGE_TIERS = new Set(['grandmaster', 'legend']);
    for (const tier of fs.readdirSync(webPublic)) {
      if (SINGLE_BADGE_TIERS.has(tier)) continue;
      expect(fs.readdirSync(path.join(webPublic, tier))).toContain(`${fallback}.png`);
    }
  });
});

describe('duplicate-method regressions (audit §1-6)', () => {
  const py = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

  test('signal_processing service defines is_ready exactly once', () => {
    const src = py('../../../study-partner-ai/services/signal_processing_service/service.py');
    expect(src.match(/^\s*def is_ready\(/gm) || []).toHaveLength(1);
    // The surviving definition must be the real initialization check
    expect(src).toMatch(/getattr\(self,\s*["']_initialized["']/);
  });

  test('planner retriever defines retrieve/add_documents exactly once', () => {
    const src = py('../../../study-partner-ai/agents/planner/rag/retriever.py');
    expect(src.match(/^\s*def retrieve\(/gm) || []).toHaveLength(1);
    expect(src.match(/^\s*def add_documents\(/gm) || []).toHaveLength(1);
    // Keep the structured-logging variants, not the print() ones
    expect(src).toMatch(/retriever_retrieve_error/);
    expect(src).not.toMatch(/print\(f"Retrieval error/);
  });
});
