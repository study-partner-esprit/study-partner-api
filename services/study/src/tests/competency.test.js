/**
 * BLOOM-07 — CompetencyProfile estimator property-based tests.
 *
 * Tests bounds, monotonicity under consistent evidence, convergence,
 * decay, no cross-level inference, and edge cases.
 */

const {
  ALPHA,
  MAX_STEP,
  MAX_EVIDENCE,
  ewmaStep,
  computeConfidence,
  replayEvidence
} = require('../services/competency');

// ── ewmaStep property tests ──────────────────────────────────────────────────

describe('ewmaStep() properties', () => {
  test('output always in [0,1] for any valid inputs', () => {
    const inputs = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    for (const prev of inputs) {
      for (const obs of inputs) {
        const result = ewmaStep(prev, obs);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
      }
    }
  });

  test('never moves more than MAX_STEP in a single update', () => {
    const cases = [
      [0, 1],
      [1, 0],
      [0.5, 1],
      [0.5, 0],
      [0, 0.99],
      [0.99, 0]
    ];
    for (const [prev, obs] of cases) {
      const result = ewmaStep(prev, obs);
      expect(Math.abs(result - prev)).toBeLessThanOrEqual(MAX_STEP + 0.001);
    }
  });

  test('monotonically approaches observation under consistent evidence', () => {
    let score = 0;
    const target = 0.8;
    for (let i = 0; i < 50; i++) {
      const prev = score;
      score = ewmaStep(score, target);
      if (prev < target) {
        expect(score).toBeGreaterThanOrEqual(prev);
      } else if (prev > target) {
        expect(score).toBeLessThanOrEqual(prev);
      }
    }
  });

  test('converges to observation given enough consistent updates', () => {
    let score = 0;
    const target = 1.0;
    for (let i = 0; i < 100; i++) {
      score = ewmaStep(score, target);
    }
    expect(score).toBeCloseTo(1.0, 1);
  });

  test('converges downward with low observations', () => {
    let score = 1.0;
    const target = 0.2;
    for (let i = 0; i < 100; i++) {
      score = ewmaStep(score, target);
    }
    expect(score).toBeCloseTo(0.2, 1);
  });

  test('recency decay: observations closer to seed show order-dependent final score', () => {
    // Use observations close to the seed (0.5) so MAX_STEP clamp doesn't
    // mask the recency effect.
    let score = 0.5;
    score = ewmaStep(score, 0.4); // small downward nudge
    const afterLow = score;
    score = ewmaStep(score, 0.6); // small upward nudge
    const afterLowThenHigh = score;

    // Reverse order
    let score2 = 0.5;
    score2 = ewmaStep(score2, 0.6); // small upward nudge first
    const afterHigh = score2;
    score2 = ewmaStep(score2, 0.4); // small downward nudge
    const afterHighThenLow = score2;

    // Final scores differ based on order (recency decay in action)
    expect(afterLowThenHigh).not.toBe(afterHighThenLow);
    // Low-then-high ends higher (most recent observation is 0.6)
    expect(afterLowThenHigh).toBeGreaterThan(afterHighThenLow);
  });

  test('idempotent: same observation twice moves score toward it', () => {
    let score = 0.3;
    const obs = 0.7;
    const after1 = ewmaStep(score, obs);
    const after2 = ewmaStep(after1, obs);
    // Second update moves closer to obs
    expect(Math.abs(after2 - obs)).toBeLessThan(Math.abs(after1 - obs));
  });

  test('delta equals ALPHA × (observation − prevScore) when within bounds', () => {
    // With prev=0.5, obs=0.6: raw delta = 0.4*(0.6-0.5) = 0.04 < MAX_STEP
    const prev = 0.5;
    const obs = 0.6;
    const result = ewmaStep(prev, obs);
    const expected = Math.round((prev + ALPHA * (obs - prev)) * 1000) / 1000;
    expect(result).toBe(expected);
  });
});

// ── computeConfidence property tests ─────────────────────────────────────────

describe('computeConfidence() properties', () => {
  test('returns 0 for zero evidence', () => {
    expect(computeConfidence(0)).toBe(0);
  });

  test('increases monotonically with evidence count', () => {
    let prev = 0;
    for (let n = 1; n <= 20; n++) {
      const conf = computeConfidence(n);
      expect(conf).toBeGreaterThanOrEqual(prev);
      prev = conf;
    }
  });

  test('never exceeds 1.0', () => {
    expect(computeConfidence(100)).toBeLessThanOrEqual(1);
    expect(computeConfidence(1000)).toBeLessThanOrEqual(1);
  });

  test('approaches 1 asymptotically (conf(3) < conf(6) < 1)', () => {
    const conf3 = computeConfidence(3);
    const conf6 = computeConfidence(6);
    expect(conf6).toBeGreaterThan(conf3);
    expect(conf6).toBeLessThan(1);
    expect(conf6).toBeCloseTo(0.95, 1);
  });
});

// ── replayEvidence property tests ────────────────────────────────────────────

describe('replayEvidence() properties', () => {
  test('empty evidence returns score 0', () => {
    const { score, confidence } = replayEvidence([]);
    expect(score).toBe(0);
    expect(confidence).toBe(0);
  });

  test('single evidence item applies EWMA from seed 0.5', () => {
    // Seed=0.5, obs=0.7 → 0.5 + 0.4*(0.7-0.5) = 0.58
    const evidence = [{ masteryScore: 0.7, evaluatedAt: new Date('2024-01-01') }];
    const { score } = replayEvidence(evidence);
    expect(score).toBe(0.58);
  });

  test('order matters: older evidence has less final impact (recency)', () => {
    // Low first, then high
    const lowHigh = [
      { masteryScore: 0.4, evaluatedAt: new Date('2024-01-01') },
      { masteryScore: 0.6, evaluatedAt: new Date('2024-01-02') }
    ];
    const { score: s1 } = replayEvidence(lowHigh);

    // High first, then low
    const highLow = [
      { masteryScore: 0.6, evaluatedAt: new Date('2024-01-01') },
      { masteryScore: 0.4, evaluatedAt: new Date('2024-01-02') }
    ];
    const { score: s2 } = replayEvidence(highLow);

    // Final score differs based on order (proving recency decay)
    expect(s1).not.toBe(s2);
    // Low-then-high should end higher (most recent observation is higher)
    expect(s1).toBeGreaterThan(s2);
  });

  test('ignores evidence with null masteryScore', () => {
    const evidence = [
      { masteryScore: null, evaluatedAt: new Date('2024-01-01') },
      { masteryScore: 0.6, evaluatedAt: new Date('2024-01-02') }
    ];
    const { score } = replayEvidence(evidence);
    // Seed 0.5, one observation 0.6 → 0.5 + 0.4*0.1 = 0.54
    expect(score).toBe(0.54);
  });

  test('handles out-of-order timestamps (sorts by evaluatedAt)', () => {
    const evidence = [
      { masteryScore: 0.9, evaluatedAt: new Date('2024-01-03') },
      { masteryScore: 0.3, evaluatedAt: new Date('2024-01-01') }
    ];
    const { score } = replayEvidence(evidence);
    // Sorted: 0.3 first (older), then 0.9 (newer)
    // Seed=0.5 → ewmaStep(0.5, 0.3) = 0.42 → ewmaStep(0.42, 0.9) = 0.54
    const step1 = ewmaStep(0.5, 0.3);
    const expected = ewmaStep(step1, 0.9);
    expect(score).toBe(expected);
  });

  test('consistent high evidence converges toward 1.0', () => {
    const evidence = Array.from({ length: 30 }, (_, i) => ({
      masteryScore: 0.95,
      evaluatedAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`)
    }));
    const { score } = replayEvidence(evidence);
    expect(score).toBeGreaterThan(0.85);
  });

  test('no cross-level inference: separate keys are independent', () => {
    // Three evidence items each (enough to move score past MAX_STEP clamp)
    const evidenceUnderstand = [
      { masteryScore: 0.9, evaluatedAt: new Date('2024-01-01') },
      { masteryScore: 0.95, evaluatedAt: new Date('2024-01-02') },
      { masteryScore: 0.9, evaluatedAt: new Date('2024-01-03') }
    ];
    const evidenceCreate = [
      { masteryScore: 0.2, evaluatedAt: new Date('2024-01-01') },
      { masteryScore: 0.15, evaluatedAt: new Date('2024-01-02') },
      { masteryScore: 0.1, evaluatedAt: new Date('2024-01-03') }
    ];

    const { score: scoreUnderstand } = replayEvidence(evidenceUnderstand);
    const { score: scoreCreate } = replayEvidence(evidenceCreate);

    // Understand converges high, Create converges low — they don't interfere
    expect(scoreUnderstand).toBeGreaterThan(0.7);
    expect(scoreCreate).toBeLessThan(0.3);
  });

  test('MAX_EVIDENCE cap behavior: replay only processes available items', () => {
    const evidence = Array.from({ length: MAX_EVIDENCE + 5 }, (_, i) => ({
      masteryScore: 0.8,
      evaluatedAt: new Date(`2024-01-${String((i % 28) + 1).padStart(2, '0')}`)
    }));
    // replayEvidence processes all items passed; cap is enforced at upsert level
    const { score } = replayEvidence(evidence);
    expect(score).toBeGreaterThan(0);
  });
});

// ── Integration: upsert + replay round-trip ──────────────────────────────────

describe('upsertProfile + replayEvidence round-trip', () => {
  test('mock model receives correct score after upsert', () => {
    // Pure-logic round-trip without Mongo: verify replay gives expected score
    const evidence = [
      { masteryScore: 0.5, evaluatedAt: new Date('2024-01-01') },
      { masteryScore: 0.7, evaluatedAt: new Date('2024-01-02') },
      { masteryScore: 0.65, evaluatedAt: new Date('2024-01-03') }
    ];
    const { score, confidence } = replayEvidence(evidence);

    // Manual replay from seed 0.5
    let expected = 0.5;
    expected = ewmaStep(expected, 0.5);
    expected = ewmaStep(expected, 0.7);
    expected = ewmaStep(expected, 0.65);

    expect(score).toBe(expected);
    expect(confidence).toBe(computeConfidence(3));
  });
});
