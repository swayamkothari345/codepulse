import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { normalizeNode, normalizeStatements } from '../../src/analyzers/duplication/normalizer.js';
import { analyze } from '../../src/analyzers/duplication/index.js';
import { parseFile, countLines } from '../../src/utils/ast-utils.js';
import { clearRegistry } from '../../src/rules/registry.js';
import { _resetDefaultRules } from '../../src/rules/defaults.js';
import { DEFAULT_CONFIG } from '../../src/config/loader.js';
import { parse } from '@babel/parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.join(__dirname, '../fixtures');

let tmpDir;
function writeTmp(name, content) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepulse-dup-')); });
afterAll(()  => { fs.rmSync(tmpDir, { recursive: true, force: true }); });
beforeEach(() => { clearRegistry(); _resetDefaultRules(); });

function makeResult(filePath) {
  const { ast, code, error } = parseFile(filePath);
  return {
    path: filePath, relativePath: path.basename(filePath),
    ast, code, error: error?.message ?? null,
    lines: countLines(code), issues: [], metrics: {},
  };
}

function stmt(code) {
  return parse(code, { sourceType: 'module', plugins: ['jsx', 'nullishCoalescingOperator'], errorRecovery: true })
    .program.body[0];
}

// ── normalizeNode ──────────────────────────────────────────────────────────

describe('normalizeNode', () => {
  it('erases identifier names — different names, same structure → same hash', () => {
    const a = stmt('const foo = 1;');
    const b = stmt('const bar = 1;');
    expect(normalizeNode(a)).toBe(normalizeNode(b));
  });

  it('erases string values — different strings, same structure → same hash', () => {
    const a = stmt('const x = "hello";');
    const b = stmt('const x = "world";');
    expect(normalizeNode(a)).toBe(normalizeNode(b));
  });

  it('erases numeric values', () => {
    const a = stmt('return 42;');
    const b = stmt('return 99;');
    expect(normalizeNode(a)).toBe(normalizeNode(b));
  });

  it('distinguishes different operators', () => {
    const a = stmt('const r = x + y;');
    const b = stmt('const r = x * y;');
    expect(normalizeNode(a)).not.toBe(normalizeNode(b));
  });

  it('distinguishes different statement types', () => {
    const a = stmt('if (x) return 1;');
    const b = stmt('while (x) return 1;');
    expect(normalizeNode(a)).not.toBe(normalizeNode(b));
  });

  it('two structurally identical if-return blocks match', () => {
    const a = stmt('if (cond) { return value; }');
    const b = stmt('if (other) { return thing; }');
    expect(normalizeNode(a)).toBe(normalizeNode(b));
  });

  it('different nesting depths produce different hashes', () => {
    const a = stmt('if (x) { if (y) return 1; }');
    const b = stmt('if (x) { return 1; }');
    expect(normalizeNode(a)).not.toBe(normalizeNode(b));
  });

  it('handles null gracefully', () => {
    expect(() => normalizeNode(null)).not.toThrow();
    expect(normalizeNode(null)).toBe('nil');
  });
});

// ── normalizeStatements ────────────────────────────────────────────────────

describe('normalizeStatements', () => {
  it('two identical blocks normalize to the same string', () => {
    const opts = { sourceType: 'module', allowReturnOutsideFunction: true, plugins: ['jsx'] };
    const code1 = `const x = getValue();\nconst y = x + 1;\nreturn y;`;
    const code2 = `const a = getOther();\nconst b = a + 1;\nreturn b;`;
    const stmts1 = parse(code1, opts).program.body;
    const stmts2 = parse(code2, opts).program.body;
    expect(normalizeStatements(stmts1)).toBe(normalizeStatements(stmts2));
  });

  it('structurally different blocks produce different strings', () => {
    const opts = { sourceType: 'module', allowReturnOutsideFunction: true, plugins: ['jsx'] };
    const code1 = `const x = a + b;\nreturn x;`;
    const code2 = `const x = a * b;\nreturn x;`;
    const stmts1 = parse(code1, opts).program.body;
    const stmts2 = parse(code2, opts).program.body;
    expect(normalizeStatements(stmts1)).not.toBe(normalizeStatements(stmts2));
  });
});

// ── Function-level duplicate detection ────────────────────────────────────

describe('function-level duplicate detection', () => {
  it('detects fetchData / fetchUserData as duplicates in complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 3 } });
    const dupFindings = findings.filter(f => f.ruleId === 'duplication/block');
    // fetchData and fetchUserData are structurally identical
    expect(dupFindings.length).toBeGreaterThan(0);
    // Finding should mention one of the function names
    const messages = dupFindings.map(f => f.message);
    const mentionsFetch = messages.some(m => m.includes('fetch'));
    expect(mentionsFetch).toBe(true);
  });

  it('detects two identical functions in the same file', async () => {
    const code = `
      export function add(a, b) {
        const result = a + b;
        const doubled = result * 2;
        return doubled;
      }

      export function sum(x, y) {
        const result = x + y;
        const doubled = result * 2;
        return doubled;
      }
    `;
    const p = writeTmp('same-fn.js', code);
    const r = makeResult(p);
    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 3 } });
    expect(findings.filter(f => f.ruleId === 'duplication/block').length).toBeGreaterThan(0);
  });

  it('detects identical functions across two different files', async () => {
    const funcBody = `
export function process(item) {
  if (!item) return null;
  const value = item.price * item.qty;
  if (value > 100) return value * 0.9;
  return value;
}
    `;
    const p1 = writeTmp('cross1.js', funcBody);
    const p2 = writeTmp('cross2.js', funcBody.replace('process', 'calculate'));
    const r1 = makeResult(p1);
    const r2 = makeResult(p2);
    const findings = await analyze([r1, r2], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 3 } });
    expect(findings.filter(f => f.ruleId === 'duplication/block').length).toBeGreaterThan(0);
  });

  it('does NOT flag structurally different functions', async () => {
    const code = `
      export function add(a, b) { return a + b; }
      export function multiply(a, b) { return a * b; }
    `;
    const p = writeTmp('different-fns.js', code);
    const r = makeResult(p);
    const findings = await analyze([r], DEFAULT_CONFIG);
    // These are single-line functions that differ structurally (+ vs *)
    const fnDups = findings.filter(f =>
      f.ruleId === 'duplication/block' &&
      (f.message.includes('add') || f.message.includes('multiply'))
    );
    expect(fnDups).toHaveLength(0);
  });

  it('does NOT flag short functions below minLines threshold', async () => {
    const code = `
      export function a() { return 1; }
      export function b() { return 1; }
    `;
    const p = writeTmp('short-fns.js', code);
    const r = makeResult(p);
    // With default minLines=6, single-line functions should not be flagged
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'duplication/block')).toHaveLength(0);
  });
});

// ── Statement-sequence duplicate detection ─────────────────────────────────

describe('statement-sequence duplicate detection', () => {
  it('detects a repeated block of statements in the same file', async () => {
    // A code block repeated twice — 5 statements each
    const block = `
  const response = await fetch(url);
  const data = await response.json();
  if (!data) return null;
  const result = data.value * data.factor;
  return result;
    `;
    const code = `
export async function getUser(url) {
  ${block}
}

export async function getProduct(url) {
  ${block}
}
    `;
    const p = writeTmp('repeated-block.js', code);
    const r = makeResult(p);
    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 4, duplicationMinStatements: 4 } });
    expect(findings.filter(f => f.ruleId === 'duplication/block').length).toBeGreaterThan(0);
  });

  it('finding has all required fields', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 3 } });
    for (const f of findings) {
      expect(f).toHaveProperty('ruleId');
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('filePath');
      expect(typeof f.line).toBe('number');
      expect(f.line).toBeGreaterThan(0);
      expect(f).toHaveProperty('message');
      expect(f).toHaveProperty('why');
      expect(f).toHaveProperty('suggestion');
    }
  });
});

// ── Duplication metrics ────────────────────────────────────────────────────

describe('duplication metrics', () => {
  it('attaches duplicationPercent to file results', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    await analyze([r], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 3 } });
    expect(typeof r.metrics.duplicationPercent).toBe('number');
    expect(r.metrics.duplicationPercent).toBeGreaterThanOrEqual(0);
    expect(r.metrics.duplicationPercent).toBeLessThanOrEqual(100);
  });

  it('clean fixture has 0% duplication', async () => {
    const r = makeResult(path.join(FIXTURES, 'clean.js'));
    await analyze([r], DEFAULT_CONFIG);
    expect(r.metrics.duplicationPercent).toBe(0);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty file gracefully', async () => {
    const p = writeTmp('empty.js', '');
    const r = makeResult(p);
    expect(async () => await analyze([r], DEFAULT_CONFIG)).not.toThrow();
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings).toHaveLength(0);
  });

  it('skips files with parse errors', async () => {
    const r = { path: '/bad.js', ast: null, error: 'oops', issues: [], metrics: {}, lines: 0 };
    expect(await analyze([r], DEFAULT_CONFIG)).toHaveLength(0);
  });

  it('handles single-file analysis', async () => {
    const r = makeResult(path.join(FIXTURES, 'clean.js'));
    expect(async () => await analyze([r], DEFAULT_CONFIG)).not.toThrow();
  });

  it('does not report same location as a duplicate of itself', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], { ...DEFAULT_CONFIG, thresholds: { duplicationMinLines: 3 } });
    for (const f of findings) {
      // filePath and duplicate.filePath may be the same (same-file dup),
      // but startLine should differ
      if (f.metadata?.duplicate) {
        const isSameLocation = f.filePath === f.metadata.duplicate.filePath &&
                               f.line === f.metadata.duplicate.startLine;
        expect(isSameLocation).toBe(false);
      }
    }
  });
});
