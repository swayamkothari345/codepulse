/**
 * Complexity Analyzer
 *
 * Measures per-function:
 *   • Cyclomatic complexity
 *   • Cognitive complexity
 *   • Maximum nesting depth
 *   • Parameter count
 *   • Function length (lines)
 *
 * Emits findings for any metric that exceeds its configured threshold.
 */

import { walkAST, getLine, getColumn, getFunctionName, isFunctionNode, nodeLength } from '../../utils/ast-utils.js';
import { getRule } from '../../rules/registry.js';
import { registerDefaultRules } from '../../rules/defaults.js';
import { computeCyclomatic } from './cyclomatic.js';
import { computeCognitive } from './cognitive.js';

export const name = 'complexity';

// ── Helpers ────────────────────────────────────────────────────────────────

const SKIP_KEYS = new Set([
  'type', 'loc', 'start', 'end', 'extra',
  'innerComments', 'leadingComments', 'trailingComments',
]);

const NESTING_NODES = new Set([
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
  'WhileStatement', 'DoWhileStatement', 'SwitchStatement',
  'TryStatement', 'CatchClause',
]);

/**
 * Collect every function node in the file, along with its parent node.
 * We use Babel traverse so we get reliable parent references.
 */
function collectFunctions(ast) {
  const functions = [];
  walkAST(ast, {
    FunctionDeclaration(path) {
      functions.push({ node: path.node, parent: path.parent });
    },
    FunctionExpression(path) {
      functions.push({ node: path.node, parent: path.parent });
    },
    ArrowFunctionExpression(path) {
      functions.push({ node: path.node, parent: path.parent });
    },
    ObjectMethod(path) {
      functions.push({ node: path.node, parent: path.parent });
    },
    ClassMethod(path) {
      functions.push({ node: path.node, parent: path.parent });
    },
  });
  return functions;
}

/**
 * Compute the maximum nesting depth inside a function body,
 * without descending into nested function definitions.
 */
function computeMaxNesting(funcNode) {
  let maxDepth = 0;

  function walk(node, depth) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth); return; }
    if (!node.type) return;
    // Skip nested functions
    if (node !== funcNode && isFunctionNode(node)) return;

    const nextDepth = NESTING_NODES.has(node.type) ? depth + 1 : depth;
    if (nextDepth > maxDepth) maxDepth = nextDepth;

    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      walk(node[key], nextDepth);
    }
  }

  const body = funcNode.body ?? funcNode;
  walk(body, 0);
  return maxDepth;
}

/** Return the number of declared parameters, counting rest params as 1. */
function countParams(funcNode) {
  return funcNode.params?.length ?? 0;
}

// ── Finding factories ──────────────────────────────────────────────────────

function cyclomaticFinding(fileResult, funcName, line, col, value, threshold, severity) {
  return {
    ruleId: 'complexity/cyclomatic',
    severity,
    filePath: fileResult.path,
    line,
    column: col,
    message: `Function "${funcName}" has cyclomatic complexity ${value} (threshold: ${threshold})`,
    why: 'High cyclomatic complexity means more independent execution paths — each path is a potential test case you have to cover.',
    suggestion: `Decompose "${funcName}" into smaller focused functions, each doing one thing. Extract complex conditionals into named predicates.`,
  };
}

function cognitiveFinding(fileResult, funcName, line, col, value, threshold, severity) {
  return {
    ruleId: 'complexity/cognitive',
    severity,
    filePath: fileResult.path,
    line,
    column: col,
    message: `Function "${funcName}" has cognitive complexity ${value} (threshold: ${threshold})`,
    why: 'Cognitive complexity captures how hard code is to understand — deeply nested and highly branched functions are significantly harder to reason about.',
    suggestion: `Flatten "${funcName}" by extracting nested blocks, inverting guard conditions, or splitting into separate helper functions.`,
  };
}

function nestingFinding(fileResult, funcName, line, col, value, threshold, severity) {
  return {
    ruleId: 'complexity/nesting-depth',
    severity,
    filePath: fileResult.path,
    line,
    column: col,
    message: `Function "${funcName}" has nesting depth ${value} (threshold: ${threshold})`,
    why: 'Deep nesting forces readers to track multiple context levels simultaneously, dramatically increasing cognitive load.',
    suggestion: 'Extract inner blocks into named functions, use early-return guard clauses, or flatten with async/await patterns.',
  };
}

function paramsFinding(fileResult, funcName, line, col, value, threshold, severity) {
  return {
    ruleId: 'complexity/parameters',
    severity,
    filePath: fileResult.path,
    line,
    column: col,
    message: `Function "${funcName}" has ${value} parameters (threshold: ${threshold})`,
    why: 'Functions with many parameters are harder to call correctly, harder to remember, and often indicate the function does too many things.',
    suggestion: 'Group related parameters into an options object, or split the function into smaller functions that each accept fewer inputs.',
  };
}

function lengthFinding(fileResult, funcName, line, col, value, threshold, severity) {
  return {
    ruleId: 'complexity/function-length',
    severity,
    filePath: fileResult.path,
    line,
    column: col,
    message: `Function "${funcName}" is ${value} lines long (threshold: ${threshold})`,
    why: 'Very long functions are hard to read in full, hard to test exhaustively, and usually indicate multiple responsibilities.',
    suggestion: `Split "${funcName}" into smaller helpers. A good function should fit on one screen without scrolling.`,
  };
}

// ── Analyzer entry point ───────────────────────────────────────────────────

export async function analyze(fileResults, config) {
  registerDefaultRules();
  const findings = [];

  // Pull thresholds from the registry (honours user config overrides)
  const cyclomaticRule = getRule('complexity/cyclomatic');
  const cognitiveRule  = getRule('complexity/cognitive');
  const nestingRule    = getRule('complexity/nesting-depth');
  const paramsRule     = getRule('complexity/parameters');
  const lengthRule     = getRule('complexity/function-length');

  const cyclomaticThreshold = config?.thresholds?.cyclomaticComplexity ?? cyclomaticRule?.defaultOptions?.threshold ?? 10;
  const cognitiveThreshold  = config?.thresholds?.cognitiveComplexity  ?? cognitiveRule?.defaultOptions?.threshold  ?? 15;
  const nestingThreshold    = config?.thresholds?.nestingDepth         ?? nestingRule?.defaultOptions?.threshold    ?? 4;
  const paramsThreshold     = config?.thresholds?.maxParams            ?? paramsRule?.defaultOptions?.threshold     ?? 5;
  const lengthThreshold     = config?.thresholds?.functionLength       ?? lengthRule?.defaultOptions?.threshold     ?? 50;

  for (const fileResult of fileResults) {
    if (!fileResult.ast || fileResult.error) continue;

    const fns = collectFunctions(fileResult.ast);
    const fnMetrics = [];

    for (const { node, parent } of fns) {
      const funcName = getFunctionName(node, parent);
      const line     = getLine(node);
      const col      = getColumn(node);
      const length   = nodeLength(node);
      const params   = countParams(node);
      const cyclo    = computeCyclomatic(node);
      const cogni    = computeCognitive(node);
      const nesting  = computeMaxNesting(node);

      // Store per-function metrics on the fileResult for the scoring engine
      fnMetrics.push({ name: funcName, line, cyclomatic: cyclo, cognitive: cogni, nesting, params, length });

      // Emit findings that breach thresholds
      if (cyclomaticRule?.enabled !== false && cyclo > cyclomaticThreshold) {
        findings.push(cyclomaticFinding(fileResult, funcName, line, col, cyclo, cyclomaticThreshold, cyclomaticRule.severity));
      }

      if (cognitiveRule?.enabled !== false && cogni > cognitiveThreshold) {
        findings.push(cognitiveFinding(fileResult, funcName, line, col, cogni, cognitiveThreshold, cognitiveRule.severity));
      }

      if (nestingRule?.enabled !== false && nesting > nestingThreshold) {
        findings.push(nestingFinding(fileResult, funcName, line, col, nesting, nestingThreshold, nestingRule.severity));
      }

      if (paramsRule?.enabled !== false && params > paramsThreshold) {
        findings.push(paramsFinding(fileResult, funcName, line, col, params, paramsThreshold, paramsRule.severity));
      }

      if (lengthRule?.enabled !== false && length > lengthThreshold) {
        findings.push(lengthFinding(fileResult, funcName, line, col, length, lengthThreshold, lengthRule.severity));
      }
    }

    // Attach aggregated metrics to the file result
    fileResult.metrics.functions = fnMetrics;
    fileResult.metrics.functionCount = fnMetrics.length;
    if (fnMetrics.length > 0) {
      fileResult.metrics.maxCyclomatic = Math.max(...fnMetrics.map(f => f.cyclomatic));
      fileResult.metrics.avgCyclomatic = +(fnMetrics.reduce((s, f) => s + f.cyclomatic, 0) / fnMetrics.length).toFixed(2);
      fileResult.metrics.maxNesting    = Math.max(...fnMetrics.map(f => f.nesting));
    }
  }

  return findings;
}
