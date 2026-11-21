/**
 * Score Calculator
 *
 * Converts analysis findings and per-file metrics into five sub-scores
 * (0–100 each) and one weighted overall score.
 *
 * Every score is fully traceable: the returned object explains what data
 * drove it and which thresholds applied.
 *
 * Sub-score domains:
 *   complexity      — cyclomatic / cognitive / nesting violations
 *   duplication     — % of codebase duplicated
 *   maintainability — file size, function length, parameter count smells
 *   dependencies    — circular deps, excessive coupling
 *   hygiene         — unused vars, empty catches, magic numbers, console.log
 */

import { SEVERITY_WEIGHT, scoreLabel, resolveWeights } from './weights.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

function issuesByRule(issues, ruleIds) {
  const set = new Set(Array.isArray(ruleIds) ? ruleIds : [ruleIds]);
  return issues.filter(i => set.has(i.ruleId));
}

function weightedPenalty(issues) {
  return issues.reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] ?? 1), 0);
}

function makeScore(score, reasons, raw = {}) {
  return { score: clamp(score), label: scoreLabel(clamp(score)), reasons, raw };
}

// ── Complexity sub-score ───────────────────────────────────────────────────
//
// Operates directly on per-function metrics collected by the complexity
// analyzer, so it is independent of threshold choices in the rules.
//
// Algorithm:
//   For each function, compute a "badness" value in [0, 1]:
//     cyclomatic:  badness += min(1.0, excess / threshold)
//     cognitive:   badness += min(1.0, excess / threshold)
//     nesting:     badness += min(0.5, excess / threshold)
//   Average badness across all functions.
//   score = 100 × (1 − averageBadness)

function scoreComplexity(result, config) {
  const fnMetrics = result.files.flatMap(f => f.metrics?.functions ?? []);

  if (fnMetrics.length === 0) {
    return makeScore(100, ['No functions found — nothing to score.'], { functionCount: 0 });
  }

  const cyclomaticThreshold = config?.thresholds?.cyclomaticComplexity ?? 10;
  const cognitiveThreshold  = config?.thresholds?.cognitiveComplexity  ?? 15;
  const nestingThreshold    = config?.thresholds?.nestingDepth         ?? 4;

  let totalBadness = 0;
  let ccViolations = 0, cogViolations = 0, nestViolations = 0;
  let maxCC = 0, maxCog = 0, maxNest = 0;

  for (const fn of fnMetrics) {
    let badness = 0;

    if ((fn.cyclomatic ?? 0) > cyclomaticThreshold) {
      badness += Math.min(1.0, (fn.cyclomatic - cyclomaticThreshold) / cyclomaticThreshold);
      ccViolations++;
    }
    if ((fn.cognitive ?? 0) > cognitiveThreshold) {
      badness += Math.min(1.0, (fn.cognitive - cognitiveThreshold) / cognitiveThreshold);
      cogViolations++;
    }
    if ((fn.nesting ?? 0) > nestingThreshold) {
      badness += Math.min(0.5, (fn.nesting - nestingThreshold) / nestingThreshold);
      nestViolations++;
    }

    totalBadness += Math.min(1, badness);
    maxCC   = Math.max(maxCC,   fn.cyclomatic ?? 0);
    maxCog  = Math.max(maxCog,  fn.cognitive  ?? 0);
    maxNest = Math.max(maxNest, fn.nesting    ?? 0);
  }

  const avgBadness = totalBadness / fnMetrics.length;
  const score      = 100 * (1 - avgBadness);
  const pct        = (n) => Math.round((n / fnMetrics.length) * 100);

  const reasons = [];
  if (ccViolations > 0)
    reasons.push(`${ccViolations}/${fnMetrics.length} functions (${pct(ccViolations)}%) exceed cyclomatic complexity threshold (>${cyclomaticThreshold}). Max: ${maxCC}.`);
  if (cogViolations > 0)
    reasons.push(`${cogViolations}/${fnMetrics.length} functions (${pct(cogViolations)}%) exceed cognitive complexity threshold (>${cognitiveThreshold}). Max: ${maxCog}.`);
  if (nestViolations > 0)
    reasons.push(`${nestViolations}/${fnMetrics.length} functions (${pct(nestViolations)}%) have nesting depth above threshold (>${nestingThreshold}). Max: ${maxNest}.`);
  if (reasons.length === 0)
    reasons.push(`All ${fnMetrics.length} functions are within complexity thresholds.`);

  return makeScore(score, reasons, { functionCount: fnMetrics.length, ccViolations, cogViolations, nestViolations, maxCC, maxCog, maxNest, avgBadness: +avgBadness.toFixed(3) });
}

// ── Duplication sub-score ──────────────────────────────────────────────────
//
// Uses the duplication percentage attached by the duplication analyzer.
// Curve: score = 100 − dupPercent × 2.0
//   0 % dup  → 100
//  10 % dup  →  80
//  25 % dup  →  50
//  50 % dup  →   0

function scoreDuplication(result) {
  const dupPercent = _getFirstMetric(result, 'duplicationPercent') ?? 0;
  const dupFindings = issuesByRule(result.issues, 'duplication/block');

  const score = 100 - dupPercent * 2.0;
  const reasons = [];

  if (dupPercent === 0 && dupFindings.length === 0) {
    reasons.push('No duplicate code blocks detected.');
  } else {
    if (dupPercent > 0)
      reasons.push(`Approximately ${dupPercent}% of project lines are duplicated.`);
    if (dupFindings.length > 0)
      reasons.push(`${dupFindings.length} duplicate code block${dupFindings.length !== 1 ? 's' : ''} detected.`);
  }

  return makeScore(score, reasons, { duplicationPercent: dupPercent, duplicateBlocks: dupFindings.length });
}

// ── Maintainability sub-score ──────────────────────────────────────────────
//
// Covers: file size (smell/large-file), function length (complexity/function-length),
// and parameter excess (complexity/parameters).
//
// Penalty = weighted issues / max(1, filesAnalyzed + functionCount)
// score = 100 − penalty × 10   (capped at 0)
// Calibrated so ~1 high-severity issue per 2 files ≈ score 75.

function scoreMaintainability(result) {
  const relevantRules = [
    'smell/large-file',
    'complexity/function-length',
    'complexity/parameters',
  ];
  const relevant = issuesByRule(result.issues, relevantRules);
  const penalty  = weightedPenalty(relevant);

  const fnCount   = result.files.reduce((s, f) => s + (f.metrics?.functionCount ?? 0), 0);
  const fileCount = result.filesAnalyzed ?? 1;
  const units     = Math.max(1, fileCount + fnCount);

  const normalised = penalty / units;
  const score      = 100 - normalised * 10;

  const reasons = [];
  const largeFiles = issuesByRule(result.issues, 'smell/large-file').length;
  const longFns    = issuesByRule(result.issues, 'complexity/function-length').length;
  const tooManyP   = issuesByRule(result.issues, 'complexity/parameters').length;

  if (largeFiles > 0)  reasons.push(`${largeFiles} file${largeFiles !== 1 ? 's' : ''} exceed the line-count threshold.`);
  if (longFns > 0)     reasons.push(`${longFns} function${longFns !== 1 ? 's' : ''} are excessively long.`);
  if (tooManyP > 0)    reasons.push(`${tooManyP} function${tooManyP !== 1 ? 's' : ''} have too many parameters.`);
  if (reasons.length === 0) reasons.push('No maintainability issues detected.');

  return makeScore(score, reasons, { largeFiles, longFunctions: longFns, tooManyParams: tooManyP, penalty, units });
}

// ── Dependencies sub-score ─────────────────────────────────────────────────
//
// Deductions:
//   Each circular dependency cycle costs 15 points (max 60 total).
//   Each too-many-imports file costs 3 points (max 20 total).
// Floor: 0.

function scoreDependencies(result) {
  const cycleFindings    = issuesByRule(result.issues, 'dependency/circular');
  const tooManyFindings  = issuesByRule(result.issues, 'dependency/too-many-imports');

  const cyclePenalty    = Math.min(60, cycleFindings.length * 15);
  const couplingPenalty = Math.min(20, tooManyFindings.length * 3);
  const score           = 100 - cyclePenalty - couplingPenalty;

  const reasons = [];
  if (cycleFindings.length > 0)
    reasons.push(`${cycleFindings.length} circular dependenc${cycleFindings.length !== 1 ? 'ies' : 'y'} detected. Each costs −15 points.`);
  if (tooManyFindings.length > 0)
    reasons.push(`${tooManyFindings.length} file${tooManyFindings.length !== 1 ? 's' : ''} import too many local modules.`);
  if (reasons.length === 0)
    reasons.push('No dependency issues detected.');

  return makeScore(score, reasons, { cycles: cycleFindings.length, tooManyImports: tooManyFindings.length, cyclePenalty, couplingPenalty });
}

// ── Hygiene sub-score ──────────────────────────────────────────────────────
//
// Rules: smell/unused-vars, smell/empty-catch, smell/magic-numbers,
//        hygiene/console-log
//
// Density = weighted_issues / (totalLines / 100)
//   (issues per 100 lines)
// score = 100 − density × 5
// Calibrated so 4 high-severity issues per 100 lines ≈ score 40.

function scoreHygiene(result) {
  const hygieneRules = [
    'smell/unused-vars',
    'smell/empty-catch',
    'smell/magic-numbers',
    'hygiene/console-log',
  ];
  const hygieneIssues = issuesByRule(result.issues, hygieneRules);
  const totalLines    = result.metrics?.totalLines ?? 1;

  const penalty  = weightedPenalty(hygieneIssues);
  const density  = penalty / Math.max(1, totalLines / 100); // per 100 lines
  const score    = 100 - density * 5;

  const countBy = hygieneRules.reduce((acc, id) => {
    acc[id] = issuesByRule(result.issues, id).length;
    return acc;
  }, {});

  const reasons = [];
  if (countBy['smell/empty-catch'] > 0)
    reasons.push(`${countBy['smell/empty-catch']} empty catch block${countBy['smell/empty-catch'] !== 1 ? 's' : ''} silently swallow errors.`);
  if (countBy['smell/unused-vars'] > 0)
    reasons.push(`${countBy['smell/unused-vars']} unused variable${countBy['smell/unused-vars'] !== 1 ? 's' : ''} declared.`);
  if (countBy['smell/magic-numbers'] > 0)
    reasons.push(`${countBy['smell/magic-numbers']} magic number literal${countBy['smell/magic-numbers'] !== 1 ? 's' : ''}.`);
  if (countBy['hygiene/console-log'] > 0)
    reasons.push(`${countBy['hygiene/console-log']} console.log statement${countBy['hygiene/console-log'] !== 1 ? 's' : ''} in production code.`);
  if (reasons.length === 0)
    reasons.push('No hygiene issues detected.');

  return makeScore(score, reasons, { totalLines, density: +density.toFixed(3), issueCounts: countBy });
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Calculate all scores for an analysis result.
 *
 * @param {object} result  — the full object returned by Analyzer.analyze()
 * @param {object} config  — the merged codepulse config
 * @returns {object}       — scores object attached to result.scores
 */
export function calculateScores(result, config) {
  const weights = resolveWeights(config?.scoring?.weights);

  const complexity      = scoreComplexity(result, config);
  const duplication     = scoreDuplication(result);
  const maintainability = scoreMaintainability(result);
  const dependencies    = scoreDependencies(result);
  const hygiene         = scoreHygiene(result);

  const overall = clamp(
    complexity.score      * weights.complexity      +
    duplication.score     * weights.duplication     +
    maintainability.score * weights.maintainability +
    dependencies.score    * weights.dependencies    +
    hygiene.score         * weights.hygiene
  );

  // Identify the weakest dimension for the actionable summary
  const breakdown = { complexity, duplication, maintainability, dependencies, hygiene };
  const weakest   = Object.entries(breakdown).sort(([, a], [, b]) => a.score - b.score)[0][0];

  return {
    overall,
    label:    scoreLabel(overall),
    breakdown,
    weights,
    weakest,
    // Human-readable top recommendation
    recommendation: _topRecommendation(weakest, breakdown[weakest]),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _getFirstMetric(result, key) {
  for (const f of result.files) {
    if (f.metrics?.[key] !== undefined) return f.metrics[key];
  }
  return undefined;
}

function _topRecommendation(weakest, subScore) {
  const map = {
    complexity:      'Focus on reducing cyclomatic and cognitive complexity in your most complex functions.',
    duplication:     'Eliminate duplicate code blocks by extracting shared logic into reusable utilities.',
    maintainability: 'Break up large files and long functions into smaller, focused modules.',
    dependencies:    'Resolve circular dependencies by extracting shared code into a neutral module.',
    hygiene:         'Clean up unused variables, empty catch blocks, and magic numbers.',
  };
  return map[weakest] ?? 'Review the most critical issues highlighted above.';
}
