import { describe, it, expect } from 'vitest';
import { calculateScores } from '../../src/scoring/score-calculator.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides = {}) {
  return {
    files: [],
    issues: [],
    filesAnalyzed: 0,
    metrics: { totalLines: 100 },
    ...overrides,
  };
}

function makeFile(metrics = {}) {
  return { path: 'a.js', metrics };
}

function makeIssue(ruleId, severity = 'medium', extra = {}) {
  return { ruleId, severity, filePath: 'a.js', line: 1, message: 'x', ...extra };
}

// ── calculateScores ─────────────────────────────────────────────────────────

describe('calculateScores', () => {
  it('returns overall, label, breakdown, weights, weakest, recommendation', () => {
    const result = makeResult();
    const scores = calculateScores(result, {});
    expect(scores).toHaveProperty('overall');
    expect(scores).toHaveProperty('label');
    expect(scores).toHaveProperty('breakdown');
    expect(scores).toHaveProperty('weights');
    expect(scores).toHaveProperty('weakest');
    expect(scores).toHaveProperty('recommendation');
  });

  it('scores 100 overall for a completely clean project', () => {
    const result = makeResult({
      files: [makeFile({ functions: [], functionCount: 0 })],
      issues: [],
      metrics: { totalLines: 200 },
    });
    const scores = calculateScores(result, {});
    expect(scores.overall).toBe(100);
    expect(scores.label).toBe('Excellent');
  });

  it('overall is clamped to [0, 100]', () => {
    // Inject many severe issues to try to push below 0
    const issues = Array.from({ length: 100 }, () => makeIssue('dependency/circular', 'critical'));
    const result = makeResult({ issues });
    const scores = calculateScores(result, {});
    expect(scores.overall).toBeGreaterThanOrEqual(0);
    expect(scores.overall).toBeLessThanOrEqual(100);
  });

  it('uses default weights that sum to ~1', () => {
    const scores = calculateScores(makeResult(), {});
    const total = Object.values(scores.weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it('respects custom weights from config', () => {
    const config = { scoring: { weights: { complexity: 1, duplication: 0, maintainability: 0, dependencies: 0, hygiene: 0 } } };
    const scores = calculateScores(makeResult(), config);
    expect(scores.weights.complexity).toBeCloseTo(1, 2);
  });

  it('identifies weakest dimension', () => {
    // Force dependency score to be terrible
    const issues = Array.from({ length: 5 }, () => makeIssue('dependency/circular', 'critical'));
    const result = makeResult({ issues });
    const scores = calculateScores(result, {});
    expect(scores.weakest).toBe('dependencies');
  });

  it('recommendation is a non-empty string', () => {
    const scores = calculateScores(makeResult(), {});
    expect(typeof scores.recommendation).toBe('string');
    expect(scores.recommendation.length).toBeGreaterThan(0);
  });
});

// ── complexity sub-score ─────────────────────────────────────────────────────

describe('complexity sub-score', () => {
  it('scores 100 when no functions', () => {
    const result = makeResult({ files: [makeFile({ functions: [] })] });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.complexity.score).toBe(100);
  });

  it('scores 100 when all functions are within thresholds', () => {
    const result = makeResult({
      files: [makeFile({ functions: [{ cyclomatic: 5, cognitive: 10, nesting: 2 }] })],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.complexity.score).toBe(100);
  });

  it('penalises functions exceeding cyclomatic threshold', () => {
    const result = makeResult({
      files: [makeFile({ functions: [{ cyclomatic: 20, cognitive: 0, nesting: 0 }] })],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.complexity.score).toBeLessThan(100);
    expect(breakdown.complexity.reasons.some(r => r.includes('cyclomatic'))).toBe(true);
  });

  it('penalises functions exceeding cognitive threshold', () => {
    const result = makeResult({
      files: [makeFile({ functions: [{ cyclomatic: 1, cognitive: 30, nesting: 0 }] })],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.complexity.reasons.some(r => r.includes('cognitive'))).toBe(true);
  });

  it('penalises deep nesting', () => {
    const result = makeResult({
      files: [makeFile({ functions: [{ cyclomatic: 1, cognitive: 0, nesting: 10 }] })],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.complexity.reasons.some(r => r.includes('nesting'))).toBe(true);
  });

  it('uses config thresholds', () => {
    const config = { thresholds: { cyclomaticComplexity: 5 } };
    const withinDefault = makeResult({
      files: [makeFile({ functions: [{ cyclomatic: 7, cognitive: 0, nesting: 0 }] })],
    });
    // cyclomatic 7 > threshold 5 → penalty
    const { breakdown } = calculateScores(withinDefault, config);
    expect(breakdown.complexity.score).toBeLessThan(100);
  });

  it('raw contains functionCount and maxCC', () => {
    const result = makeResult({
      files: [makeFile({ functions: [{ cyclomatic: 15, cognitive: 0, nesting: 0 }] })],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.complexity.raw.functionCount).toBe(1);
    expect(breakdown.complexity.raw.maxCC).toBe(15);
  });
});

// ── duplication sub-score ───────────────────────────────────────────────────

describe('duplication sub-score', () => {
  it('scores 100 when no duplication', () => {
    const result = makeResult({ files: [makeFile({ duplicationPercent: 0 })] });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.duplication.score).toBe(100);
  });

  it('scores 80 at 10% duplication', () => {
    const result = makeResult({ files: [makeFile({ duplicationPercent: 10 })] });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.duplication.score).toBe(80);
  });

  it('scores 0 at 50% duplication (clamped)', () => {
    const result = makeResult({ files: [makeFile({ duplicationPercent: 50 })] });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.duplication.score).toBe(0);
  });

  it('reports duplicate block count from issues', () => {
    const result = makeResult({
      files: [makeFile({ duplicationPercent: 5 })],
      issues: [makeIssue('duplication/block'), makeIssue('duplication/block')],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.duplication.raw.duplicateBlocks).toBe(2);
  });
});

// ── maintainability sub-score ────────────────────────────────────────────────

describe('maintainability sub-score', () => {
  it('scores 100 with no maintainability issues', () => {
    const result = makeResult({ filesAnalyzed: 5 });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.maintainability.score).toBe(100);
  });

  it('penalises large-file issues', () => {
    const result = makeResult({
      filesAnalyzed: 1,
      issues: [makeIssue('smell/large-file', 'high')],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.maintainability.score).toBeLessThan(100);
    expect(breakdown.maintainability.reasons.some(r => r.includes('exceed the line-count'))).toBe(true);
  });

  it('penalises function-length and parameters', () => {
    const result = makeResult({
      filesAnalyzed: 1,
      issues: [
        makeIssue('complexity/function-length', 'medium'),
        makeIssue('complexity/parameters', 'low'),
      ],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.maintainability.score).toBeLessThan(100);
  });
});

// ── dependencies sub-score ──────────────────────────────────────────────────

describe('dependencies sub-score', () => {
  it('scores 100 with no dependency issues', () => {
    const result = makeResult();
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.dependencies.score).toBe(100);
  });

  it('deducts 15 per circular dependency', () => {
    const result = makeResult({
      issues: [makeIssue('dependency/circular', 'critical')],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.dependencies.score).toBe(85);
  });

  it('caps cycle penalty at 60', () => {
    const result = makeResult({
      issues: Array.from({ length: 10 }, () => makeIssue('dependency/circular', 'critical')),
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.dependencies.raw.cyclePenalty).toBe(60);
  });

  it('deducts 3 per too-many-imports file', () => {
    const result = makeResult({
      issues: [makeIssue('dependency/too-many-imports', 'medium')],
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.dependencies.score).toBe(97);
  });
});

// ── hygiene sub-score ───────────────────────────────────────────────────────

describe('hygiene sub-score', () => {
  it('scores 100 with no hygiene issues', () => {
    const result = makeResult({ metrics: { totalLines: 200 } });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.hygiene.score).toBe(100);
  });

  it('penalises empty-catch', () => {
    const result = makeResult({
      issues: [makeIssue('smell/empty-catch', 'high')],
      metrics: { totalLines: 100 },
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.hygiene.score).toBeLessThan(100);
    expect(breakdown.hygiene.reasons.some(r => r.includes('empty catch'))).toBe(true);
  });

  it('penalises console.log', () => {
    const result = makeResult({
      issues: [makeIssue('hygiene/console-log', 'low')],
      metrics: { totalLines: 100 },
    });
    const { breakdown } = calculateScores(result, {});
    expect(breakdown.hygiene.score).toBeLessThan(100);
  });

  it('density scales with lines of code', () => {
    const issue = makeIssue('smell/unused-vars', 'medium');
    const small = makeResult({ issues: [issue], metrics: { totalLines: 10 } });
    const large = makeResult({ issues: [issue], metrics: { totalLines: 1000 } });
    const smallScore = calculateScores(small, {}).breakdown.hygiene.score;
    const largeScore = calculateScores(large, {}).breakdown.hygiene.score;
    // Same issue, more lines → less density → higher score
    expect(largeScore).toBeGreaterThan(smallScore);
  });
});

// ── sub-score shape ──────────────────────────────────────────────────────────

describe('sub-score shape', () => {
  it('every sub-score has score, label, reasons[], raw{}', () => {
    const scores = calculateScores(makeResult(), {});
    for (const key of ['complexity', 'duplication', 'maintainability', 'dependencies', 'hygiene']) {
      const s = scores.breakdown[key];
      expect(typeof s.score).toBe('number');
      expect(typeof s.label).toBe('string');
      expect(Array.isArray(s.reasons)).toBe(true);
      expect(typeof s.raw).toBe('object');
    }
  });
});
