/**
 * Config Validator
 *
 * Validates a merged config object and returns a structured report so the CLI
 * can surface problems early — before analysis starts — with clear messages.
 *
 * Usage:
 *   const { valid, errors, warnings } = validateConfig(config);
 *   if (!valid) { errors.forEach(e => logger.error(e)); process.exit(1); }
 *   warnings.forEach(w => logger.warn(w));
 */

const VALID_SEVERITIES   = new Set(['critical', 'high', 'medium', 'low']);
const VALID_FORMATS      = new Set(['terminal', 'json', 'html']);
const KNOWN_RULE_PREFIXES = ['complexity/', 'smell/', 'duplication/', 'dependency/', 'hygiene/'];
const WEIGHT_KEYS        = ['complexity', 'duplication', 'maintainability', 'dependencies', 'hygiene'];

/**
 * @param {object} config — a merged codepulse config object
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateConfig(config) {
  const errors   = [];
  const warnings = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be a plain object.'], warnings };
  }

  // ── ignore ────────────────────────────────────────────────────────────────
  if (config.ignore !== undefined) {
    if (!Array.isArray(config.ignore)) {
      errors.push('"ignore" must be an array of glob strings.');
    } else {
      config.ignore.forEach((p, i) => {
        if (typeof p !== 'string') errors.push(`"ignore[${i}]" must be a string.`);
      });
    }
  }

  // ── extensions ────────────────────────────────────────────────────────────
  if (config.extensions !== undefined) {
    if (!Array.isArray(config.extensions)) {
      errors.push('"extensions" must be an array of strings like [".js", ".mjs"].');
    } else {
      config.extensions.forEach((e, i) => {
        if (typeof e !== 'string') {
          errors.push(`"extensions[${i}]" must be a string.`);
        } else if (!e.startsWith('.')) {
          warnings.push(`"extensions[${i}]" ("${e}") should start with "." — did you mean ".${e}"?`);
        }
      });
    }
  }

  // ── rules ─────────────────────────────────────────────────────────────────
  if (config.rules !== undefined) {
    if (typeof config.rules !== 'object' || Array.isArray(config.rules)) {
      errors.push('"rules" must be a plain object mapping rule IDs to config.');
    } else {
      for (const [id, val] of Object.entries(config.rules)) {
        const knownPrefix = KNOWN_RULE_PREFIXES.some(p => id.startsWith(p));
        if (!knownPrefix) {
          warnings.push(`Unknown rule ID "${id}". Known prefixes: ${KNOWN_RULE_PREFIXES.join(', ')}`);
        }
        if (val === 'off' || val === false) continue;
        if (typeof val === 'object' && val !== null) {
          if (val.severity !== undefined && !VALID_SEVERITIES.has(val.severity)) {
            errors.push(`Rule "${id}": severity must be one of ${[...VALID_SEVERITIES].join('|')}, got "${val.severity}".`);
          }
          if (val.options !== undefined && (typeof val.options !== 'object' || Array.isArray(val.options))) {
            errors.push(`Rule "${id}": "options" must be a plain object.`);
          }
        } else {
          errors.push(`Rule "${id}": value must be "off", false, or { severity, options }.`);
        }
      }
    }
  }

  // ── thresholds ────────────────────────────────────────────────────────────
  if (config.thresholds !== undefined) {
    if (typeof config.thresholds !== 'object' || Array.isArray(config.thresholds)) {
      errors.push('"thresholds" must be a plain object.');
    } else {
      for (const [key, val] of Object.entries(config.thresholds)) {
        if (typeof val !== 'number' || val <= 0 || !isFinite(val)) {
          errors.push(`"thresholds.${key}" must be a positive finite number, got ${JSON.stringify(val)}.`);
        }
      }
    }
  }

  // ── scoring.weights ───────────────────────────────────────────────────────
  if (config.scoring !== undefined) {
    if (typeof config.scoring !== 'object' || Array.isArray(config.scoring)) {
      errors.push('"scoring" must be a plain object.');
    } else if (config.scoring.weights !== undefined) {
      const w = config.scoring.weights;
      if (typeof w !== 'object' || Array.isArray(w)) {
        errors.push('"scoring.weights" must be a plain object.');
      } else {
        for (const key of Object.keys(w)) {
          if (!WEIGHT_KEYS.includes(key)) {
            warnings.push(`Unknown scoring weight key "${key}". Known keys: ${WEIGHT_KEYS.join(', ')}.`);
          }
        }
        for (const key of WEIGHT_KEYS) {
          const v = w[key];
          if (v !== undefined) {
            if (typeof v !== 'number' || v < 0 || !isFinite(v)) {
              errors.push(`"scoring.weights.${key}" must be a non-negative finite number, got ${JSON.stringify(v)}.`);
            }
          }
        }
        const total = WEIGHT_KEYS.reduce((s, k) => s + (w[k] ?? 0), 0);
        if (total > 0 && Math.abs(total - 1) > 0.01) {
          warnings.push(`Scoring weights sum to ${total.toFixed(3)} — they will be auto-normalised to 1.0.`);
        }
      }
    }
  }

  // ── output.format ─────────────────────────────────────────────────────────
  if (config.output?.format !== undefined && !VALID_FORMATS.has(config.output.format)) {
    errors.push(`"output.format" must be one of ${[...VALID_FORMATS].join('|')}, got "${config.output.format}".`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
