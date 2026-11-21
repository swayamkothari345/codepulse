/**
 * Tests for Phase 7: snapshot-manager and comparison-engine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SnapshotManager } from '../../src/history/snapshot-manager.js';
import { compare } from '../../src/history/comparison-engine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(overrides = {}) {
  return {
    version: '0.1.0',
    rootDir: '/project',
    filesAnalyzed: 5,
    filesWithErrors: 0,
    totalFiles: 5,
    files: [],
    issues: [],
    metrics: { totalLines: 300, totalFiles: 5, avgLinesPerFile: 60 },
    scores: {
      overall: 80,
      label: 'Good',
      weakest: 'hygiene',
      recommendation: 'Fix unused vars.',
      weights: { complexity: 0.30, duplication: 0.20, maintainability: 0.25, dependencies: 0.15, hygiene: 0.10 },
      breakdown: {
        complexity:      { score: 90, label: 'Excellent', reasons: [], raw: {} },
        duplication:     { score: 85, label: 'Good',      reasons: [], raw: {} },
        maintainability: { score: 80, label: 'Good',      reasons: [], raw: {} },
        dependencies:    { score: 95, label: 'Excellent', reasons: [], raw: {} },
        hygiene:         { score: 65, label: 'Fair',      reasons: [], raw: {} },
      },
    },
    duration: 100,
    timestamp: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(sev = 'medium') {
  return { ruleId: 'smell/unused-vars', severity: sev, filePath: '/project/a.js', line: 1, message: 'x' };
}

// ── SnapshotManager ───────────────────────────────────────────────────────────

describe('SnapshotManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir  = mkdtempSync(join(tmpdir(), 'codepulse-snap-'));
    manager = new SnapshotManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save() returns a snapshot with an id', () => {
    const snap = manager.save(makeResult({ rootDir: tmpDir }));
    expect(snap.id).toBeTruthy();
    expect(typeof snap.id).toBe('string');
  });

  it('save() creates .codepulse/snapshots/ directory', () => {
    manager.save(makeResult({ rootDir: tmpDir }));
    expect(existsSync(join(tmpDir, '.codepulse', 'snapshots'))).toBe(true);
  });

  it('save() writes a JSON file', () => {
    const snap = manager.save(makeResult({ rootDir: tmpDir }));
    const p = join(tmpDir, '.codepulse', 'snapshots', `${snap.id}.json`);
    expect(existsSync(p)).toBe(true);
    const data = JSON.parse(readFileSync(p, 'utf8'));
    expect(data.id).toBe(snap.id);
  });

  it('save() stores overall score', () => {
    const snap = manager.save(makeResult({ rootDir: tmpDir }));
    expect(snap.scores.overall).toBe(80);
  });

  it('save() stores issueCount', () => {
    const result = makeResult({ rootDir: tmpDir, issues: [makeIssue(), makeIssue('high')] });
    const snap = manager.save(result);
    expect(snap.issueCount).toBe(2);
  });

  it('save() stores issuesBySeverity', () => {
    const result = makeResult({
      rootDir: tmpDir,
      issues: [makeIssue('high'), makeIssue('medium'), makeIssue('medium')],
    });
    const snap = manager.save(result);
    expect(snap.issuesBySeverity.high).toBe(1);
    expect(snap.issuesBySeverity.medium).toBe(2);
  });

  it('save() accepts an optional label', () => {
    const snap = manager.save(makeResult({ rootDir: tmpDir }), { label: 'v1.0 baseline' });
    expect(snap.label).toBe('v1.0 baseline');
  });

  it('list() returns empty array before any saves', () => {
    expect(manager.list()).toEqual([]);
  });

  it('list() returns metadata after saves, most-recent first', () => {
    manager.save(makeResult({ rootDir: tmpDir, timestamp: '2026-01-01T00:00:00.000Z' }));
    manager.save(makeResult({ rootDir: tmpDir, timestamp: '2026-06-01T00:00:00.000Z' }));
    const list = manager.list();
    expect(list).toHaveLength(2);
    // most recent first
    expect(list[0].timestamp).toBe('2026-06-01T00:00:00.000Z');
    expect(list[1].timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('list() entries include id, timestamp, overall, issueCount', () => {
    manager.save(makeResult({ rootDir: tmpDir }));
    const [entry] = manager.list();
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('overall');
    expect(entry).toHaveProperty('issueCount');
  });

  it('load() returns the saved snapshot', () => {
    const snap = manager.save(makeResult({ rootDir: tmpDir }));
    const loaded = manager.load(snap.id);
    expect(loaded.id).toBe(snap.id);
    expect(loaded.scores.overall).toBe(80);
  });

  it('load() returns null for unknown id', () => {
    expect(manager.load('nonexistent-id')).toBeNull();
  });

  it('recent() returns N most-recent full snapshots', () => {
    for (let i = 0; i < 5; i++) {
      manager.save(makeResult({ rootDir: tmpDir, timestamp: `2026-0${i + 1}-01T00:00:00.000Z` }));
    }
    const r = manager.recent(3);
    expect(r).toHaveLength(3);
    // All have full scores
    r.forEach(s => expect(s.scores.overall).toBe(80));
  });

  it('delete() removes the snapshot file and index entry', () => {
    const snap = manager.save(makeResult({ rootDir: tmpDir }));
    const ok   = manager.delete(snap.id);
    expect(ok).toBe(true);
    expect(manager.load(snap.id)).toBeNull();
    expect(manager.list()).toHaveLength(0);
  });

  it('delete() returns false for unknown id', () => {
    expect(manager.delete('ghost')).toBe(false);
  });

  it('multiple saves build up the index correctly', () => {
    manager.save(makeResult({ rootDir: tmpDir }));
    manager.save(makeResult({ rootDir: tmpDir }));
    manager.save(makeResult({ rootDir: tmpDir }));
    expect(manager.list()).toHaveLength(3);
  });
});

// ── compare() ─────────────────────────────────────────────────────────────────

function makeSnap(overrides = {}) {
  return {
    id: 'snap-a',
    timestamp: '2026-11-21T10:00:00.000Z',
    label: null,
    rootDir: '/project',
    scores: {
      overall: 80,
      breakdown: {
        complexity:      { score: 90 },
        duplication:     { score: 85 },
        maintainability: { score: 80 },
        dependencies:    { score: 95 },
        hygiene:         { score: 65 },
      },
    },
    metrics:  { totalLines: 300 },
    filesAnalyzed: 5,
    issueCount: 10,
    ...overrides,
  };
}

describe('compare()', () => {
  it('returns snapshotA and snapshotB refs', () => {
    const diff = compare(makeSnap({ id: 'a' }), makeSnap({ id: 'b' }));
    expect(diff.snapshotA.id).toBe('a');
    expect(diff.snapshotB.id).toBe('b');
  });

  it('computes overall delta', () => {
    const diff = compare(makeSnap({ scores: { overall: 70, breakdown: {} } }), makeSnap({ scores: { overall: 80, breakdown: {} } }));
    expect(diff.overall.delta).toBe(10);
    expect(diff.overall.direction).toBe('up');
  });

  it('trend is "improved" when overall goes up', () => {
    const diff = compare(makeSnap({ scores: { overall: 60, breakdown: {} } }), makeSnap({ scores: { overall: 75, breakdown: {} } }));
    expect(diff.trend).toBe('improved');
  });

  it('trend is "regressed" when overall goes down', () => {
    const diff = compare(makeSnap(), makeSnap({ scores: { overall: 70, breakdown: {} } }));
    expect(diff.trend).toBe('regressed');
  });

  it('trend is "unchanged" when overall stays same', () => {
    const diff = compare(makeSnap(), makeSnap());
    expect(diff.trend).toBe('unchanged');
  });

  it('computes breakdown deltas for all 5 dimensions', () => {
    const a = makeSnap();
    const b = makeSnap({
      scores: {
        overall: 85,
        breakdown: {
          complexity:      { score: 95 },
          duplication:     { score: 85 },
          maintainability: { score: 80 },
          dependencies:    { score: 95 },
          hygiene:         { score: 70 },
        },
      },
    });
    const diff = compare(a, b);
    expect(diff.breakdown.complexity.delta).toBe(5);
    expect(diff.breakdown.hygiene.delta).toBe(5);
    expect(diff.breakdown.duplication.delta).toBe(0);
  });

  it('computes metric deltas', () => {
    const a = makeSnap({ metrics: { totalLines: 200 }, issueCount: 10, filesAnalyzed: 5 });
    const b = makeSnap({ metrics: { totalLines: 250 }, issueCount: 8,  filesAnalyzed: 6 });
    const diff = compare(a, b);
    expect(diff.metrics.totalLines.delta).toBe(50);
    expect(diff.metrics.issueCount.delta).toBe(-2);
    expect(diff.metrics.filesAnalyzed.delta).toBe(1);
  });

  it('handles missing scores gracefully (null deltas)', () => {
    const a = makeSnap({ scores: null });
    const b = makeSnap({ scores: null });
    const diff = compare(a, b);
    expect(diff.overall.delta).toBeNull();
    expect(diff.overall.direction).toBe('same');
  });

  it('direction is "down" when score decreases', () => {
    const a = makeSnap({ scores: { overall: 90, breakdown: {} } });
    const b = makeSnap({ scores: { overall: 70, breakdown: {} } });
    const diff = compare(a, b);
    expect(diff.overall.direction).toBe('down');
  });
});
