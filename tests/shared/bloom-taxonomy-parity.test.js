/**
 * Bloom taxonomy parity tests (BLOOM-01): the Node taxonomy module must
 * match docs/contracts/bloom-fixture.json — the same fixture the Python
 * side (study-partner-ai/bloom/taxonomy.py) validates against. Drift fails
 * CI. Pattern follows topology-parity.test.js (AI-COM-06).
 */

const fs = require('fs');
const path = require('path');

const t = require('../../shared/bloom/taxonomy');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../docs/contracts/bloom-fixture.json'), 'utf8')
);

describe('Bloom taxonomy parity (Node ↔ fixture ↔ Python)', () => {
  test('BLOOM_LEVELS matches fixture', () => {
    expect(t.BLOOM_LEVELS).toEqual(fixture.bloomLevels);
  });

  test('KNOWLEDGE_TYPES matches fixture', () => {
    expect(t.KNOWLEDGE_TYPES).toEqual(fixture.knowledgeTypes);
  });

  test('VERB_MAP matches fixture', () => {
    expect(t.VERB_MAP).toEqual(fixture.verbMap);
  });

  test('unlockThreshold matches fixture', () => {
    expect(t.UNLOCK_THRESHOLD).toBe(fixture.unlockThreshold);
  });

  test('nextLevel walks the progression and terminates at create', () => {
    const levels = fixture.bloomLevels;
    for (let i = 0; i < levels.length - 1; i++) {
      expect(t.nextLevel(levels[i])).toBe(levels[i + 1]);
    }
    expect(t.nextLevel(levels[levels.length - 1])).toBeNull();
    expect(t.nextLevel('not-a-level')).toBeNull();
  });
});
