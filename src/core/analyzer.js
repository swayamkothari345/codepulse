import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import * as logger from '../utils/logger.js';
import { calculateScores } from '../scoring/score-calculator.js';

// Babel parser options (mirrors ast-utils.js)
const PARSE_PLUGINS = [
  'jsx', 'asyncGenerators', 'bigInt', 'classProperties',
  'classPrivateProperties', 'classPrivateMethods', 'classStaticBlock',
  'dynamicImport', 'exportDefaultFrom', 'nullishCoalescingOperator',
  'numericSeparator', 'objectRestSpread', 'optionalCatchBinding',
  'optionalChaining', 'privateIn', 'topLevelAwait', 'logicalAssignment',
  'decorators-legacy',
];

// Maximum files parsed in parallel (limits peak memory + open-fd count)
const PARSE_CONCURRENCY = 20;

/**
 * Main analysis orchestrator.
 *
 * Phase 1: parses every file and collects basic metadata.
 * Subsequent phases will attach real analyzers (complexity, smells,
 * duplication, dependencies, scoring) through the _runAnalyzers hook.
 */
export class Analyzer {
  /**
   * @param {object} options
   * @param {object}   options.config  - Merged codepulse config.
   * @param {string[]} options.files   - Absolute paths to analyze.
   * @param {string}   options.rootDir - Project root.
   */
  constructor({ config, files, rootDir }) {
    this.config = config;
    this.files = files;
    this.rootDir = rootDir;

    // Registered analyzer modules (added by later phases)
    this._analyzers = [];
  }

  /**
   * Register an analyzer module.
   * Each module must export { name, analyze(fileResults, config) → issues[] }
   */
  registerAnalyzer(analyzerModule) {
    this._analyzers.push(analyzerModule);
  }

  /**
   * Run the full analysis pipeline and return a result object.
   */
  async analyze() {
    const startTime = Date.now();

    // ── Phase 1: Parse all files (concurrent async I/O + sync Babel parse) ─
    const parsed = await _pooled(this.files, PARSE_CONCURRENCY, (filePath) =>
      _parseAsync(filePath, this.rootDir)
    );

    const fileResults = [];
    let parseErrors = 0;
    const fileMap = new Map(); // filePath → fileResult  (O(1) finding attachment)

    for (const result of parsed) {
      if (result.error) {
        parseErrors++;
        logger.warn(`Parse error in ${result.relativePath}: ${result.error}`);
      }
      fileResults.push(result);
      fileMap.set(result.path, result);
    }

    // ── Phase 2+: Run registered analyzers ───────────────────────────────
    for (const analyzer of this._analyzers) {
      try {
        logger.verbose(`Running analyzer: ${analyzer.name}`);
        const findings = await analyzer.analyze(fileResults, this.config);
        for (const finding of findings) {
          const fileResult = fileMap.get(finding.filePath);
          if (fileResult) {
            fileResult.issues.push(finding);
          }
        }
      } catch (err) {
        logger.warn(`Analyzer "${analyzer.name}" failed: ${err.message}`);
      }
    }

    // ── Flatten all issues ────────────────────────────────────────────────
    const allIssues = fileResults.flatMap(f => f.issues ?? []);

    // Strip AST from final result (keep memory footprint reasonable)
    const cleanFileResults = fileResults.map(({ ast: _ast, code: _code, ...rest }) => rest);

    const duration = Date.now() - startTime;

    const result = {
      version: '0.1.0',
      rootDir: this.rootDir,
      filesAnalyzed: fileResults.filter(f => !f.error).length,
      filesWithErrors: parseErrors,
      totalFiles: this.files.length,
      files: cleanFileResults,
      issues: allIssues,
      metrics: this._aggregateMetrics(fileResults),
      scores: null,
      duration,
      timestamp: new Date().toISOString(),
    };

    result.scores = calculateScores(result, this.config);
    return result;
  }

  _aggregateMetrics(fileResults) {
    const analyzed = fileResults.filter(f => !f.error);
    const totalLines = analyzed.reduce((sum, f) => sum + (f.lines ?? 0), 0);
    return {
      totalFiles: analyzed.length,
      totalLines,
      avgLinesPerFile: analyzed.length > 0 ? Math.round(totalLines / analyzed.length) : 0,
    };
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Read a file asynchronously, then parse it synchronously with Babel.
 * Binary files (null bytes) are reported as errors rather than crashing.
 */
async function _parseAsync(filePath, rootDir) {
  const relativePath = path.relative(rootDir, filePath);
  let code;

  try {
    code = await readFile(filePath, 'utf8');
  } catch (e) {
    return { path: filePath, relativePath, error: `Cannot read file: ${e.message}`, lines: 0, issues: [], metrics: {} };
  }

  // Binary file detection — null bytes indicate non-text content
  if (code.includes('\0')) {
    return { path: filePath, relativePath, error: 'Binary file skipped', lines: 0, issues: [], metrics: {} };
  }

  // Synchronous Babel parse (try module then script)
  for (const sourceType of ['module', 'script']) {
    try {
      const ast = parse(code, {
        sourceType,
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        allowSuperOutsideMethod: true,
        errorRecovery: true,
        plugins: PARSE_PLUGINS,
      });
      return {
        path: filePath,
        relativePath,
        sourceType,
        lines: code.split('\n').length,
        parseErrors: ast.errors ?? [],
        ast,
        code,
        issues: [],
        metrics: {},
      };
    } catch {
      // try next sourceType
    }
  }

  return { path: filePath, relativePath, error: `Parse failed: ${filePath}`, lines: 0, issues: [], metrics: {} };
}

/**
 * Run `fn` over `items` with at most `concurrency` items in-flight at a time.
 * Preserves input order in the returned array.
 */
async function _pooled(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return results;
}
