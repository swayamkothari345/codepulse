import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseFile, countLines } from '../../src/utils/ast-utils.js';
import { analyze } from '../../src/analyzers/smells/index.js';
import { clearRegistry } from '../../src/rules/registry.js';
import { _resetDefaultRules } from '../../src/rules/defaults.js';
import { DEFAULT_CONFIG } from '../../src/config/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.join(__dirname, '../fixtures');

let tmpDir;

function writeTmp(name, content) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepulse-smells-')); });
afterAll(()  => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

beforeEach(() => {
  clearRegistry();
  _resetDefaultRules();
});

function makeResult(filePath) {
  const { ast, code, error } = parseFile(filePath);
  return {
    path: filePath,
    relativePath: path.basename(filePath),
    ast, code, error: error?.message ?? null,
    lines: countLines(code),
    issues: [],
    metrics: {},
  };
}

// ── Large File ─────────────────────────────────────────────────────────────

describe('smell/large-file', () => {
  it('flags a file that exceeds the threshold', async () => {
    // Create a file with 600 lines
    const lines = Array.from({ length: 600 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const p = writeTmp('large.js', lines);
    const r = makeResult(p);

    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { fileLength: 500 } });
    expect(findings.some(f => f.ruleId === 'smell/large-file')).toBe(true);
  });

  it('does not flag a file within the threshold', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const p = writeTmp('small.js', lines);
    const r = makeResult(p);

    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/large-file')).toHaveLength(0);
  });

  it('finding points to line 1', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const p = writeTmp('large2.js', lines);
    const r = makeResult(p);

    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { fileLength: 500 } });
    const f = findings.find(f => f.ruleId === 'smell/large-file');
    expect(f?.line).toBe(1);
  });
});

// ── Empty Catch ────────────────────────────────────────────────────────────

describe('smell/empty-catch', () => {
  it('detects an empty catch block', async () => {
    const p = writeTmp('empty-catch.js', `
      async function fetchData(url) {
        try {
          const r = await fetch(url);
          return r.json();
        } catch (e) {
          // intentionally empty
        }
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.some(f => f.ruleId === 'smell/empty-catch')).toBe(true);
  });

  it('does not flag a catch with statements', async () => {
    const p = writeTmp('handled-catch.js', `
      function f() {
        try { return 1; }
        catch (e) { console.error(e); return 0; }
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/empty-catch')).toHaveLength(0);
  });

  it('detects empty-catch in the complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    const emptyCatch = findings.filter(f => f.ruleId === 'smell/empty-catch');
    expect(emptyCatch.length).toBeGreaterThan(0);
  });

  it('finding has a positive line number', async () => {
    const p = writeTmp('empty-catch2.js', 'function f(){\ntry{return 1;}\ncatch(e){}\n}');
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    const f = findings.find(f => f.ruleId === 'smell/empty-catch');
    expect(f?.line).toBeGreaterThan(0);
  });
});

// ── Magic Numbers ──────────────────────────────────────────────────────────

describe('smell/magic-numbers', () => {
  it('flags an unexplained numeric literal', async () => {
    const p = writeTmp('magic.js', 'function tax(price) { return price * 0.07; }');
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.some(f => f.ruleId === 'smell/magic-numbers')).toBe(true);
  });

  it('does not flag numbers in the ignore list (0, 1, -1, 2)', async () => {
    const p = writeTmp('no-magic.js', `
      function f(arr) {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        return arr[arr.length - 1];
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/magic-numbers')).toHaveLength(0);
  });

  it('does not flag numbers on the right of a const declaration', async () => {
    // const TIMEOUT = 5000; — this names the number, so it's fine
    const p = writeTmp('named-const.js', 'const TIMEOUT = 5000; const MAX = 100;');
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/magic-numbers')).toHaveLength(0);
  });

  it('detects magic numbers in complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    const magic = findings.filter(f => f.ruleId === 'smell/magic-numbers');
    expect(magic.length).toBeGreaterThan(0);
  });

  it('finding message includes the actual number', async () => {
    const p = writeTmp('magic2.js', 'function f(x){ return x * 42; }');
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    const f = findings.find(f => f.ruleId === 'smell/magic-numbers');
    expect(f?.message).toContain('42');
  });

  it('respects custom ignore list', async () => {
    const p = writeTmp('magic3.js', 'function f(x){ return x * 42; }');
    const r = makeResult(p);
    const config = { ...DEFAULT_CONFIG, thresholds: { magicNumberIgnore: [0, 1, -1, 2, 42, 100] } };
    const findings = await analyze([r], config);
    expect(findings.filter(f => f.ruleId === 'smell/magic-numbers')).toHaveLength(0);
  });
});

// ── Unused Variables ───────────────────────────────────────────────────────

describe('smell/unused-vars', () => {
  it('detects an unused variable', async () => {
    const p = writeTmp('unused.js', `
      export function greet(name) {
        const prefix = 'Hello';
        return 'Hi, ' + name;
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.some(f => f.ruleId === 'smell/unused-vars')).toBe(true);
  });

  it('does not flag a variable that is used', async () => {
    const p = writeTmp('used.js', `
      export function double(n) {
        const result = n * 2;
        return result;
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/unused-vars')).toHaveLength(0);
  });

  it('ignores variables prefixed with _', async () => {
    const p = writeTmp('underscore.js', `
      export function f(a, b) {
        const _ignored = computeSomething();
        return a + b;
      }
      function computeSomething() { return 1; }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/unused-vars')).toHaveLength(0);
  });

  it('finding includes the variable name in the message', async () => {
    const p = writeTmp('unused2.js', `
      export function f() {
        const myUnusedVar = 42;
        return 0;
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    const f = findings.find(f => f.ruleId === 'smell/unused-vars');
    expect(f?.message).toContain('myUnusedVar');
  });

  it('detects the unused variable in complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/unused-vars').length).toBeGreaterThan(0);
  });

  it('does not flag variables used in closures', async () => {
    const p = writeTmp('closure.js', `
      export function makeCounter() {
        let count = 0;
        return () => ++count;
      }
    `);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'smell/unused-vars')).toHaveLength(0);
  });
});

// ── General analyzer contract tests ───────────────────────────────────────

describe('smells analyze() contract', () => {
  it('every finding has required fields', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    for (const f of findings) {
      expect(f).toHaveProperty('ruleId');
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('filePath');
      expect(f).toHaveProperty('line');
      expect(f).toHaveProperty('message');
      expect(f).toHaveProperty('why');
      expect(f).toHaveProperty('suggestion');
    }
  });

  it('clean fixture produces no smell findings', async () => {
    const r = makeResult(path.join(FIXTURES, 'clean.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    // clean.js shouldn't trigger empty-catch or large-file
    expect(findings.filter(f => f.ruleId === 'smell/empty-catch')).toHaveLength(0);
    expect(findings.filter(f => f.ruleId === 'smell/large-file')).toHaveLength(0);
  });

  it('skips files with parse errors', async () => {
    const r = { path: '/bad.js', ast: null, error: 'oops', issues: [], metrics: {}, lines: 0 };
    expect(await analyze([r], DEFAULT_CONFIG)).toHaveLength(0);
  });

  it('attaches smell metrics to fileResult', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    await analyze([r], DEFAULT_CONFIG);
    expect(r.metrics).toHaveProperty('lines');
  });
});
