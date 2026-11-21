/**
 * Default scoring weights and helper constants.
 *
 * Weights must sum to 1.0.  They can be overridden in codepulse.config.js:
 *   scoring: { weights: { complexity: 0.4, duplication: 0.1, … } }
 */

export const DEFAULT_WEIGHTS = {
  complexity:      0.30,
  duplication:     0.20,
  maintainability: 0.25,
  dependencies:    0.15,
  hygiene:         0.10,
};

/** Penalty multiplier per severity level. */
export const SEVERITY_WEIGHT = {
  critical: 4,
  high:     3,
  medium:   2,
  low:      1,
};

/** Human-readable grade labels mapped from score bands. */
export const SCORE_LABELS = [
  { min: 90, label: 'Excellent' },
  { min: 80, label: 'Good'      },
  { min: 70, label: 'Fair'      },
  { min: 60, label: 'Needs Attention' },
  { min: 50, label: 'Poor'      },
  { min:  0, label: 'Critical'  },
];

export function scoreLabel(score) {
  for (const { min, label } of SCORE_LABELS) {
    if (score >= min) return label;
  }
  return 'Critical';
}

/**
 * Validate and normalise a user-supplied weights object.
 * Missing keys are filled from defaults; the result is re-normalised to sum=1.
 */
export function resolveWeights(userWeights) {
  const merged = { ...DEFAULT_WEIGHTS, ...(userWeights ?? {}) };
  const total  = Object.values(merged).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 1) < 0.001) return merged;

  // Silently re-normalise rather than crashing
  const factor = 1 / total;
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, +(v * factor).toFixed(4)]));
}
