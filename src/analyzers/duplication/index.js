/**
 * Duplication Analyzer
 *
 * Two complementary strategies:
 *
 * 1. Function-level comparison — hash each function's normalized body.
 *    Two functions with identical structure (after identifier/literal erasure)
 *    are reported as duplicates regardless of their size.
 *
 * 2. Statement-sequence sliding window — for every block of statements in
 *    every file, generate windows of `minStatements` consecutive statements,
 *    hash their normalized form, and find windows that match across locations.
 *    Adjacent matching windows are merged into the largest continuous region.
 *
 * Both strategies use the same AST normalizer, so naming differences alone
 * never cause a false negative.
 */

import { walkAST, getLine, getEndLine, getColumn, getFunctionName, isFunctionNode, nodeLength } from '../../utils/ast-utils.js';
import { getRule } from '../../rules/registry.js';
import { registerDefaultRules } from '../../rules/defaults.js';
import { normalizeNode, normalizeStatements } from './normalizer.js';

export const name = 'duplication';

// ── Statement list extraction ──────────────────────────────────────────────

/**
 * Collect all non-trivial statement arrays from a file's AST.
 * Includes the Program body and every BlockStatement body.
 * Skips blocks with fewer than `minStatements` statements.
 */
function collectStatementLists(ast, filePath, minStatements) {
  const lists = [];

  // Program top-level
  if (ast.program?.body?.length >= minStatements) {
    lists.push({ stmts: ast.program.body, filePath });
  }

  walkAST(ast, {
    BlockStatement(path) {
      const { body } = path.node;
      if (body.length >= minStatements) {
        lists.push({ stmts: body, filePath });
      }
    },
  });

  return lists;
}

// ── Window hash index ──────────────────────────────────────────────────────

/**
 * Generate all sliding windows of exactly `windowSize` statements.
 * Returns an array of window descriptors.
 */
function generateWindows(stmts, filePath, windowSize) {
  const windows = [];
  for (let start = 0; start <= stmts.length - windowSize; start++) {
    const slice = stmts.slice(start, start + windowSize);
    const startLine = getLine(slice[0]);
    const endLine   = getEndLine(slice[slice.length - 1]);
    if (!startLine || !endLine) continue;

    windows.push({
      filePath,
      stmtIndex: start,
      startLine,
      endLine,
      hash: normalizeStatements(slice),
    });
  }
  return windows;
}

/**
 * Find all windows whose normalized hash matches at least one other window
 * in a different location, then merge adjacent consecutive matches into the
 * largest continuous duplicate region.
 *
 * Returns an array of merged duplicate pairs:
 *   { fileA, startLineA, endLineA, fileB, startLineB, endLineB, lineCount }
 */
function findAndMergeDuplicateWindows(allWindows, minLines) {
  // 1. Build hash → windows index
  const hashIndex = new Map();
  for (const w of allWindows) {
    if (!hashIndex.has(w.hash)) hashIndex.set(w.hash, []);
    hashIndex.get(w.hash).push(w);
  }

  // 2. Build quick-lookup: "filePath:stmtIndex" → window
  const windowMap = new Map();
  for (const w of allWindows) {
    windowMap.set(`${w.filePath}:${w.stmtIndex}`, w);
  }

  // 3. Collect all matching pairs (a.location ≠ b.location)
  const pairMap = new Map(); // "fileA:idxA|fileB:idxB" → {a, b}
  for (const [, windows] of hashIndex) {
    if (windows.length < 2) continue;
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i];
        const b = windows[j];
        // Skip exact same location (same file, same start line)
        if (a.filePath === b.filePath && a.stmtIndex === b.stmtIndex) continue;
        const key = `${a.filePath}:${a.stmtIndex}|${b.filePath}:${b.stmtIndex}`;
        pairMap.set(key, { a, b });
      }
    }
  }

  // 4. Find the start of each chain (a pair that is NOT preceded by another match)
  const visitedKeys = new Set();
  const merged = [];

  for (const [key, { a, b }] of pairMap) {
    if (visitedKeys.has(key)) continue;

    // Is there a match one step back? If so, this pair is in the middle of a chain.
    const prevKey = `${a.filePath}:${a.stmtIndex - 1}|${b.filePath}:${b.stmtIndex - 1}`;
    if (pairMap.has(prevKey)) continue; // not the chain start

    // This is the start of a chain — extend forward
    let curA = a;
    let curB = b;
    visitedKeys.add(key);

    while (true) {
      const nextKey = `${curA.filePath}:${curA.stmtIndex + 1}|${curB.filePath}:${curB.stmtIndex + 1}`;
      const nextPair = pairMap.get(nextKey);
      if (!nextPair) break;
      visitedKeys.add(nextKey);
      curA = nextPair.a;
      curB = nextPair.b;
    }

    // The duplicate region spans from the first window's start to the last window's end
    const startLineA = a.startLine;
    const endLineA   = curA.endLine;
    const startLineB = b.startLine;
    const endLineB   = curB.endLine;
    const lineCount  = Math.max(endLineA - startLineA + 1, endLineB - startLineB + 1);

    if (lineCount < minLines) continue;

    merged.push({
      fileA: a.filePath, startLineA, endLineA,
      fileB: b.filePath, startLineB, endLineB,
      lineCount,
    });
  }

  return merged;
}

// ── Function-level duplicate detection ────────────────────────────────────

/**
 * Hash the normalized body of every function.
 * Functions with identical structure (regardless of naming) are duplicates.
 */
function findFunctionDuplicates(fileResults, minLines) {
  const bodyIndex = new Map(); // normalizedHash → [{filePath, name, startLine, endLine, lines}]

  for (const fileResult of fileResults) {
    if (!fileResult.ast) continue;

    walkAST(fileResult.ast, {
      FunctionDeclaration(path) { _indexFn(path, fileResult.path, bodyIndex, minLines); },
      FunctionExpression(path)  { _indexFn(path, fileResult.path, bodyIndex, minLines); },
      ArrowFunctionExpression(path) { _indexFn(path, fileResult.path, bodyIndex, minLines); },
      ObjectMethod(path)  { _indexFn(path, fileResult.path, bodyIndex, minLines); },
      ClassMethod(path)   { _indexFn(path, fileResult.path, bodyIndex, minLines); },
    });
  }

  const duplicates = [];
  for (const [, locs] of bodyIndex) {
    if (locs.length >= 2) duplicates.push(locs);
  }
  return duplicates;
}

function _indexFn(path, filePath, bodyIndex, minLines) {
  const lines = nodeLength(path.node);
  if (lines < minLines) return;

  // Hash only the body, not the function signature (name/params may differ)
  const hash = normalizeNode(path.node.body ?? path.node);
  if (!bodyIndex.has(hash)) bodyIndex.set(hash, []);

  const name = getFunctionName(path.node, path.parent);
  bodyIndex.get(hash).push({
    filePath,
    name,
    startLine: getLine(path.node),
    endLine: getEndLine(path.node),
    lines,
  });
}

// ── Duplication percentage ─────────────────────────────────────────────────

/**
 * Calculate what fraction of total lines in a project are part of a duplicate.
 * This is a rough estimate: we mark all lines covered by any duplicate region.
 */
function computeDuplicationPercentage(allDuplicateRegions, fileResults) {
  const totalLines = fileResults.reduce((s, f) => s + (f.lines ?? 0), 0);
  if (totalLines === 0) return 0;

  // Count unique lines involved in duplicates per file
  const coveredLines = new Map(); // filePath → Set<lineNumber>
  for (const { fileA, startLineA, endLineA, fileB, startLineB, endLineB } of allDuplicateRegions) {
    _markLines(coveredLines, fileA, startLineA, endLineA);
    _markLines(coveredLines, fileB, startLineB, endLineB);
  }

  let duplicatedLines = 0;
  for (const [, lineSet] of coveredLines) {
    duplicatedLines += lineSet.size;
  }

  return Math.min(100, Math.round((duplicatedLines / totalLines) * 100));
}

function _markLines(map, filePath, start, end) {
  if (!map.has(filePath)) map.set(filePath, new Set());
  const set = map.get(filePath);
  for (let l = start; l <= end; l++) set.add(l);
}

// ── Finding factories ──────────────────────────────────────────────────────

function windowDuplicateFinding(fileResult, region, severity) {
  const { fileA, startLineA, endLineA, fileB, startLineB, endLineB, lineCount } = region;
  const isSameFile = fileA === fileB;

  const otherLocation = isSameFile
    ? `same file, line ${startLineB}`
    : `${fileB.replace(process.cwd() + '/', '')}:${startLineB}`;

  return {
    ruleId: 'duplication/block',
    severity,
    filePath: fileA,
    line: startLineA,
    column: 0,
    message: `Duplicate code block (${lineCount} lines) also found at ${otherLocation}`,
    why: 'Duplicated code means bugs must be fixed in multiple places and logic drift is inevitable. It is a maintenance liability.',
    suggestion: 'Extract the shared logic into a named function or module, then call it from both locations.',
    metadata: {
      duplicate: {
        filePath: fileB,
        startLine: startLineB,
        endLine: endLineB,
      },
      lineCount,
    },
  };
}

function functionDuplicateFinding(fileResult, loc, otherLocs, severity) {
  const others = otherLocs
    .map(l => `"${l.name}" at ${l.filePath.replace(process.cwd() + '/', '')}:${l.startLine}`)
    .join(', ');

  return {
    ruleId: 'duplication/block',
    severity,
    filePath: loc.filePath,
    line: loc.startLine,
    column: 0,
    message: `Function "${loc.name}" (${loc.lines} lines) is structurally identical to: ${others}`,
    why: 'Duplicate functions diverge over time — one gets bugfixes, the other does not.',
    suggestion: `Merge these functions into one and import it where needed. Even if they differ slightly, consider parameterising the difference.`,
    metadata: {
      duplicateFunctions: otherLocs.map(l => ({ filePath: l.filePath, name: l.name, startLine: l.startLine })),
    },
  };
}

// ── Analyzer entry point ───────────────────────────────────────────────────

export async function analyze(fileResults, config) {
  registerDefaultRules();
  const findings = [];

  const rule = getRule('duplication/block');
  if (rule?.enabled === false) return findings;

  const severity      = rule?.severity ?? 'medium';
  const minLines      = config?.thresholds?.duplicationMinLines      ?? rule?.defaultOptions?.minLines      ?? 6;
  const minStatements = config?.thresholds?.duplicationMinStatements ?? 4;

  // ── 1. Statement-sequence detection ───────────────────────────────────
  const allWindows = [];
  for (const fileResult of fileResults) {
    if (!fileResult.ast || fileResult.error) continue;
    const lists = collectStatementLists(fileResult.ast, fileResult.path, minStatements);
    for (const { stmts, filePath } of lists) {
      allWindows.push(...generateWindows(stmts, filePath, minStatements));
    }
  }

  const windowDuplicates = findAndMergeDuplicateWindows(allWindows, minLines);

  // Track which (fileA, startLineA) pairs we've already reported to avoid
  // reporting both directions of the same pair.
  const reportedPairs = new Set();

  for (const region of windowDuplicates) {
    const fwdKey = `${region.fileA}:${region.startLineA}|${region.fileB}:${region.startLineB}`;
    const revKey = `${region.fileB}:${region.startLineB}|${region.fileA}:${region.startLineA}`;
    if (reportedPairs.has(fwdKey) || reportedPairs.has(revKey)) continue;
    reportedPairs.add(fwdKey);
    reportedPairs.add(revKey);

    const fileResult = fileResults.find(f => f.path === region.fileA);
    if (fileResult) findings.push(windowDuplicateFinding(fileResult, region, severity));
  }

  // ── 2. Function-level detection ────────────────────────────────────────
  const fnDuplicateGroups = findFunctionDuplicates(fileResults, minLines);

  for (const group of fnDuplicateGroups) {
    // Emit one finding per occurrence, pointing to all others in the group
    for (let i = 0; i < group.length; i++) {
      const loc = group[i];
      const otherLocs = group.filter((_, j) => j !== i);
      const fileResult = fileResults.find(f => f.path === loc.filePath);
      if (!fileResult) continue;

      // Avoid duplicate reports: only report from the first occurrence
      // (the others will reference back via the finding's metadata)
      if (i === 0) {
        findings.push(functionDuplicateFinding(fileResult, loc, otherLocs, severity));
      }
    }
  }

  // ── 3. Attach aggregate metrics ───────────────────────────────────────
  const allRegions = [
    ...windowDuplicates,
    ...fnDuplicateGroups.flatMap(g =>
      g.map((loc, i) => i === 0 ? null : {
        fileA: g[0].filePath, startLineA: g[0].startLine, endLineA: g[0].endLine,
        fileB: loc.filePath,  startLineB: loc.startLine,  endLineB: loc.endLine,
      })
    ).filter(Boolean),
  ];

  const dupPercent = computeDuplicationPercentage(allRegions, fileResults);

  for (const fileResult of fileResults) {
    if (!fileResult.error) {
      fileResult.metrics.duplicationPercent = dupPercent;
    }
  }

  return findings;
}
