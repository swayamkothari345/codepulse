import path from 'node:path';
import { SnapshotManager } from '../../history/snapshot-manager.js';
import * as logger from '../../utils/logger.js';

export function registerHistoryCommand(program) {
  program
    .command('history')
    .description('Show code health history over time')
    .argument('[target]', 'Project directory (default: .)', '.')
    .option('-n, --limit <n>', 'Number of snapshots to display', parseInt, 10)
    .option('--json', 'Output as JSON')
    .option('--delete <id>', 'Delete a snapshot by ID')
    .action(async (target, options) => {
      const { default: chalk } = await import('chalk');
      const rootDir = path.resolve(target);
      const manager = new SnapshotManager(rootDir);

      // ── Delete mode ─────────────────────────────────────────────────────
      if (options.delete) {
        const ok = manager.delete(options.delete);
        if (ok) {
          logger.success(`Snapshot deleted: ${options.delete}`);
        } else {
          logger.error(`Snapshot not found: ${options.delete}`);
          process.exit(1);
        }
        return;
      }

      // ── List mode ────────────────────────────────────────────────────────
      const all = manager.list();

      if (all.length === 0) {
        console.log(chalk.yellow('No snapshots found.'));
        console.log(chalk.dim('  Run `codepulse analyze . --save` to record your first snapshot.'));
        return;
      }

      const entries = all.slice(0, options.limit ?? 10);

      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      _renderHistory(chalk, entries, all.length);
    });
}

// ── Terminal renderer ─────────────────────────────────────────────────────────

function _renderHistory(chalk, entries, totalCount) {
  const W   = 70;
  const div = chalk.dim('─'.repeat(W));

  console.log('\n' + chalk.bold.cyan('CODEPULSE') + chalk.dim(' — Snapshot History'));
  console.log(div);
  console.log(
    `  ${'Timestamp'.padEnd(22)}` +
    `${'Score'.padEnd(8)}` +
    `${'Issues'.padEnd(10)}` +
    `${'Files'.padEnd(8)}` +
    `Label`
  );
  console.log(div);

  for (const entry of entries) {
    const ts    = new Date(entry.timestamp).toLocaleString().padEnd(22);
    const score = entry.overall !== null
      ? _scoreColor(chalk, entry.overall)(String(entry.overall).padEnd(8))
      : chalk.dim('n/a'.padEnd(8));
    const issues = String(entry.issueCount ?? 0).padEnd(10);
    const files  = String(entry.filesAnalyzed ?? 0).padEnd(8);
    const label  = entry.label ? chalk.dim(`"${entry.label}"`) : '';

    console.log(`  ${chalk.dim(ts)}${score}${issues}${files}${label}`);
    console.log(chalk.dim(`  id: ${entry.id}`));
  }

  if (totalCount > entries.length) {
    console.log(chalk.dim(`\n  Showing ${entries.length} of ${totalCount}. Use --limit N to see more.`));
  }

  console.log('\n' + div + '\n');
}

function _scoreColor(chalk, score) {
  if (score >= 80) return chalk.green.bold;
  if (score >= 60) return chalk.yellow.bold;
  return chalk.red.bold;
}
