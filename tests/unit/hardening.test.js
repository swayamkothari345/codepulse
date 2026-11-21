/**
 * Phase 9 — Hardening tests
 *
 * Covers security edge cases and robustness scenarios that are not tested
 * by the functional unit tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SnapshotManager } from '../../src/history/snapshot-manager.js';
import { Analyzer } from '../../src/core/analyzer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(rootDir, overrides = {}) {
  return {
    version: '0.1.0',
    rootDir,
    filesAnalyzed: 1,
    filesWithErrors: 0,
    totalFiles: 1,
    files: [],
    issues: [],
    metrics: { totalLines: 100 },
    scores: { overall: 80, label: 'Good', weakest: 'hygiene', recommendation: 'x', weights: {}, breakdown: {} },
    duration: 10,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── Snapshot path traversal ───────────────────────────────────────────────────

describe('SnapshotManager — path traversal protection', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir  = mkdtempSync(join(tmpdir(), 'cp-sec-'));
    manager = new SnapshotManager(tmpDir);
    // Save a legit snapshot first so storeDir exists
    manager.save(makeResult(tmpDir));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const TRAVERSAL_IDS = [
    '../../../etc/passwd',
    '..%2F..%2Fetc%2Fpasswd',
    '../../../../etc/shadow',
    '/etc/passwd',
    'foo/../../bar',
    '.',
    '..',
    'foo.json/../../../etc/passwd',
  ];

  for (const id of TRAVERSAL_IDS) {
    it(`load("${id}") returns null — no traversal`, () => {
      expect(manager.load(id)).toBeNull();
    });

    it(`delete("${id}") returns false — no traversal`, () => {
      expect(manager.delete(id)).toBe(false);
    });
  }

  it('load with null returns null', () => {
    expect(manager.load(null)).toBeNull();
  });

  it('load with undefined returns null', () => {
    expect(manager.load(undefined)).toBeNull();
  });

  it('load with empty string returns null', () => {
    expect(manager.load('')).toBeNull();
  });

  it('load with a valid ID still works', () => {
    const snap = manager.list()[0];
    expect(manager.load(snap.id)).not.toBeNull();
  });
});

// ── Analyzer — binary files ───────────────────────────────────────────────────

describe('Analyzer — binary file handling', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cp-bin-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips a binary file (null bytes) without throwing', async () => {
    const binFile = join(tmpDir, 'binary.js');
    // Write a file containing null bytes
    writeFileSync(binFile, Buffer.from([0x00, 0x01, 0x02, 0x61, 0x62]));

    const analyzer = new Analyzer({ config: {}, files: [binFile], rootDir: tmpDir });
    const result = await analyzer.analyze();

    expect(result.filesWithErrors).toBe(1);
    expect(result.filesAnalyzed).toBe(0);
  });

  it('reports a parse error entry for binary files', async () => {
    const binFile = join(tmpDir, 'binary.js');
    writeFileSync(binFile, Buffer.from([0x00, 0xff, 0xfe]));

    const analyzer = new Analyzer({ config: {}, files: [binFile], rootDir: tmpDir });
    const result = await analyzer.analyze();

    const entry = result.files.find(f => f.path === binFile);
    expect(entry).toBeDefined();
    expect(entry.error).toMatch(/binary/i);
  });
});

// ── Analyzer — empty project ──────────────────────────────────────────────────

describe('Analyzer — empty project', () => {
  it('handles zero files gracefully', async () => {
    const analyzer = new Analyzer({ config: {}, files: [], rootDir: '/empty' });
    const result = await analyzer.analyze();

    expect(result.filesAnalyzed).toBe(0);
    expect(result.issues).toHaveLength(0);
    expect(result.scores).not.toBeNull();
    expect(result.scores.overall).toBe(100);
  });
});

// ── Analyzer — analyzer error isolation ──────────────────────────────────────

describe('Analyzer — analyzer error isolation', () => {
  let tmpDir;
  let jsFile;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cp-iso-'));
    jsFile = join(tmpDir, 'ok.js');
    writeFileSync(jsFile, 'const x = 1;\n', 'utf8');
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a crashing analyzer does not prevent other analyzers from running', async () => {
    const crashingAnalyzer = {
      name: 'crash',
      analyze() { throw new Error('I always crash'); },
    };
    const goodAnalyzer = {
      name: 'good',
      analyze(fileResults) {
        return fileResults.map(f => ({
          ruleId:   'test/marker',
          severity: 'low',
          filePath: f.path,
          line:     1,
          message:  'marker',
        }));
      },
    };

    const analyzer = new Analyzer({ config: {}, files: [jsFile], rootDir: tmpDir });
    analyzer.registerAnalyzer(crashingAnalyzer);
    analyzer.registerAnalyzer(goodAnalyzer);

    const result = await analyzer.analyze();

    // Good analyzer's issue should still be present
    expect(result.issues.some(i => i.ruleId === 'test/marker')).toBe(true);
  });

  it('a crashing analyzer does not corrupt the result object', async () => {
    const badAnalyzer = {
      name: 'bad',
      analyze() { throw new Error('boom'); },
    };

    const analyzer = new Analyzer({ config: {}, files: [jsFile], rootDir: tmpDir });
    analyzer.registerAnalyzer(badAnalyzer);

    const result = await analyzer.analyze();
    expect(result.filesAnalyzed).toBe(1);
    expect(result.scores).not.toBeNull();
  });
});

// ── Analyzer — concurrent parse correctness ───────────────────────────────────

describe('Analyzer — concurrent parse correctness', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cp-par-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces the same set of files when parsing >20 files concurrently', async () => {
    // Create 30 simple JS files (more than PARSE_CONCURRENCY=20)
    const files = [];
    for (let i = 0; i < 30; i++) {
      const p = join(tmpDir, `file${i}.js`);
      writeFileSync(p, `const v${i} = ${i};\nfunction f${i}() { return ${i}; }\n`, 'utf8');
      files.push(p);
    }

    const analyzer = new Analyzer({ config: {}, files, rootDir: tmpDir });
    const result = await analyzer.analyze();

    expect(result.filesAnalyzed).toBe(30);
    // All files should be present in result.files
    const resultPaths = new Set(result.files.map(f => f.path));
    for (const p of files) {
      expect(resultPaths.has(p)).toBe(true);
    }
  });

  it('result.files order matches input file order', async () => {
    const files = [];
    for (let i = 0; i < 25; i++) {
      const p = join(tmpDir, `z${String(i).padStart(3, '0')}.js`);
      writeFileSync(p, `const x = ${i};\n`, 'utf8');
      files.push(p);
    }

    const analyzer = new Analyzer({ config: {}, files, rootDir: tmpDir });
    const result = await analyzer.analyze();

    // The parsed file results array should be in the same order as the input
    result.files.forEach((f, idx) => {
      expect(f.path).toBe(files[idx]);
    });
  });
});

// ── Analyzer — unreadable files ───────────────────────────────────────────────

describe('Analyzer — unreadable files', () => {
  it('handles a nonexistent file path without throwing', async () => {
    const analyzer = new Analyzer({
      config: {},
      files: ['/this/path/does/not/exist.js'],
      rootDir: '/',
    });
    const result = await analyzer.analyze();
    expect(result.filesWithErrors).toBe(1);
    expect(result.filesAnalyzed).toBe(0);
  });
});
