import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { extractImports } from '../../src/analyzers/dependencies/import-extractor.js';
import { resolveImport, buildDependencyGraph, computeGraphMetrics } from '../../src/analyzers/dependencies/graph-builder.js';
import { detectCycles, formatCycle } from '../../src/analyzers/dependencies/cycle-detector.js';
import { analyze } from '../../src/analyzers/dependencies/index.js';
import { parseFile, countLines } from '../../src/utils/ast-utils.js';
import { clearRegistry } from '../../src/rules/registry.js';
import { _resetDefaultRules } from '../../src/rules/defaults.js';
import { DEFAULT_CONFIG } from '../../src/config/loader.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const DEPS_FIXTURES = path.join(__dirname, '../fixtures/deps');

let tmpDir;
function writeTmp(name, content) {
  const p = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}
beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepulse-dep-')); });
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

function makeResults(filePaths) {
  return filePaths.map(makeResult);
}

// ── extractImports ─────────────────────────────────────────────────────────

describe('extractImports', () => {
  it('extracts static ESM imports', () => {
    const p = writeTmp('esm-import.js', `import { foo } from './foo';\nimport bar from './bar';`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports.map(i => i.source)).toContain('./foo');
    expect(imports.map(i => i.source)).toContain('./bar');
    expect(imports.every(i => i.kind === 'static')).toBe(true);
  });

  it('extracts CommonJS require', () => {
    const p = writeTmp('cjs-require.js', `const x = require('./utils');\nconst y = require('./config');`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports.map(i => i.source)).toContain('./utils');
    expect(imports.map(i => i.source)).toContain('./config');
    expect(imports.every(i => i.kind === 'require')).toBe(true);
  });

  it('extracts dynamic import()', () => {
    const p = writeTmp('dynamic-import.js', `const m = import('./module');`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports.map(i => i.source)).toContain('./module');
    expect(imports[0].kind).toBe('dynamic');
  });

  it('ignores npm package imports', () => {
    const p = writeTmp('npm-import.js', `import React from 'react';\nimport { x } from 'lodash';`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports).toHaveLength(0);
  });

  it('ignores node built-in imports', () => {
    const p = writeTmp('node-import.js', `import path from 'node:path';\nconst fs = require('fs');`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports).toHaveLength(0);
  });

  it('extracts parent-relative imports (../)', () => {
    const p = writeTmp('sub/file.js', `import { x } from '../utils';`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports.map(i => i.source)).toContain('../utils');
  });

  it('records line number', () => {
    const p = writeTmp('with-line.js', `\n\nimport { x } from './x';`);
    const { ast } = parseFile(p);
    const imports = extractImports(ast, p);
    expect(imports[0].line).toBe(3);
  });

  it('extracts imports from dep fixtures a.js', () => {
    const aPath = path.join(DEPS_FIXTURES, 'a.js');
    const { ast } = parseFile(aPath);
    const imports = extractImports(ast, aPath);
    expect(imports.map(i => i.source)).toContain('./b.js');
  });
});

// ── resolveImport ──────────────────────────────────────────────────────────

describe('resolveImport', () => {
  it('resolves ./b.js to the analyzed file', () => {
    const aPath = path.join(DEPS_FIXTURES, 'a.js');
    const bPath = path.join(DEPS_FIXTURES, 'b.js');
    const fileSet = new Set([aPath, bPath]);
    expect(resolveImport('./b.js', aPath, fileSet)).toBe(bPath);
  });

  it('resolves specifier without extension by trying .js', () => {
    const fromFile = path.join(tmpDir, 'src/api.js');
    const targetFile = path.join(tmpDir, 'src/utils.js');
    writeTmp('src/api.js', '');
    writeTmp('src/utils.js', '');
    const fileSet = new Set([fromFile, targetFile]);
    expect(resolveImport('./utils', fromFile, fileSet)).toBe(targetFile);
  });

  it('resolves specifier to index.js', () => {
    const fromFile = path.join(tmpDir, 'src/api2.js');
    const indexFile = path.join(tmpDir, 'src/helpers/index.js');
    writeTmp('src/api2.js', '');
    writeTmp('src/helpers/index.js', '');
    const fileSet = new Set([fromFile, indexFile]);
    expect(resolveImport('./helpers', fromFile, fileSet)).toBe(indexFile);
  });

  it('returns null for npm packages', () => {
    const fromFile = path.join(tmpDir, 'src/file.js');
    const fileSet = new Set([fromFile]);
    expect(resolveImport('lodash', fromFile, fileSet)).toBeNull();
  });

  it('returns null when target is not in analyzed set', () => {
    const fromFile = path.join(tmpDir, 'src/a3.js');
    writeTmp('src/a3.js', '');
    const fileSet = new Set([fromFile]);
    expect(resolveImport('./missing', fromFile, fileSet)).toBeNull();
  });
});

// ── buildDependencyGraph ───────────────────────────────────────────────────

describe('buildDependencyGraph', () => {
  function makeDepsResults(filePaths) {
    return filePaths.map(fp => {
      const { ast } = parseFile(fp);
      return {
        path: fp,
        ast,
        rawImports: extractImports(ast, fp),
        issues: [], metrics: {},
      };
    });
  }

  it('builds correct edges for the cycle fixtures', () => {
    const files = ['a.js', 'b.js', 'c.js'].map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepsResults(files);
    const fileSet = new Set(files);
    const { graph } = buildDependencyGraph(results, fileSet);

    const aPath = files[0], bPath = files[1], cPath = files[2];
    expect(graph.get(aPath).has(bPath)).toBe(true);
    expect(graph.get(bPath).has(cPath)).toBe(true);
    expect(graph.get(cPath).has(aPath)).toBe(true);
  });

  it('leaf node has empty outgoing edges', () => {
    const files = ['leaf.js'].map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepsResults(files);
    const { graph } = buildDependencyGraph(results, new Set(files));
    expect(graph.get(files[0]).size).toBe(0);
  });

  it('computes in-degree for imported files', () => {
    const files = ['a.js', 'b.js', 'c.js', 'entry.js', 'leaf.js']
      .map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepsResults(files);
    const fileSet = new Set(files);
    const { reverseGraph } = buildDependencyGraph(results, fileSet);

    const aPath = files[0]; // imported by entry.js and c.js
    expect(reverseGraph.get(aPath).size).toBe(2);
  });

  it('records edge metadata (kind, line)', () => {
    const files = ['a.js', 'b.js', 'c.js'].map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepsResults(files);
    const fileSet = new Set(files);
    const { edges } = buildDependencyGraph(results, fileSet);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]).toHaveProperty('from');
    expect(edges[0]).toHaveProperty('to');
    expect(edges[0]).toHaveProperty('kind');
    expect(edges[0]).toHaveProperty('line');
  });
});

// ── detectCycles ───────────────────────────────────────────────────────────

describe('detectCycles', () => {
  it('detects the 3-node cycle in fixture files', () => {
    const a = path.join(DEPS_FIXTURES, 'a.js');
    const b = path.join(DEPS_FIXTURES, 'b.js');
    const c = path.join(DEPS_FIXTURES, 'c.js');

    const graph = new Map([
      [a, new Set([b])],
      [b, new Set([c])],
      [c, new Set([a])],
    ]);

    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(3);
    // All three nodes should appear in the cycle
    const cycleSet = new Set(cycles[0]);
    expect(cycleSet.has(a)).toBe(true);
    expect(cycleSet.has(b)).toBe(true);
    expect(cycleSet.has(c)).toBe(true);
  });

  it('detects a self-referencing cycle (a → a)', () => {
    const a = '/src/a.js';
    const graph = new Map([[a, new Set([a])]]);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('detects nothing for acyclic graphs', () => {
    const x = path.join(DEPS_FIXTURES, 'no-cycle-x.js');
    const y = path.join(DEPS_FIXTURES, 'no-cycle-y.js');
    const leaf = path.join(DEPS_FIXTURES, 'leaf.js');

    const graph = new Map([
      [x,    new Set([y])],
      [y,    new Set([leaf])],
      [leaf, new Set()],
    ]);

    expect(detectCycles(graph)).toHaveLength(0);
  });

  it('reports each unique cycle exactly once', () => {
    const a = '/a.js', b = '/b.js', c = '/c.js';
    const graph = new Map([
      [a, new Set([b])],
      [b, new Set([c])],
      [c, new Set([a])],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1); // not 3 (one per starting node)
  });

  it('handles disconnected graphs', () => {
    const a = '/a.js', b = '/b.js', c = '/c.js', d = '/d.js';
    const graph = new Map([
      [a, new Set([b])],
      [b, new Set([a])], // cycle a→b→a
      [c, new Set([d])],
      [d, new Set()],    // no cycle
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
  });

  it('handles multiple independent cycles', () => {
    const a = '/a.js', b = '/b.js', c = '/c.js', d = '/d.js';
    const graph = new Map([
      [a, new Set([b])],
      [b, new Set([a])], // cycle 1: a→b
      [c, new Set([d])],
      [d, new Set([c])], // cycle 2: c→d
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(2);
  });

  it('handles empty graph', () => {
    expect(detectCycles(new Map())).toHaveLength(0);
  });
});

// ── formatCycle ────────────────────────────────────────────────────────────

describe('formatCycle', () => {
  it('formats a cycle with arrow notation', () => {
    const cycle = ['/project/src/a.js', '/project/src/b.js', '/project/src/c.js'];
    const result = formatCycle(cycle, '/project');
    expect(result).toContain('→');
    expect(result).toContain('a.js');
    expect(result).toContain('b.js');
    expect(result).toContain('c.js');
    // Should end by repeating the first element
    expect(result.endsWith('a.js')).toBe(true);
  });
});

// ── Full dependency analyzer integration ──────────────────────────────────

describe('dependency analyze()', () => {
  function makeDepResults(filePaths) {
    return filePaths.map(fp => {
      const { ast, code, error } = parseFile(fp);
      return { path: fp, relativePath: path.basename(fp), ast, code, error: error?.message ?? null, lines: countLines(code), issues: [], metrics: {} };
    });
  }

  it('detects the circular dependency in fixtures/deps', async () => {
    const files = ['a.js', 'b.js', 'c.js', 'entry.js', 'leaf.js']
      .map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    const findings = await analyze(results, DEFAULT_CONFIG);
    const cyclicFindings = findings.filter(f => f.ruleId === 'dependency/circular');
    expect(cyclicFindings.length).toBeGreaterThan(0);
  });

  it('finding message describes the cycle path', async () => {
    const files = ['a.js', 'b.js', 'c.js'].map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    const findings = await analyze(results, DEFAULT_CONFIG);
    const f = findings.find(x => x.ruleId === 'dependency/circular');
    expect(f?.message).toContain('→');
  });

  it('no cycle findings for acyclic fixture files', async () => {
    const files = ['no-cycle-x.js', 'no-cycle-y.js', 'leaf.js']
      .map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    const findings = await analyze(results, DEFAULT_CONFIG);
    expect(findings.filter(f => f.ruleId === 'dependency/circular')).toHaveLength(0);
  });

  it('detects too-many-imports', async () => {
    // Create a file that imports many local modules
    const imports = Array.from({ length: 18 }, (_, i) => {
      const depFile = writeTmp(`manydeps/dep${i}.js`, `export const v${i} = ${i};`);
      return { file: depFile, spec: `./dep${i}.js`, name: `v${i}` };
    });
    const importLines = imports.map(({ spec, name }) => `import { ${name} } from '${spec}';`).join('\n');
    const mainFile = writeTmp('manydeps/main.js', importLines);

    const allPaths = [mainFile, ...imports.map(i => i.file)];
    const results = makeDepResults(allPaths);
    const findings = await analyze(results, { ...DEFAULT_CONFIG, thresholds: { maxImports: 15 } });
    expect(findings.some(f => f.ruleId === 'dependency/too-many-imports')).toBe(true);
  });

  it('every finding has required fields', async () => {
    const files = ['a.js', 'b.js', 'c.js'].map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    const findings = await analyze(results, DEFAULT_CONFIG);
    for (const f of findings) {
      expect(f).toHaveProperty('ruleId');
      expect(f).toHaveProperty('severity');
      expect(f).toHaveProperty('filePath');
      expect(f).toHaveProperty('message');
      expect(f).toHaveProperty('why');
      expect(f).toHaveProperty('suggestion');
    }
  });

  it('attaches graph metrics to fileResults', async () => {
    const files = ['a.js', 'b.js', 'c.js', 'entry.js', 'leaf.js']
      .map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    await analyze(results, DEFAULT_CONFIG);

    // Every non-error result should have degree metrics
    for (const r of results) {
      expect(r.metrics).toHaveProperty('outDegree');
      expect(r.metrics).toHaveProperty('inDegree');
    }

    // leaf.js should have outDegree=0
    const leafResult = results.find(r => r.relativePath === 'leaf.js');
    expect(leafResult?.metrics.outDegree).toBe(0);
  });

  it('marks files in cycle as inCycle=true', async () => {
    const files = ['a.js', 'b.js', 'c.js'].map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    await analyze(results, DEFAULT_CONFIG);
    expect(results.every(r => r.metrics.inCycle === true)).toBe(true);
  });

  it('marks files NOT in cycle as inCycle=false', async () => {
    const files = ['no-cycle-x.js', 'no-cycle-y.js', 'leaf.js']
      .map(f => path.join(DEPS_FIXTURES, f));
    const results = makeDepResults(files);
    await analyze(results, DEFAULT_CONFIG);
    expect(results.every(r => r.metrics.inCycle === false)).toBe(true);
  });

  it('skips files with parse errors gracefully', async () => {
    const r = { path: '/bad.js', ast: null, error: 'oops', issues: [], metrics: {}, lines: 0 };
    expect(await analyze([r], DEFAULT_CONFIG)).toHaveLength(0);
  });
});
