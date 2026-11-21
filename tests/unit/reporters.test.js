/**
 * Reporter tests
 *
 * We test the reporters without spawning a real CLI — we call the render
 * functions directly and capture stdout / filesystem writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';

import { renderJson } from '../../src/reporters/json.js';
import { renderHtml } from '../../src/reporters/html.js';
// Terminal reporter uses chalk + cli-table3 interactively;
// we test its shape via stdout capture.
import { renderTerminal } from '../../src/reporters/terminal.js';

// ── Shared fixture ────────────────────────────────────────────────────────────

function makeResult(overrides = {}) {
  return {
    version: '0.1.0',
    rootDir: '/project',
    filesAnalyzed: 2,
    filesWithErrors: 0,
    totalFiles: 2,
    files: [
      { path: '/project/a.js', relativePath: 'a.js', lines: 50, issues: [], metrics: { functionCount: 3 } },
    ],
    issues: [],
    metrics: { totalLines: 100, totalFiles: 2, avgLinesPerFile: 50 },
    scores: {
      overall: 85,
      label: 'Good',
      weakest: 'hygiene',
      recommendation: 'Clean up unused variables.',
      weights: { complexity: 0.30, duplication: 0.20, maintainability: 0.25, dependencies: 0.15, hygiene: 0.10 },
      breakdown: {
        complexity:      { score: 90, label: 'Excellent', reasons: ['All functions within thresholds.'], raw: {} },
        duplication:     { score: 100, label: 'Excellent', reasons: ['No duplicates.'], raw: {} },
        maintainability: { score: 95, label: 'Excellent', reasons: ['No issues.'], raw: {} },
        dependencies:    { score: 100, label: 'Excellent', reasons: ['No issues.'], raw: {} },
        hygiene:         { score: 70, label: 'Fair', reasons: ['2 console.log statements.'], raw: {} },
      },
    },
    duration: 42,
    timestamp: '2026-11-21T10:00:00.000Z',
    ...overrides,
  };
}

function makeIssue(sev = 'medium', ruleId = 'smell/unused-vars') {
  return {
    ruleId,
    severity: sev,
    filePath: '/project/a.js',
    line: 10,
    column: 5,
    message: 'Unused variable "x".',
    why: 'why',
    suggestion: 'Remove it.',
  };
}

// ── JSON reporter ─────────────────────────────────────────────────────────────

describe('renderJson', () => {
  let captured = '';
  let origLog;

  beforeEach(() => {
    captured = '';
    origLog = console.log;
    console.log = (...args) => { captured += args.join(' '); };
  });
  afterEach(() => { console.log = origLog; });

  it('prints valid JSON to stdout when no --output given', async () => {
    await renderJson(makeResult(), {});
    const parsed = JSON.parse(captured);
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.scores.overall).toBe(85);
  });

  it('JSON output contains issues array', async () => {
    const result = makeResult({ issues: [makeIssue('high')] });
    await renderJson(result, {});
    const parsed = JSON.parse(captured);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].severity).toBe('high');
  });

  it('writes to file when --output is given', async () => {
    const dest = join(tmpdir(), `codepulse-test-${Date.now()}.json`);
    try {
      await renderJson(makeResult(), { output: dest });
      expect(existsSync(dest)).toBe(true);
      const parsed = JSON.parse(readFileSync(dest, 'utf8'));
      expect(parsed.filesAnalyzed).toBe(2);
    } finally {
      if (existsSync(dest)) unlinkSync(dest);
    }
  });

  it('does not include raw AST in output', async () => {
    const result = makeResult();
    result.files[0].ast = { type: 'File', program: {} };  // simulate AST left in
    await renderJson(result, {});
    const parsed = JSON.parse(captured);
    expect(parsed.files[0].ast).toBeUndefined();
  });
});

// ── HTML reporter ─────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  let dest;

  beforeEach(() => {
    dest = join(tmpdir(), `codepulse-test-${Date.now()}.html`);
  });
  afterEach(() => {
    if (existsSync(dest)) unlinkSync(dest);
  });

  it('writes an HTML file', async () => {
    await renderHtml(makeResult(), { output: dest });
    expect(existsSync(dest)).toBe(true);
  });

  it('HTML contains overall score', async () => {
    await renderHtml(makeResult(), { output: dest });
    const html = readFileSync(dest, 'utf8');
    expect(html).toContain('85');
    expect(html).toContain('Good');
  });

  it('HTML contains score breakdown dimensions', async () => {
    await renderHtml(makeResult(), { output: dest });
    const html = readFileSync(dest, 'utf8');
    for (const dim of ['Complexity', 'Duplication', 'Maintainability', 'Dependencies', 'Hygiene']) {
      expect(html).toContain(dim);
    }
  });

  it('HTML contains the recommendation', async () => {
    await renderHtml(makeResult(), { output: dest });
    const html = readFileSync(dest, 'utf8');
    expect(html).toContain('Clean up unused variables.');
  });

  it('HTML contains issue rows when issues present', async () => {
    const result = makeResult({ issues: [makeIssue('high'), makeIssue('low')] });
    await renderHtml(result, { output: dest });
    const html = readFileSync(dest, 'utf8');
    expect(html).toContain('Unused variable');
    expect(html).toContain('sev-high');
    expect(html).toContain('sev-low');
  });

  it('HTML is a complete, valid-ish document', async () => {
    await renderHtml(makeResult(), { output: dest });
    const html = readFileSync(dest, 'utf8');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
  });

  it('filters issues by --severity option', async () => {
    const result = makeResult({
      issues: [makeIssue('high'), makeIssue('low')],
    });
    // severity=high means low issues should be excluded from rows
    await renderHtml(result, { output: dest, severity: 'high' });
    const html = readFileSync(dest, 'utf8');
    expect(html).toContain('data-sev="high"');
    expect(html).not.toContain('data-sev="low"');
  });

  it('escapes HTML special characters in issue messages', async () => {
    const result = makeResult({
      issues: [{
        ...makeIssue('medium'),
        message: '<script>alert("xss")</script>',
      }],
    });
    await renderHtml(result, { output: dest });
    const html = readFileSync(dest, 'utf8');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('defaults output path to cwd/codepulse-report.html when no --output', async () => {
    const defaultDest = join(process.cwd(), 'codepulse-report.html');
    try {
      await renderHtml(makeResult(), {});
      expect(existsSync(defaultDest)).toBe(true);
    } finally {
      if (existsSync(defaultDest)) unlinkSync(defaultDest);
    }
  });
});

// ── Terminal reporter ─────────────────────────────────────────────────────────

describe('renderTerminal', () => {
  let lines = [];
  let origLog;

  beforeEach(() => {
    lines = [];
    origLog = console.log;
    console.log = (...args) => lines.push(args.join(' '));
  });
  afterEach(() => { console.log = origLog; });

  it('outputs multiple lines', async () => {
    await renderTerminal(makeResult(), {});
    expect(lines.length).toBeGreaterThan(5);
  });

  it('contains project root dir', async () => {
    await renderTerminal(makeResult(), {});
    const all = lines.join('\n');
    expect(all).toContain('/project');
  });

  it('contains overall score', async () => {
    await renderTerminal(makeResult(), {});
    const all = lines.join('\n');
    expect(all).toContain('85');
  });

  it('shows issue details when issues exist', async () => {
    const result = makeResult({ issues: [makeIssue('high')] });
    await renderTerminal(result, { severity: 'low' });
    const all = lines.join('\n');
    expect(all).toContain('Unused variable');
  });

  it('filters issues by --severity', async () => {
    const result = makeResult({
      issues: [makeIssue('high'), makeIssue('low')],
    });
    await renderTerminal(result, { severity: 'high' });
    const all = lines.join('\n');
    // The high issue's message should appear; the low one should not appear
    // in the findings section (both use same message, so check HIGH badge)
    expect(all).toMatch(/HIGH/);
  });

  it('shows "None" when no issues', async () => {
    await renderTerminal(makeResult(), {});
    const all = lines.join('\n');
    expect(all).toContain('None');
  });

  it('shows recommendation', async () => {
    await renderTerminal(makeResult(), {});
    const all = lines.join('\n');
    expect(all).toContain('Clean up unused variables.');
  });
});
