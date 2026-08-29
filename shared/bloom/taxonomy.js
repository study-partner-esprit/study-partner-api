/**
 * Canonical Bloom's Taxonomy constants (BLOOM-01 — Shared Taxonomy Constants).
 *
 * Python mirror: `study-partner-ai/bloom/taxonomy.py`. Values MUST stay
 * identical on both sides — parity is covered by contract tests against
 * docs/contracts/bloom-fixture.json.
 */

const BLOOM_LEVELS = Object.freeze([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create'
]);

const KNOWLEDGE_TYPES = Object.freeze([
  'factual',
  'conceptual',
  'procedural',
  'metacognitive'
]);

const VERB_MAP = Object.freeze({
  remember: Object.freeze(['Define', 'List']),
  understand: Object.freeze(['Explain', 'Summarize']),
  apply: Object.freeze(['Solve', 'Implement']),
  analyze: Object.freeze(['Compare', 'Diagnose']),
  evaluate: Object.freeze(['Justify', 'Critique']),
  create: Object.freeze(['Design', 'Compose'])
});

const UNLOCK_THRESHOLD = 0.7;

/**
 * Returns the next Bloom level in progression order, or null if `level`
 * is already the highest level ('create') or not a recognized level.
 * @param {string} level
 * @returns {string|null}
 */
function nextLevel(level) {
  const idx = BLOOM_LEVELS.indexOf(level);
  if (idx === -1 || idx === BLOOM_LEVELS.length - 1) return null;
  return BLOOM_LEVELS[idx + 1];
}

module.exports = {
  BLOOM_LEVELS,
  KNOWLEDGE_TYPES,
  VERB_MAP,
  UNLOCK_THRESHOLD,
  unlockThreshold: UNLOCK_THRESHOLD, // camelCase alias to match story wording
  nextLevel
};