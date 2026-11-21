/**
 * Terminal Reporter
 *
 * Renders a full-colour analysis report to stdout using chalk and cli-table3.
 *
 * Layout:
 *   ┌─ Header (project info) ──────────────────────────────────────────┐
 *   │  Overall health score + label                                     │
 *   │  Score breakdown table (5 dimensions)                             │
 *   │  Weakest dimension + recommendation                               │
 *   │  Issue summary (counts by severity)                               │
 *   │  Detailed findings (filtered by --severity, capped at maxFindings)│
 *   └──────────────────────────────────────────────────────────────────┘
 */

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * @param {object} result  — full analyzer result (with result.scores populated)
 * @param {object} options — CLI options: { severity, output, maxFindings }
 */
export async function renderTerminal(result, options = {}) {
  const { default: chalk } = await import('chalk');
  const { default: Table } = await import('cli-table3');

  const minSeverity = options.severity ?? 'low';
  const minOrder    = SEVERITY_ORDER[minSeverity] ?? 1;
  const maxItems    = options.maxFindings ?? 50;

  const W = 70;
  const div   = chalk.dim('─'.repeat(W));
  const divHeavy = chalk.dim('═'.repeat(W));

  // ── Header ───────────────────────────────────────────────────────────────
  console.log('\n' + divHeavy);
  console.log(
    '  ' + chalk.bold.cyan('CODEPULSE') +
    chalk.dim(' ─ Code Health Report') +
    chalk.dim(`  v${result.version ?? '0.1.0'}`)
  );
  console.log(divHeavy);
  console.log(`  ${chalk.dim('Project:')}        ${chalk.white(result.rootDir)}`);
  console.log(`  ${chalk.dim('Files analyzed:')} ${chalk.white(result.filesAnalyzed)}` +
    (result.filesWithErrors > 0 ? chalk.red(`  (${result.filesWithErrors} parse errors)`) : ''));
  console.log(`  ${chalk.dim('Total lines:')}    ${chalk.white(result.metrics?.totalLines ?? 0)}`);
  console.log(`  ${chalk.dim('Functions:')}      ${chalk.white(_countFunctions(result))}`);
  console.log(`  ${chalk.dim('Issues found:')}   ${chalk.white(result.issues.length)}`);
  console.log(`  ${chalk.dim('Duration:')}       ${chalk.white(result.duration + 'ms')}`);
  console.log(div);

  // ── Overall score ─────────────────────────────────────────────────────────
  if (result.scores) {
    const sc = result.scores;
    const scoreStr = _scoreColor(chalk, sc.overall)(`${sc.overall}/100`);
    const labelStr = _scoreColor(chalk, sc.overall)(`[${sc.label}]`);
    console.log(`\n  ${chalk.bold('Overall Health Score:')}  ${scoreStr}  ${labelStr}`);

    // ── Breakdown table ─────────────────────────────────────────────────────
    console.log('');
    const table = new Table({
      head: [
        chalk.dim('Dimension'),
        chalk.dim('Score'),
        chalk.dim('Grade'),
        chalk.dim('Weight'),
        chalk.dim('Top finding'),
      ],
      colWidths: [18, 8, 16, 9, 24],
      style: { head: [], border: ['dim'] },
      chars: {
        'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
        'left': '│', 'right': '│', 'mid': '─', 'mid-mid': '┼', 'middle': '│',
      },
    });

    const dims = ['complexity', 'duplication', 'maintainability', 'dependencies', 'hygiene'];
    for (const dim of dims) {
      const sub  = sc.breakdown[dim];
      const wt   = sc.weights[dim];
      const isWeakest = dim === sc.weakest;
      const scoreCol = _scoreColor(chalk, sub.score)(`${sub.score}`);
      const labelCol = _scoreColor(chalk, sub.score)(sub.label);
      const dimLabel = isWeakest
        ? chalk.yellow.bold(`▶ ${_cap(dim)}`)
        : chalk.white(_cap(dim));
      const topReason = sub.reasons[0]
        ? _truncate(sub.reasons[0], 22)
        : chalk.dim('—');

      table.push([dimLabel, scoreCol, labelCol, chalk.dim(`×${(wt * 100).toFixed(0)}%`), chalk.dim(topReason)]);
    }
    console.log(table.toString());

    // ── Recommendation ────────────────────────────────────────────────────
    console.log(`\n  ${chalk.bold('Recommendation:')} ${chalk.yellow(sc.recommendation)}`);
  } else {
    console.log(chalk.yellow('\n  Scores not available.'));
  }

  // ── Issue summary ─────────────────────────────────────────────────────────
  const bySev = _groupBySeverity(result.issues);
  console.log(`\n${div}`);
  console.log(`  ${chalk.bold('Issues by Severity:')}`);
  if (Object.keys(bySev).length === 0) {
    console.log(`    ${chalk.green('None — great work!')}`);
  } else {
    if (bySev.critical) console.log(`    ${chalk.bgRed.white.bold(' CRITICAL ')} ${chalk.red.bold(bySev.critical)}`);
    if (bySev.high)     console.log(`    ${chalk.red(' HIGH     ')} ${chalk.red(bySev.high)}`);
    if (bySev.medium)   console.log(`    ${chalk.yellow(' MEDIUM   ')} ${chalk.yellow(bySev.medium)}`);
    if (bySev.low)      console.log(`    ${chalk.gray(' LOW      ')} ${chalk.gray(bySev.low)}`);
  }

  // ── Detailed findings ─────────────────────────────────────────────────────
  const visible = result.issues.filter(i => (SEVERITY_ORDER[i.severity] ?? 0) >= minOrder);
  // Sort: severity desc, then file, then line
  visible.sort((a, b) =>
    (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
    a.filePath.localeCompare(b.filePath) ||
    (a.line ?? 0) - (b.line ?? 0)
  );

  if (visible.length > 0) {
    console.log(`\n${div}`);
    console.log(`  ${chalk.bold(`Findings`)} ${chalk.dim(`(severity ≥ ${minSeverity}, showing ${Math.min(visible.length, maxItems)} of ${visible.length})`)}`);
    console.log('');

    let currentFile = null;
    let shown = 0;
    for (const issue of visible) {
      if (shown >= maxItems) break;

      const relPath = issue.filePath.startsWith(result.rootDir)
        ? issue.filePath.slice(result.rootDir.length + 1)
        : issue.filePath;

      if (relPath !== currentFile) {
        currentFile = relPath;
        console.log(`  ${chalk.cyan.bold(relPath)}`);
      }

      const loc  = chalk.dim(`line ${issue.line ?? '?'}${issue.column != null ? ':' + issue.column : ''}`);
      const sev  = _sevBadge(chalk, issue.severity);
      const rule = chalk.dim(`[${issue.ruleId}]`);
      console.log(`    ${sev} ${chalk.white(issue.message)}  ${rule}`);
      console.log(`         ${loc}`);
      if (issue.suggestion) {
        console.log(`         ${chalk.dim('→')} ${chalk.dim(issue.suggestion)}`);
      }

      shown++;
    }

    if (visible.length > maxItems) {
      console.log(chalk.dim(`\n  … and ${visible.length - maxItems} more. Use --format json for the full list.`));
    }
  }

  console.log('\n' + divHeavy + '\n');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _countFunctions(result) {
  return result.files.reduce((sum, f) => sum + (f.metrics?.functionCount ?? 0), 0);
}

function _groupBySeverity(issues) {
  return issues.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] ?? 0) + 1;
    return acc;
  }, {});
}

function _scoreColor(chalk, score) {
  if (score >= 80) return chalk.green.bold;
  if (score >= 60) return chalk.yellow.bold;
  return chalk.red.bold;
}

function _sevBadge(chalk, severity) {
  switch (severity) {
    case 'critical': return chalk.bgRed.white.bold(' CRIT ');
    case 'high':     return chalk.red(' HIGH ');
    case 'medium':   return chalk.yellow(' MED  ');
    case 'low':      return chalk.gray(' LOW  ');
    default:         return chalk.gray(' INFO ');
  }
}

function _cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function _truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}
