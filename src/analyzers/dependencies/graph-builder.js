/**
 * Dependency Graph Builder
 *
 * Resolves raw import specifiers to absolute file paths, then builds:
 *   • graph        — Map<filePath, Set<filePath>>  (outgoing edges)
 *   • reverseGraph — Map<filePath, Set<filePath>>  (incoming edges)
 *
 * Resolution order for a specifier like './utils' from '/src/api/handler.js':
 *   1. /src/api/utils          (as-is, if it has an extension and exists in the set)
 *   2. /src/api/utils.js       (direct extension variants)
 *   3. /src/api/utils.mjs
 *   4. /src/api/utils.cjs
 *   5. /src/api/utils.jsx
 *   6. /src/api/utils/index.js (index file variants)
 *   7. /src/api/utils/index.mjs
 *   8. /src/api/utils/index.cjs
 *   9. /src/api/utils/index.jsx
 *
 * Only paths present in the `analyzedFileSet` are returned; unresolvable
 * or external specifiers produce `null` and are excluded from the graph.
 */

import path from 'node:path';

const EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx'];

/**
 * Try to resolve an import specifier to one of the analyzed files.
 *
 * @param {string}      source          — raw specifier (e.g. './utils')
 * @param {string}      fromFile        — absolute path of the importing file
 * @param {Set<string>} analyzedFileSet — set of all absolute paths being analyzed
 * @returns {string|null}
 */
export function resolveImport(source, fromFile, analyzedFileSet) {
  if (!source.startsWith('.')) return null; // not a relative import

  const dir     = path.dirname(fromFile);
  const absBase = path.resolve(dir, source);

  // 1. As-is (source already includes an extension)
  if (analyzedFileSet.has(absBase)) return absBase;

  // 2. Direct extension variants
  for (const ext of EXTENSIONS) {
    const candidate = absBase + ext;
    if (analyzedFileSet.has(candidate)) return candidate;
  }

  // 3. Index file variants
  for (const ext of EXTENSIONS) {
    const candidate = path.join(absBase, 'index' + ext);
    if (analyzedFileSet.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Build a bidirectional dependency graph from already-extracted imports.
 *
 * Each fileResult must have a `.rawImports` array (from import-extractor).
 *
 * @param {object[]}    fileResults     — analyzer file result objects
 * @param {Set<string>} analyzedFileSet — set of all analyzed file paths
 * @returns {{ graph: Map, reverseGraph: Map, edges: object[] }}
 */
export function buildDependencyGraph(fileResults, analyzedFileSet) {
  /** @type {Map<string, Set<string>>} */
  const graph = new Map();
  /** @type {Map<string, Set<string>>} */
  const reverseGraph = new Map();
  /** @type {Array<{from: string, to: string, kind: string, line: number}>} */
  const edges = [];

  // Initialise every node so isolated files appear in the graph
  for (const { path: fp } of fileResults) {
    if (!graph.has(fp)) graph.set(fp, new Set());
    if (!reverseGraph.has(fp)) reverseGraph.set(fp, new Set());
  }

  // Add edges
  for (const fileResult of fileResults) {
    const from = fileResult.path;
    for (const imp of fileResult.rawImports ?? []) {
      const to = resolveImport(imp.source, from, analyzedFileSet);
      if (!to) continue;        // unresolvable or external
      if (to === from) continue; // self-import (unusual but possible)

      graph.get(from).add(to);
      if (!reverseGraph.has(to)) reverseGraph.set(to, new Set());
      reverseGraph.get(to).add(from);

      edges.push({ from, to, kind: imp.kind, line: imp.line });
    }
  }

  return { graph, reverseGraph, edges };
}

/**
 * Compute per-file metrics from the dependency graph.
 *
 * @returns {Map<string, { inDegree, outDegree, fanIn, fanOut }>}
 */
export function computeGraphMetrics(graph, reverseGraph) {
  const metrics = new Map();

  for (const [file, deps] of graph) {
    const inbound  = reverseGraph.get(file) ?? new Set();
    metrics.set(file, {
      outDegree: deps.size,       // how many files this one imports
      inDegree:  inbound.size,    // how many files import this one
    });
  }

  return metrics;
}
