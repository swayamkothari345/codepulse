import path from 'node:path';
import { SnapshotManager } from '../../history/snapshot-manager.js';
import { compare } from '../../history/comparison-engine.js';
import * as logger from '../../utils/logger.js';

export function registerCompareCommand(program) {
  program
    .command('compare')
    .description('Compare two snapshots (or latest vs previous)')
    .argument('[target]', 'Project directory (default: .)', '.')
    .argument('[snapshotA]', 'Baseline snapshot ID (default: second-most-recent)')
    .argument('[snapshotB]', 'Current snapshot ID  (default: most-recent)')
    .option('--json', 'Output diff as JSON')
    .action(async (target, snapshotA, snapshotB, options) => {
      const { default: chalk } = await import('chalk');
      const rootDir = path.resolve(target);
      const manager = new SnapshotManager(rootDir);
      const all     = manager.list(); // most-recent first

      if (all.length < 2 && !(snapshotA && snapshotB)) {
        logger.warn('Need at least 2 saved snapshots to compare.');
        logger.warn('Run `codepulse analyze . --save` to record snapshots.');
        process.exit(1);
      }

      // Resolve snapshot IDs
      const idA = snapshotA ?? all[1]?.id;
      const idB = snapshotB ?? all[0]?.id;

      const snapA = manager.load(idA);
      const snapB = manager.load(idB);

      if (!snapA) { logger.error(`Snapshot not found: ${idA}`); process.exit(1); }
      if (!snapB) { logger.error(`Snapshot not found: ${idB}`); process.exit(1); }

      const diff = compare(snapA, snapB);

      if (options.json) {
        console.log(JSON.stringify(diff, null, 2));
        return;
      }

      _renderDiff(chalk, diff);
    });
}

// ── Terminal renderer ─────────────────────────────────────────────────────────

function _renderDiff(chalk, diff) {
  const W   = 70;
  const div = chalk.dim('─'.repeat(W));

  const tsA = new Date(diff.snapshotA.timestamp).toLocaleString();
  const tsB = new Date(diff.snapshotB.timestamp).toLocaleString();

  console.log('\n' + chalk.bold.cyan('CODEPULSE') + chalk.dim(' — Comparison Report'));
  console.log(div);
  console.log(`  ${chalk.dim('Baseline:')} ${chalk.white(tsA)}  ${chalk.dim(diff.snapshotA.id)}` +
    (diff.snapshotA.label ? chalk.dim(` "${diff.snapshotA.label}"`) : ''));
  console.log(`  ${chalk.dim('Current: ')} ${chalk.white(tsB)}  ${chalk.dim(diff.snapshotB.id)}` +
    (diff.snapshotB.label ? chalk.dim(` "${diff.snapshotB.label}"`) : ''));
  console.log(div);

  // ── Overall ───────────────────────────────────────────────────────────────
  const ov = diff.overall;
  const trendColor = diff.trend === 'improved' ? chalk.green
                   : diff.trend === 'regressed' ? chalk.red
                   : chalk.gray;
  const trendIcon  = diff.trend === 'improved' ? '▲' : diff.trend === 'regressed' ? '▼' : '●';

  const beforeStr = ov.before !== null ? String(ov.before) : 'n/a';
  const afterStr  = ov.after  !== null ? String(ov.after)  : 'n/a';
  const deltaStr  = ov.delta  !== null ? _deltaStr(ov.delta) : '—';

  console.log(`\n  ${chalk.bold('Overall Score:')}  ${chalk.white(beforeStr)} → ${_scoreColor(chalk, ov.after ?? 0)(afterStr)}  ${trendColor(trendIcon + ' ' + deltaStr)}  ${trendColor('[' + diff.trend + ']')}`);

  // ── Breakdown ─────────────────────────────────────────────────────────────
  console.log(`\n  ${chalk.bold('Dimension breakdown:')}`);
  const dims = ['complexity', 'duplication', 'maintainability', 'dependencies', 'hygiene'];
  for (const dim of dims) {
    const d  = diff.breakdown[dim];
    const lbl = _cap(dim).padEnd(16);
    const bef = d.before !== null ? String(d.before).padStart(3) : ' n/a';
    const aft = d.after  !== null ? _scoreColor(chalk, d.after)(String(d.after).padStart(3)) : ' n/a';
    const dlt = d.delta  !== null ? _deltaColor(chalk, d.delta)(_deltaStr(d.delta).padStart(5)) : '    —';
    console.log(`    ${chalk.dim(lbl)}  ${bef} → ${aft}  ${dlt}`);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────
  console.log(`\n  ${chalk.bold('Metrics:')}`);
  const { totalLines, issueCount, filesAnalyzed } = diff.metrics;
  console.log(`    ${'Total lines'.padEnd(16)}  ${totalLines.before} → ${totalLines.after}  ${_deltaColor(chalk, totalLines.delta)(_deltaStr(totalLines.delta))}`);
  console.log(`    ${'Issues'.padEnd(16)}  ${issueCount.before} → ${issueCount.after}  ${_deltaColor(chalk, -issueCount.delta)(_deltaStr(-issueCount.delta))}`);
  console.log(`    ${'Files analyzed'.padEnd(16)}  ${filesAnalyzed.before} → ${filesAnalyzed.after}  ${_deltaColor(chalk, filesAnalyzed.delta)(_deltaStr(filesAnalyzed.delta))}`);

  console.log('\n' + div + '\n');
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function _deltaStr(d) {
  if (d === null) return '—';
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return '±0';
}

function _deltaColor(chalk, d) {
  if (d === null || d === 0) return chalk.gray;
  return d > 0 ? chalk.green : chalk.red;
}

function _scoreColor(chalk, score) {
  if (score >= 80) return chalk.green.bold;
  if (score >= 60) return chalk.yellow.bold;
  return chalk.red.bold;
}

function _cap(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
