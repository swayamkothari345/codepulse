import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

export const DEFAULT_CONFIG = {
  // Glob patterns to ignore (on top of built-in defaults)
  ignore: [],

  // File extensions to analyze
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],

  // Rule-level overrides: { 'rule/id': { severity, options } | 'off' }
  rules: {},

  // Per-rule threshold overrides (shorthand)
  thresholds: {},

  // Scoring weights — must conceptually sum to 1.0
  scoring: {
    weights: {
      complexity:      0.30,
      duplication:     0.20,
      maintainability: 0.25,
      dependencies:    0.15,
      hygiene:         0.10,
    },
  },

  // Output defaults
  output: {
    format: 'terminal',
  },
};

/**
 * Load configuration from an explicit path or by searching the cwd.
 * Falls back to DEFAULT_CONFIG if nothing is found.
 *
 * Supported file formats (searched in order):
 *   codepulse.config.js   — ES module exporting a default object
 *   .codepulserc.js       — same
 *   .codepulserc.json     — plain JSON object
 *
 * After file config is resolved, environment variable overrides are applied:
 *   CODEPULSE_FAIL_ON        — equivalent to --fail-on <severity>
 *   CODEPULSE_MAX_WARNINGS   — equivalent to --max-warnings <n>
 *   CODEPULSE_SEVERITY       — minimum severity for terminal output
 *   CODEPULSE_FORMAT         — output format: terminal|json|html
 */
export async function loadConfig(configPath) {
  let fileConfig = null;

  if (configPath) {
    fileConfig = await _loadFile(path.resolve(configPath));
    if (!fileConfig) throw new Error(`Config file not found: ${configPath}`);
  } else {
    const candidates = [
      path.join(process.cwd(), 'codepulse.config.js'),
      path.join(process.cwd(), '.codepulserc.js'),
      path.join(process.cwd(), '.codepulserc.json'),
    ];
    for (const candidate of candidates) {
      fileConfig = await _loadFile(candidate);
      if (fileConfig) break;
    }
  }

  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig ?? {});
  return applyEnvOverrides(merged);
}

async function _loadFile(filePath) {
  if (!existsSync(filePath)) return null;

  // JSON config
  if (filePath.endsWith('.json')) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse JSON config at ${filePath}: ${e.message}`);
    }
  }

  // JS module config
  try {
    const url = pathToFileURL(filePath).href;
    const mod = await import(url);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

/**
 * Apply CODEPULSE_* environment variable overrides onto a merged config.
 * Env vars set at the CI/CD level take precedence over file config.
 *
 * @param {object} config
 * @returns {object}
 */
export function applyEnvOverrides(config) {
  const result = { ...config, output: { ...(config.output ?? {}) } };

  if (process.env.CODEPULSE_FORMAT) {
    result.output.format = process.env.CODEPULSE_FORMAT;
  }
  if (process.env.CODEPULSE_SEVERITY) {
    result.output.severity = process.env.CODEPULSE_SEVERITY;
  }
  if (process.env.CODEPULSE_FAIL_ON) {
    result.failOn = process.env.CODEPULSE_FAIL_ON;
  }
  if (process.env.CODEPULSE_MAX_WARNINGS) {
    const n = parseInt(process.env.CODEPULSE_MAX_WARNINGS, 10);
    if (!isNaN(n)) result.maxWarnings = n;
  }

  return result;
}

/**
 * Deep-merge user config over base defaults.
 */
export function mergeConfig(base, overrides) {
  if (!overrides || typeof overrides !== 'object') return { ...base };
  return {
    ...base,
    ...overrides,
    scoring: {
      ...base.scoring,
      ...(overrides.scoring ?? {}),
      weights: {
        ...base.scoring.weights,
        ...(overrides.scoring?.weights ?? {}),
      },
    },
    rules: {
      ...base.rules,
      ...(overrides.rules ?? {}),
    },
  };
}
