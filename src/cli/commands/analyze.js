import path from 'node:path';
import { ProjectScanner } from '../../core/project-scanner.js';
import { Analyzer } from '../../core/analyzer.js';
import { loadConfig } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { complexityAnalyzer, smellsAnalyzer, duplicationAnalyzer, dependencyAnalyzer } from '../../analyzers/index.js';
import * as logger from '../../utils/logger.js';
import { renderTerminal } from '../../reporters/terminal.js';
import { renderJson } from '../../reporters/json.js';
import { renderHtml } from '../../reporters/html.js';
import { SnapshotManager } from '../../history/snapshot-manager.js';

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };

export function registerAnalyzeCommand(program) {
  program
    .command('analyze')
    .description('Analyze a JavaScript project or directory')
    .argument('[target]', 'Directory or file to analyze', '.')
    .option('-f, --format <format>', 'Output format: terminal | json | html', 'terminal')
    .option('-o, --output <path>', 'Write report to this file path')
    .option('-s, --severity <level>', 'Minimum severity to report: critical|high|medium|low', 'low')
    .option('--save', 'Save a snapshot for historical comparison')
    .option('--label <text>', 'Label for the saved snapshot (requires --save)')
    .option('--config <path>', 'Path to config file (default: ./codepulse.config.js)')
    .option('--ignore <patterns...>', 'Additional ignore glob patterns')
    .option('--fail-on <severity>', 'Exit 1 if any issue at this severity or above is found')
    .option('--max-warnings <number>', 'Exit 1 if total warning count exceeds this number', parseInt)
    .option('--quiet', 'Suppress all output except errors (useful in CI)')
    .action(async (target, options) => {
      if (options.quiet) logger.setLevel('error');

      try {
        const resolvedTarget = path.resolve(target);
        const config = await loadConfig(options.config);

        // Merge CLI ignores into config
        if (options.ignore) {
          config.ignore = [...(config.ignore ?? []), ...options.ignore];
        }

        // ── Validate config ────────────────────────────────────────────────
        const { valid, errors: cfgErrors, warnings: cfgWarnings } = validateConfig(config);
        cfgWarnings.forEach(w => logger.warn(`Config: ${w}`));
        if (!valid) {
          cfgErrors.forEach(e => logger.error(`Config error: ${e}`));
          process.exit(2);
        }

        // ── Scan ───────────────────────────────────────────────────────────
        const spinner = await _spinner(`Scanning ${resolvedTarget} …`);
        const scanner = new ProjectScanner({
          rootDir: resolvedTarget,
          ignore: config.ignore,
          extensions: config.extensions,
        });

        let files, skipped;
        try {
          ({ files, skipped } = await scanner.scan());
        } catch (err) {
          spinner.fail(err.message);
          process.exit(1);
        }

        spinner.succeed(`Found ${files.length} file${files.length !== 1 ? 's' : ''}`);

        if (files.length === 0) {
          logger.warn('No JavaScript files found to analyze.');
          process.exit(0);
        }

        // ── Analyze ────────────────────────────────────────────────────────
        const analyzeSpinner = await _spinner(`Analyzing ${files.length} files …`);
        const analyzer = new Analyzer({ config, files, rootDir: resolvedTarget });

        analyzer.registerAnalyzer(complexityAnalyzer);
        analyzer.registerAnalyzer(smellsAnalyzer);
        analyzer.registerAnalyzer(duplicationAnalyzer);
        analyzer.registerAnalyzer(dependencyAnalyzer);

        const result = await analyzer.analyze();
        analyzeSpinner.succeed(`Analysis complete — ${result.duration}ms`);

        // ── Report ─────────────────────────────────────────────────────────
        await _report(result, options, config);

        // ── Save snapshot ──────────────────────────────────────────────────
        if (options.save) {
          const manager = new SnapshotManager(resolvedTarget);
          const snap = manager.save(result, { label: options.label });
          logger.success(`Snapshot saved: ${snap.id}`);
        }

        // ── Exit codes ─────────────────────────────────────────────────────
        _handleExitCodes(result, options);

      } catch (err) {
        logger.error(err.message);
        if (process.env.CODEPULSE_DEBUG) console.error(err.stack);
        process.exit(1);
      }
    });
}

async function _report(result, options, _config) {
  const fmt = options.format ?? 'terminal';

  switch (fmt) {
    case 'json':
      await renderJson(result, options);
      break;
    case 'html':
      await renderHtml(result, options);
      break;
    default:
      await renderTerminal(result, options);
  }
}

function _handleExitCodes(result, options) {
  if (options.failOn) {
    const threshold = SEVERITY_ORDER[options.failOn];
    if (threshold !== undefined) {
      const hasFailures = result.issues.some(
        i => (SEVERITY_ORDER[i.severity] ?? 0) >= threshold
      );
      if (hasFailures) {
        logger.error(`Exiting with code 1: issues at severity "${options.failOn}" or above found.`);
        process.exit(1);
      }
    }
  }

  if (options.maxWarnings !== undefined) {
    if (result.issues.length > options.maxWarnings) {
      logger.error(`Exiting with code 1: ${result.issues.length} issues exceed --max-warnings ${options.maxWarnings}.`);
      process.exit(1);
    }
  }
}

async function _spinner(text) {
  const { default: ora } = await import('ora');
  return ora({ text, isSilent: process.env.CI === 'true' }).start();
}
