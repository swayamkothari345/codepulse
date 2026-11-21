/**
 * HTML Reporter
 *
 * Generates a self-contained, single-file HTML report.
 * No external dependencies — all CSS and JS are inlined.
 *
 * Sections:
 *   • Header (project info + timestamp)
 *   • Overall score gauge (SVG arc)
 *   • Sub-score cards (5 dimensions)
 *   • Recommendation banner
 *   • Issue table (sortable, filterable by severity)
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as logger from '../utils/logger.js';

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * @param {object} result  — full analyzer result (with result.scores populated)
 * @param {object} options — CLI options: { output, severity }
 */
export async function renderHtml(result, options = {}) {
  const html = _buildHtml(result, options);

  const dest = options.output
    ? path.resolve(options.output)
    : path.join(process.cwd(), 'codepulse-report.html');

  writeFileSync(dest, html, 'utf8');
  logger.success(`HTML report written to ${dest}`);
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function _buildHtml(result, options) {
  const sc      = result.scores;
  const minSev  = options.severity ?? 'low';
  const minOrd  = SEVERITY_ORDER[minSev] ?? 1;
  const visible = (result.issues ?? [])
    .filter(i => (SEVERITY_ORDER[i.severity] ?? 0) >= minOrd)
    .sort((a, b) =>
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
      a.filePath.localeCompare(b.filePath) ||
      (a.line ?? 0) - (b.line ?? 0)
    );

  const ts = result.timestamp
    ? new Date(result.timestamp).toLocaleString()
    : new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CodePulse Report — ${_esc(path.basename(result.rootDir ?? 'project'))}</title>
<style>
${_css()}
</style>
</head>
<body>
<div class="container">

  ${_header(result, ts)}
  ${sc ? _scoreSection(sc) : '<p class="warn">Scores not available.</p>'}
  ${sc ? _recommendationBanner(sc) : ''}
  ${_issueSection(visible, result.rootDir ?? '')}

</div>
<script>${_js()}</script>
</body>
</html>`;
}

// ── Sections ──────────────────────────────────────────────────────────────────

function _header(result, ts) {
  const fnCount = (result.files ?? []).reduce((s, f) => s + (f.metrics?.functionCount ?? 0), 0);
  const errorRow = result.filesWithErrors > 0
    ? `<tr><td>Parse errors</td><td class="warn">${result.filesWithErrors}</td></tr>`
    : '';

  return `<header>
  <h1><span class="brand">CodePulse</span> Code Health Report</h1>
  <table class="meta">
    <tr><td>Project</td><td>${_esc(result.rootDir ?? '')}</td></tr>
    <tr><td>Files analyzed</td><td>${result.filesAnalyzed ?? 0}</td></tr>
    ${errorRow}
    <tr><td>Total lines</td><td>${result.metrics?.totalLines ?? 0}</td></tr>
    <tr><td>Functions</td><td>${fnCount}</td></tr>
    <tr><td>Issues found</td><td>${(result.issues ?? []).length}</td></tr>
    <tr><td>Duration</td><td>${result.duration ?? 0} ms</td></tr>
    <tr><td>Generated</td><td>${_esc(ts)}</td></tr>
  </table>
</header>`;
}

function _scoreSection(sc) {
  const gaugeColor = sc.overall >= 80 ? '#22c55e' : sc.overall >= 60 ? '#f59e0b' : '#ef4444';
  // SVG arc gauge (semicircle, 0–180 degrees)
  const pct  = sc.overall / 100;
  const r    = 70;
  const cx   = 90;
  const cy   = 90;
  const startX = cx - r;
  const startY = cy;
  // Angle: 180° → 0° (right half of a circle, top-arc)
  const angle  = Math.PI * (1 - pct);
  const endX   = cx + r * Math.cos(angle);
  const endY   = cy - r * Math.sin(angle);
  const large  = pct > 0.5 ? 1 : 0;

  const arcPath  = `M ${startX},${startY} A ${r},${r} 0 ${large} 1 ${endX.toFixed(2)},${endY.toFixed(2)}`;
  const trackPath = `M ${startX},${startY} A ${r},${r} 0 1 1 ${cx + r},${cy}`;

  const cards = ['complexity','duplication','maintainability','dependencies','hygiene']
    .map(dim => _scoreCard(dim, sc.breakdown[dim], sc.weights[dim], dim === sc.weakest))
    .join('\n');

  return `<section class="scores">
  <div class="gauge-wrap">
    <svg viewBox="0 0 180 100" class="gauge">
      <path d="${trackPath}" fill="none" stroke="#2d2d2d" stroke-width="14" stroke-linecap="round"/>
      <path d="${arcPath}" fill="none" stroke="${gaugeColor}" stroke-width="14" stroke-linecap="round"/>
      <text x="${cx}" y="${cy - 10}" text-anchor="middle" class="gauge-score" fill="${gaugeColor}">${sc.overall}</text>
      <text x="${cx}" y="${cy + 8}" text-anchor="middle" class="gauge-label" fill="#aaa">${_esc(sc.label)}</text>
    </svg>
    <p class="gauge-caption">Overall Health Score</p>
  </div>
  <div class="cards">
    ${cards}
  </div>
</section>`;
}

function _scoreCard(dim, sub, weight, isWeakest) {
  const color = sub.score >= 80 ? '#22c55e' : sub.score >= 60 ? '#f59e0b' : '#ef4444';
  const weakClass = isWeakest ? ' weakest' : '';
  const topReason = sub.reasons[0] ? `<p class="reason">${_esc(sub.reasons[0])}</p>` : '';
  return `<div class="card${weakClass}">
  <div class="card-score" style="color:${color}">${sub.score}</div>
  <div class="card-dim">${_cap(dim)}</div>
  <div class="card-label" style="color:${color}">${_esc(sub.label)}</div>
  <div class="card-weight">weight ×${(weight * 100).toFixed(0)}%</div>
  ${topReason}
  ${isWeakest ? '<div class="weakest-badge">▶ Weakest</div>' : ''}
</div>`;
}

function _recommendationBanner(sc) {
  return `<section class="recommendation">
  <strong>Recommendation:</strong> ${_esc(sc.recommendation)}
</section>`;
}

function _issueSection(visible, rootDir) {
  if (visible.length === 0) {
    return `<section class="issues">
  <h2>Issues</h2>
  <p class="ok">No issues found — great work!</p>
</section>`;
  }

  const rows = visible.map(issue => {
    const relPath = issue.filePath.startsWith(rootDir)
      ? issue.filePath.slice(rootDir.length + 1)
      : issue.filePath;
    const loc = `${relPath}:${issue.line ?? '?'}`;
    return `<tr data-sev="${_esc(issue.severity)}">
  <td><span class="badge sev-${_esc(issue.severity)}">${_esc(issue.severity)}</span></td>
  <td>${_esc(issue.message)}</td>
  <td class="mono">${_esc(loc)}</td>
  <td class="mono dim">${_esc(issue.ruleId)}</td>
  <td class="dim">${_esc(issue.suggestion ?? '')}</td>
</tr>`;
  }).join('\n');

  return `<section class="issues">
  <h2>Issues <span class="count">(${visible.length})</span></h2>
  <div class="filter-bar">
    <label>Filter:
      <select id="sev-filter" onchange="filterIssues(this.value)">
        <option value="">All severities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    </label>
    <label style="margin-left:1rem">Search:
      <input id="search" type="text" placeholder="file or message…" oninput="filterIssues()">
    </label>
  </div>
  <table class="issue-table" id="issue-table">
    <thead>
      <tr>
        <th onclick="sortTable(0)">Severity</th>
        <th onclick="sortTable(1)">Message</th>
        <th onclick="sortTable(2)">Location</th>
        <th onclick="sortTable(3)">Rule</th>
        <th onclick="sortTable(4)">Suggestion</th>
      </tr>
    </thead>
    <tbody id="issue-body">
      ${rows}
    </tbody>
  </table>
</section>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

function _css() {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f0f;color:#e2e8f0;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.6}
.container{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}

/* Header */
header{margin-bottom:2rem}
h1{font-size:1.6rem;font-weight:700;color:#38bdf8;margin-bottom:1rem}
.brand{color:#818cf8}
table.meta{border-collapse:collapse;font-size:13px;color:#94a3b8}
table.meta td{padding:2px 12px 2px 0}
table.meta td:first-child{color:#64748b;min-width:140px}

/* Scores */
.scores{display:flex;align-items:flex-start;gap:2rem;margin-bottom:2rem;flex-wrap:wrap}
.gauge-wrap{display:flex;flex-direction:column;align-items:center;min-width:180px}
.gauge{width:180px;height:110px}
.gauge-score{font-size:28px;font-weight:700}
.gauge-label{font-size:11px}
.gauge-caption{font-size:12px;color:#64748b;margin-top:4px}
.cards{display:flex;flex-wrap:wrap;gap:12px;flex:1}
.card{background:#1e1e2e;border:1px solid #2d2d3f;border-radius:10px;padding:1rem;min-width:140px;flex:1}
.card.weakest{border-color:#f59e0b}
.card-score{font-size:2rem;font-weight:700}
.card-dim{font-weight:600;font-size:0.9rem;color:#cbd5e1;margin-top:2px}
.card-label{font-size:0.75rem;margin-top:1px}
.card-weight{font-size:0.7rem;color:#475569;margin-top:4px}
.reason{font-size:0.7rem;color:#64748b;margin-top:6px;line-height:1.4}
.weakest-badge{font-size:0.7rem;color:#f59e0b;margin-top:6px;font-weight:600}

/* Recommendation */
.recommendation{background:#1e2a1e;border-left:4px solid #22c55e;border-radius:4px;padding:0.75rem 1rem;margin-bottom:2rem;font-size:0.9rem;color:#bbf7d0}

/* Issues */
.issues h2{font-size:1.1rem;font-weight:600;margin-bottom:1rem;color:#94a3b8}
.count{color:#475569;font-size:0.9rem;font-weight:400}
.ok{color:#22c55e}
.warn{color:#f59e0b}
.filter-bar{margin-bottom:0.75rem;display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:13px;color:#64748b}
.filter-bar select,.filter-bar input{background:#1e1e2e;border:1px solid #2d2d3f;border-radius:4px;padding:3px 6px;color:#e2e8f0;font-size:13px;margin-left:4px}
.issue-table{width:100%;border-collapse:collapse;font-size:13px}
.issue-table th{background:#1e1e2e;color:#64748b;text-align:left;padding:6px 8px;cursor:pointer;user-select:none;border-bottom:1px solid #2d2d3f}
.issue-table th:hover{color:#94a3b8}
.issue-table td{padding:6px 8px;border-bottom:1px solid #1a1a2e;vertical-align:top}
.issue-table tr:hover td{background:#1e1e2e}
.mono{font-family:'Consolas','Courier New',monospace;font-size:12px;white-space:nowrap}
.dim{color:#475569}
.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase}
.sev-critical{background:#7f1d1d;color:#fca5a5}
.sev-high{background:#78350f;color:#fcd34d}
.sev-medium{background:#1e3a5f;color:#93c5fd}
.sev-low{background:#1e293b;color:#94a3b8}
`;
}

// ── JS ────────────────────────────────────────────────────────────────────────

function _js() {
  return `
function filterIssues(sev){
  const sevVal = sev !== undefined ? sev : document.getElementById('sev-filter').value;
  const search = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#issue-body tr').forEach(tr => {
    const matchSev = !sevVal || tr.dataset.sev === sevVal;
    const text = tr.textContent.toLowerCase();
    const matchSearch = !search || text.includes(search);
    tr.style.display = matchSev && matchSearch ? '' : 'none';
  });
}
let _sortDir = {};
function sortTable(col){
  const tbody = document.getElementById('issue-body');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const dir = (_sortDir[col] = !_sortDir[col]);
  rows.sort((a,b) => {
    const av = a.cells[col]?.textContent.trim() ?? '';
    const bv = b.cells[col]?.textContent.trim() ?? '';
    return dir ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}
`;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
