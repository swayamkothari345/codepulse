/**
 * Phase 8 tests: config validator, loader (JSON support, env-var overrides), mergeConfig.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateConfig } from '../../src/config/validator.js';
import { mergeConfig, applyEnvOverrides, DEFAULT_CONFIG } from '../../src/config/loader.js';

// ── validateConfig ────────────────────────────────────────────────────────────

describe('validateConfig', () => {
  it('returns valid=true for a minimal valid config', () => {
    const { valid, errors } = validateConfig({ ignore: [], extensions: ['.js'] });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('returns valid=false for non-object input', () => {
    expect(validateConfig(null).valid).toBe(false);
    expect(validateConfig('string').valid).toBe(false);
  });

  it('errors if ignore is not an array', () => {
    const { valid, errors } = validateConfig({ ignore: 'node_modules' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"ignore"'))).toBe(true);
  });

  it('errors if ignore contains non-strings', () => {
    const { valid, errors } = validateConfig({ ignore: [42] });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('ignore[0]'))).toBe(true);
  });

  it('errors if extensions is not an array', () => {
    const { valid, errors } = validateConfig({ extensions: '.js' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"extensions"'))).toBe(true);
  });

  it('warns if extension missing leading dot', () => {
    const { valid, warnings } = validateConfig({ extensions: ['js'] });
    expect(valid).toBe(true);
    expect(warnings.some(w => w.includes('should start with "."'))).toBe(true);
  });

  it('errors if rules is not an object', () => {
    const { valid, errors } = validateConfig({ rules: ['complexity/cyclomatic'] });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"rules"'))).toBe(true);
  });

  it('allows rule set to "off"', () => {
    const { valid } = validateConfig({ rules: { 'complexity/cyclomatic': 'off' } });
    expect(valid).toBe(true);
  });

  it('allows rule set to false', () => {
    const { valid } = validateConfig({ rules: { 'complexity/cyclomatic': false } });
    expect(valid).toBe(true);
  });

  it('errors if rule has invalid severity', () => {
    const { valid, errors } = validateConfig({
      rules: { 'complexity/cyclomatic': { severity: 'extreme' } },
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('severity'))).toBe(true);
  });

  it('warns on unknown rule ID prefix', () => {
    const { warnings } = validateConfig({
      rules: { 'custom/my-rule': { severity: 'low' } },
    });
    expect(warnings.some(w => w.includes('Unknown rule ID'))).toBe(true);
  });

  it('errors if rule options is not an object', () => {
    const { valid, errors } = validateConfig({
      rules: { 'complexity/cyclomatic': { severity: 'high', options: 'bad' } },
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"options"'))).toBe(true);
  });

  it('errors if threshold value is not a positive number', () => {
    const { valid, errors } = validateConfig({ thresholds: { cyclomaticComplexity: -5 } });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('thresholds.cyclomaticComplexity'))).toBe(true);
  });

  it('errors if threshold value is a string', () => {
    const { valid, errors } = validateConfig({ thresholds: { nestingDepth: 'deep' } });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('thresholds.nestingDepth'))).toBe(true);
  });

  it('allows valid thresholds', () => {
    const { valid } = validateConfig({ thresholds: { cyclomaticComplexity: 10, nestingDepth: 4 } });
    expect(valid).toBe(true);
  });

  it('errors if scoring.weights is not an object', () => {
    const { valid, errors } = validateConfig({ scoring: { weights: [0.3, 0.2] } });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"scoring.weights"'))).toBe(true);
  });

  it('errors if weight value is negative', () => {
    const { valid, errors } = validateConfig({ scoring: { weights: { complexity: -0.1 } } });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('scoring.weights.complexity'))).toBe(true);
  });

  it('warns if weights do not sum to ~1', () => {
    const { warnings } = validateConfig({
      scoring: { weights: { complexity: 0.5, duplication: 0.5, maintainability: 0.5, dependencies: 0.5, hygiene: 0.5 } },
    });
    expect(warnings.some(w => w.includes('auto-normalised'))).toBe(true);
  });

  it('warns on unknown weight key', () => {
    const { warnings } = validateConfig({ scoring: { weights: { unknown_dim: 0.3 } } });
    expect(warnings.some(w => w.includes('Unknown scoring weight key'))).toBe(true);
  });

  it('errors if output.format is invalid', () => {
    const { valid, errors } = validateConfig({ output: { format: 'pdf' } });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('"output.format"'))).toBe(true);
  });

  it('allows valid output format', () => {
    const { valid } = validateConfig({ output: { format: 'json' } });
    expect(valid).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const { valid, errors } = validateConfig({
      ignore: 'bad',
      extensions: 'bad',
      output: { format: 'pdf' },
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── mergeConfig ───────────────────────────────────────────────────────────────

describe('mergeConfig', () => {
  it('returns a copy of base when overrides is empty', () => {
    const result = mergeConfig(DEFAULT_CONFIG, {});
    expect(result.extensions).toEqual(DEFAULT_CONFIG.extensions);
  });

  it('overrides top-level keys', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { ignore: ['vendor'] });
    expect(result.ignore).toEqual(['vendor']);
  });

  it('deep-merges scoring.weights', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { scoring: { weights: { complexity: 0.5 } } });
    expect(result.scoring.weights.complexity).toBe(0.5);
    expect(result.scoring.weights.hygiene).toBe(DEFAULT_CONFIG.scoring.weights.hygiene);
  });

  it('deep-merges rules', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { rules: { 'smell/empty-catch': 'off' } });
    expect(result.rules['smell/empty-catch']).toBe('off');
  });

  it('handles null/undefined overrides gracefully', () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, null)).not.toThrow();
    expect(() => mergeConfig(DEFAULT_CONFIG, undefined)).not.toThrow();
  });
});

// ── applyEnvOverrides ─────────────────────────────────────────────────────────

describe('applyEnvOverrides', () => {
  const saved = {};
  const ENV_KEYS = ['CODEPULSE_FORMAT', 'CODEPULSE_SEVERITY', 'CODEPULSE_FAIL_ON', 'CODEPULSE_MAX_WARNINGS'];

  beforeEach(() => {
    ENV_KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
  });
  afterEach(() => {
    ENV_KEYS.forEach(k => {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    });
  });

  it('returns config unchanged when no env vars set', () => {
    const cfg = { output: { format: 'terminal' } };
    const result = applyEnvOverrides(cfg);
    expect(result.output.format).toBe('terminal');
  });

  it('applies CODEPULSE_FORMAT', () => {
    process.env.CODEPULSE_FORMAT = 'json';
    const result = applyEnvOverrides({ output: {} });
    expect(result.output.format).toBe('json');
  });

  it('applies CODEPULSE_SEVERITY', () => {
    process.env.CODEPULSE_SEVERITY = 'high';
    const result = applyEnvOverrides({ output: {} });
    expect(result.output.severity).toBe('high');
  });

  it('applies CODEPULSE_FAIL_ON', () => {
    process.env.CODEPULSE_FAIL_ON = 'critical';
    const result = applyEnvOverrides({});
    expect(result.failOn).toBe('critical');
  });

  it('applies CODEPULSE_MAX_WARNINGS as a number', () => {
    process.env.CODEPULSE_MAX_WARNINGS = '20';
    const result = applyEnvOverrides({});
    expect(result.maxWarnings).toBe(20);
  });

  it('ignores CODEPULSE_MAX_WARNINGS if not a number', () => {
    process.env.CODEPULSE_MAX_WARNINGS = 'nope';
    const result = applyEnvOverrides({});
    expect(result.maxWarnings).toBeUndefined();
  });

  it('env vars take precedence over file config', () => {
    process.env.CODEPULSE_FORMAT = 'html';
    const result = applyEnvOverrides({ output: { format: 'terminal' } });
    expect(result.output.format).toBe('html');
  });
});

// ── JSON config loading ───────────────────────────────────────────────────────

describe('loadConfig with JSON file', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cp-cfg-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid .codepulserc.json', async () => {
    const { loadConfig } = await import('../../src/config/loader.js');
    const cfgPath = join(tmpDir, '.codepulserc.json');
    writeFileSync(cfgPath, JSON.stringify({ ignore: ['vendor'], extensions: ['.js'] }), 'utf8');
    const config = await loadConfig(cfgPath);
    expect(config.ignore).toContain('vendor');
    expect(config.extensions).toContain('.js');
  });

  it('throws on malformed JSON', async () => {
    const { loadConfig } = await import('../../src/config/loader.js');
    const cfgPath = join(tmpDir, '.codepulserc.json');
    writeFileSync(cfgPath, '{ invalid json }', 'utf8');
    await expect(loadConfig(cfgPath)).rejects.toThrow();
  });

  it('merges JSON config with defaults', async () => {
    const { loadConfig } = await import('../../src/config/loader.js');
    const cfgPath = join(tmpDir, 'codepulse.config.json');
    writeFileSync(cfgPath, JSON.stringify({ scoring: { weights: { complexity: 0.5 } } }), 'utf8');
    const config = await loadConfig(cfgPath);
    expect(config.scoring.weights.complexity).toBe(0.5);
    expect(config.scoring.weights.hygiene).toBe(DEFAULT_CONFIG.scoring.weights.hygiene);
  });
});
