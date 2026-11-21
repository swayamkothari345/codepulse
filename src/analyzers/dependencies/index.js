/**
 * Dependency Analyzer
 *
 * Builds the full project dependency graph, then detects:
 *   • Circular dependencies          (dependency/circular)
 *   • Files with too many imports    (dependency/too-many-imports)
 *
 * Also attaches graph metrics (in-degree, out-degree, cycle membership) to
 * each fileResult for use by the scoring engine.
 */

import path from 'node:path';
import { getRule } from '../../rules/registry.js';
import { registerDefaultRules } from '../../rules/defaults.js';
import { extractImports } from './import-extractor.js';
import { buildDependencyGraph, computeGraphMetrics } from './graph-builder.js';
import { detectCycles, formatCycle } from './cycle-detector.js';

export const name = 'dependencies';

// ── Finding factories ──────────────────────────────────────────────────────

function circularFinding(filePath, cycle, rootDir, severity) {
  const label = formatCycle(cycle, rootDir);
  return {
    ruleId: 'dependency/circular',
    severity,
    filePath,
    line: 1,
    column: 0,
    message: `Circular dependency: ${label}`,
    why: 'Circular imports can cause module initialisation failures (undefined values on first load) and tightly couple otherwise unrelated files, making refactoring painful.',
    suggestion: 'Extract the shared logic into a third module that neither participant imports, breaking the cycle.',
    metadata: { cycle },
  };
}

function tooManyImportsFinding(filePath, count, threshold, severity) {
  return {
    ruleId: 'dependency/too-many-imports',
    severity,
    filePath,
    line: 1,
    column: 0,
    message: `File imports ${count} local modules (threshold: ${threshold})`,
    why: 'Files that depend on many others often have too many responsibilities and become difficult to understand in isolation.',
    suggestion: 'Consider grouping related imports behind a facade module, or splitting this file into focused sub-modules.',
    metadata: { importCount: count },
  };
}

// ── Analyzer entry point ───────────────────────────────────────────────────

export async function analyze(fileResults, config) {
  registerDefaultRules();
  const findings = [];

  const circularRule    = getRule('dependency/circular');
  const tooManyRule     = getRule('dependency/too-many-imports');

  const tooManyThreshold = config?.thresholds?.maxImports ?? tooManyRule?.defaultOptions?.threshold ?? 15;

  // ── 1. Extract raw imports from every parsed file ──────────────────────
  for (const fileResult of fileResults) {
    if (!fileResult.ast || fileResult.error) {
      fileResult.rawImports = [];
      continue;
    }
    fileResult.rawImports = extractImports(fileResult.ast, fileResult.path);
  }

  // ── 2. Build dependency graph ──────────────────────────────────────────
  const analyzedFileSet = new Set(fileResults.map(f => f.path));
  const { graph, reverseGraph, edges } = buildDependencyGraph(fileResults, analyzedFileSet);
  const metrics = computeGraphMetrics(graph, reverseGraph);

  // ── 3. Detect cycles ───────────────────────────────────────────────────
  if (circularRule?.enabled !== false) {
    const cycles = detectCycles(graph);
    const rootDir = _inferRootDir(fileResults);

    // Track which files are part of a cycle (for metrics)
    const cycleMembers = new Set(cycles.flat());

    for (const cycle of cycles) {
      // Report the finding once, anchored to the first file in the cycle
      const firstFile = cycle[0];
      const fileResult = fileResults.find(f => f.path === firstFile);
      if (fileResult) {
        findings.push(circularFinding(firstFile, cycle, rootDir, circularRule.severity));
      }
    }

    // Attach to metrics
    for (const fileResult of fileResults) {
      if (!fileResult.error) {
        fileResult.metrics.inCycle = cycleMembers.has(fileResult.path);
      }
    }
  }

  // ── 4. Too many imports ────────────────────────────────────────────────
  if (tooManyRule?.enabled !== false) {
    for (const fileResult of fileResults) {
      if (fileResult.error) continue;
      const localImportCount = (graph.get(fileResult.path) ?? new Set()).size;
      if (localImportCount > tooManyThreshold) {
        findings.push(tooManyImportsFinding(fileResult.path, localImportCount, tooManyThreshold, tooManyRule.severity));
      }
    }
  }

  // ── 5. Attach per-file dependency metrics ─────────────────────────────
  for (const fileResult of fileResults) {
    if (fileResult.error) continue;
    const m = metrics.get(fileResult.path);
    if (m) {
      fileResult.metrics.outDegree  = m.outDegree;
      fileResult.metrics.inDegree   = m.inDegree;
    }
  }

  // ── 6. Attach project-level dependency metrics to each file result ─────
  //      (Scoring engine reads these from the first file or from the
  //       aggregated result object — attached here for completeness.)
  const totalEdges = edges.length;
  const cycleCount = detectCycles(graph).length; // second call is cheap (same graph)

  for (const fileResult of fileResults) {
    if (!fileResult.error) {
      fileResult.metrics.totalDependencyEdges = totalEdges;
      fileResult.metrics.cycleCount = cycleCount;
    }
  }

  return findings;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _inferRootDir(fileResults) {
  if (fileResults.length === 0) return process.cwd();
  // Find the longest common prefix of all file paths
  const paths = fileResults.map(f => f.path);
  let prefix = path.dirname(paths[0]);
  for (const p of paths) {
    while (!p.startsWith(prefix + path.sep) && prefix !== path.dirname(prefix)) {
      prefix = path.dirname(prefix);
    }
  }
  return prefix;
}
