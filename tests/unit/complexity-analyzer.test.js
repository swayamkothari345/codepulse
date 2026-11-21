import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

import { parseFile, countLines } from '../../src/utils/ast-utils.js';
import { computeCyclomatic } from '../../src/analyzers/complexity/cyclomatic.js';
import { computeCognitive } from '../../src/analyzers/complexity/cognitive.js';
import { analyze } from '../../src/analyzers/complexity/index.js';
import { clearRegistry } from '../../src/rules/registry.js';
import { _resetDefaultRules } from '../../src/rules/defaults.js';
import { DEFAULT_CONFIG } from '../../src/config/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES   = path.join(__dirname, '../fixtures');

// Parse a code snippet and return the first statement's node.
function snippet(code) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'nullishCoalescingOperator', 'optionalChaining', 'logicalAssignment'],
    errorRecovery: true,
  }).program.body[0];
}

// Find first FunctionDeclaration by name in a Babel File AST.
function findFn(ast, name) {
  function walk(node) {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) return node;
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) { for (const c of child) { const r = walk(c); if (r) return r; } }
      else if (child?.type) { const r = walk(child); if (r) return r; }
    }
    return null;
  }
  return walk(ast);
}

// ── computeCyclomatic ──────────────────────────────────────────────────────

describe('computeCyclomatic', () => {
  it('gives complexity 1 for empty function', () => {
    expect(computeCyclomatic(snippet('function f() {}'))).toBe(1);
  });

  it('adds 1 per if statement', () => {
    const fn = snippet('function f(x) { if (x > 0) return 1; if (x < 0) return -1; return 0; }');
    expect(computeCyclomatic(fn)).toBe(3); // 1 + 2 ifs
  });

  it('adds 1 for ternary', () => {
    // 1 base + 1 ConditionalExpression
    const fn = snippet('function f(x) { return x > 0 ? 1 : 0; }');
    expect(computeCyclomatic(fn)).toBe(2);
  });

  it('adds 1 for &&', () => {
    expect(computeCyclomatic(snippet('function f(a,b){ return a && b; }'))).toBe(2);
  });

  it('adds 1 for ||', () => {
    expect(computeCyclomatic(snippet('function f(a,b){ return a || b; }'))).toBe(2);
  });

  it('adds 1 for ??', () => {
    expect(computeCyclomatic(snippet('function f(a){ return a ?? "d"; }'))).toBe(2);
  });

  it('adds 1 per non-default switch case', () => {
    const code = 'function f(x){switch(x){case 1:return"a";case 2:return"b";default:return"c";}}';
    expect(computeCyclomatic(snippet(code))).toBe(3); // 1 + 2 cases
  });

  it('adds 1 for for loop', () => {
    expect(computeCyclomatic(snippet('function f(a){for(let i=0;i<a.length;i++){}}'))).toBe(2);
  });

  it('adds 1 for for-of loop', () => {
    expect(computeCyclomatic(snippet('function f(a){for(const x of a){}}'))).toBe(2);
  });

  it('adds 1 for while loop', () => {
    expect(computeCyclomatic(snippet('function f(x){while(x>0){x--;}}'))).toBe(2);
  });

  it('adds 1 for do-while loop', () => {
    expect(computeCyclomatic(snippet('function f(x){do{x--;}while(x>0);}'))).toBe(2);
  });

  it('adds 1 for catch clause', () => {
    expect(computeCyclomatic(snippet('function f(){try{return 1;}catch(e){return 0;}}'))).toBe(2);
  });

  it('adds 1 for &&= logical assignment', () => {
    expect(computeCyclomatic(snippet('function f(o){o.x &&= 1;}'))).toBe(2);
  });

  it('does NOT count nested function branches inside outer function', () => {
    const code = `
      function outer() {
        function inner() {
          if (true) return 1;
          if (true) return 2;
          if (true) return 3;
        }
        return inner();
      }
    `;
    expect(computeCyclomatic(snippet(code))).toBe(1); // outer has no branches
  });

  it('computes high complexity for processOrder fixture', () => {
    const { ast } = parseFile(path.join(FIXTURES, 'complex.js'));
    const fn = findFn(ast, 'processOrder');
    expect(fn).toBeTruthy();
    expect(computeCyclomatic(fn)).toBeGreaterThan(10);
  });

  it('clean fixture functions stay at or below threshold', () => {
    const { ast } = parseFile(path.join(FIXTURES, 'clean.js'));
    // Walk all function declarations in clean.js
    function collectFns(node, acc = []) {
      if (!node || typeof node !== 'object') return acc;
      if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') acc.push(node);
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'loc') continue;
        const c = node[k];
        if (Array.isArray(c)) c.forEach(n => collectFns(n, acc));
        else if (c?.type) collectFns(c, acc);
      }
      return acc;
    }
    for (const fn of collectFns(ast)) {
      expect(computeCyclomatic(fn)).toBeLessThanOrEqual(10);
    }
  });
});

// ── computeCognitive ───────────────────────────────────────────────────────

describe('computeCognitive', () => {
  it('gives 0 for empty function', () => {
    expect(computeCognitive(snippet('function f() {}'))).toBe(0);
  });

  it('gives 1 for a simple top-level if', () => {
    expect(computeCognitive(snippet('function f(x){ if(x) return 1; }'))).toBe(1);
  });

  it('nested if costs more than top-level if (nesting penalty)', () => {
    const nested = snippet('function f(a,b){ if(a){ if(b){ return 1; } } }');
    const flat   = snippet('function f(a,b){ if(a){ return 1; } if(b){ return 2; } }');
    expect(computeCognitive(nested)).toBeGreaterThan(computeCognitive(flat));
  });

  it('else-if adds 1 flat (not 1 + nesting)', () => {
    // if (nesting=0) = 1, else-if = 1, else = 1 → 3
    const fn = snippet(`
      function f(x) {
        if (x > 0) { return 1; }
        else if (x < 0) { return -1; }
        else { return 0; }
      }
    `);
    expect(computeCognitive(fn)).toBe(3);
  });

  it('each logical operator adds 1 flat', () => {
    // a && b && c → two LogicalExpression nodes → score = 2
    expect(computeCognitive(snippet('function f(a,b,c){ return a && b && c; }'))).toBe(2);
  });

  it('loop at nesting 0 adds 1', () => {
    expect(computeCognitive(snippet('function f(a){ for(const x of a){} }'))).toBe(1);
  });

  it('nested loop adds (1 + 1) = 2', () => {
    const fn = snippet('function f(a){ if(a){ for(const x of a){} } }');
    // if = 1 (nesting 0), for = 1+1=2 (nesting 1) → 3
    expect(computeCognitive(fn)).toBe(3);
  });

  it('does NOT count nested function complexity', () => {
    const code = `
      function outer() {
        function inner() {
          if (true) { if (true) { if (true) {} } }
        }
      }
    `;
    expect(computeCognitive(snippet(code))).toBe(0);
  });

  it('complex processOrder has high cognitive complexity', () => {
    const { ast } = parseFile(path.join(FIXTURES, 'complex.js'));
    const fn = findFn(ast, 'processOrder');
    expect(fn).toBeTruthy();
    expect(computeCognitive(fn)).toBeGreaterThan(15);
  });

  it('arrow function with expression body', () => {
    const code = `const f = (a, b) => a && b;`;
    const prog = parse(code, { sourceType: 'module', plugins: ['jsx', 'nullishCoalescingOperator'] });
    const arrowFn = prog.program.body[0].declarations[0].init;
    expect(computeCognitive(arrowFn)).toBe(1);
  });
});

// ── Full complexity analyzer integration tests ─────────────────────────────

describe('complexity analyze()', () => {
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

  it('returns no complexity findings for the clean fixture at default thresholds', async () => {
    const r = makeResult(path.join(FIXTURES, 'clean.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId.startsWith('complexity/'))).toHaveLength(0);
  });

  it('detects cyclomatic violations in complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'complexity/cyclomatic').length).toBeGreaterThan(0);
  });

  it('detects nesting violations in complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'complexity/nesting-depth').length).toBeGreaterThan(0);
  });

  it('detects too-many-parameters in complex fixture', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'complexity/parameters').length).toBeGreaterThan(0);
  });

  it('every finding has required fields', async () => {
    const r = makeResult(path.join(FIXTURES, 'complex.js'));
    const findings = await analyze([r], DEFAULT_CONFIG);
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

  it('lower threshold flags more functions', async () => {
    const r1 = makeResult(path.join(FIXTURES, 'clean.js'));
    const r2 = makeResult(path.join(FIXTURES, 'clean.js'));

    const strict  = { ...DEFAULT_CONFIG, thresholds: { cyclomaticComplexity: 2 } };
    const relaxed = { ...DEFAULT_CONFIG, thresholds: { cyclomaticComplexity: 50 } };

    const strictCount  = (await analyze([r1], strict)).filter(f => f.ruleId === 'complexity/cyclomatic').length;
    const relaxedCount = (await analyze([r2], relaxed)).filter(f => f.ruleId === 'complexity/cyclomatic').length;
    expect(strictCount).toBeGreaterThanOrEqual(relaxedCount);
  });

  it('attaches function metrics to fileResult', async () => {
    const r = makeResult(path.join(FIXTURES, 'clean.js'));
    await analyze([r], DEFAULT_CONFIG);
    expect(r.metrics.functionCount).toBeGreaterThan(0);
    expect(typeof r.metrics.maxCyclomatic).toBe('number');
    expect(typeof r.metrics.avgCyclomatic).toBe('number');
    expect(Array.isArray(r.metrics.functions)).toBe(true);
  });

  it('skips files with parse errors gracefully', async () => {
    const r = { path: '/bad.js', ast: null, error: 'parse failed', issues: [], metrics: {} };
    expect(await analyze([r], DEFAULT_CONFIG)).toHaveLength(0);
  });
});
