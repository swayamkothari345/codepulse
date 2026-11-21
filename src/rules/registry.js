/**
 * Central rule registry.
 *
 * Rule schema:
 * {
 *   id:             string   — unique, e.g. 'complexity/cyclomatic'
 *   name:           string   — human-readable
 *   description:    string
 *   category:       string   — 'complexity' | 'duplication' | 'smell' | 'dependency' | 'hygiene'
 *   severity:       string   — 'critical' | 'high' | 'medium' | 'low'
 *   defaultOptions: object   — rule-specific tunables
 *   enabled:        boolean
 * }
 */

const _rules = new Map();

export function registerRule(rule) {
  if (!rule.id) throw new Error('Rule must have an id');
  if (!rule.category) throw new Error(`Rule "${rule.id}" must have a category`);
  if (!rule.severity) throw new Error(`Rule "${rule.id}" must have a severity`);
  _rules.set(rule.id, { enabled: true, defaultOptions: {}, ...rule });
}

export function getRule(id) {
  return _rules.get(id) ?? null;
}

export function getAllRules() {
  return [..._rules.values()];
}

export function getRulesByCategory(category) {
  return [..._rules.values()].filter(r => r.category === category);
}

export function isEnabled(id) {
  return _rules.get(id)?.enabled !== false;
}

/**
 * Apply user config overrides. Called once during startup after rules are registered.
 *
 * Config format:
 *   rules: {
 *     'complexity/cyclomatic': 'off',
 *     'smell/magic-numbers': { severity: 'high', options: { ignore: [0, 1] } }
 *   }
 */
export function applyRulesConfig(rulesConfig) {
  if (!rulesConfig || typeof rulesConfig !== 'object') return;

  for (const [id, config] of Object.entries(rulesConfig)) {
    const rule = _rules.get(id);
    if (!rule) continue;

    if (config === 'off' || config === false) {
      rule.enabled = false;
      continue;
    }

    if (typeof config === 'object') {
      if (config.enabled === false) rule.enabled = false;
      if (config.severity) rule.severity = config.severity;
      if (config.options) rule.defaultOptions = { ...rule.defaultOptions, ...config.options };
    }
  }
}

/**
 * Reset the registry (useful in tests).
 */
export function clearRegistry() {
  _rules.clear();
}
