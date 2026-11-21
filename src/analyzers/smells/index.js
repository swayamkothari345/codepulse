/**
 * Code Smell Analyzer
 *
 * Detects:
 *   • Large files (too many lines)
 *   • Magic numbers (unexplained numeric literals)
 *   • Empty catch blocks
 *   • Unused variables (scope-aware via Babel's binding analysis)
 */

import { walkAST, getLine, getColumn, countLines } from '../../utils/ast-utils.js';
import { getRule } from '../../rules/registry.js';
import { registerDefaultRules } from '../../rules/defaults.js';

export const name = 'smells';

// ── Large File ─────────────────────────────────────────────────────────────

function checkLargeFile(fileResult, threshold, severity) {
  if (fileResult.lines <= threshold) return [];
  return [{
    ruleId: 'smell/large-file',
    severity,
    filePath: fileResult.path,
    line: 1,
    column: 0,
    message: `File has ${fileResult.lines} lines (threshold: ${threshold})`,
    why: 'Large files usually violate the single-responsibility principle — they are harder to navigate, review, and test.',
    suggestion: 'Split this file into focused modules. Group related exports into their own files.',
  }];
}

// ── Magic Numbers ──────────────────────────────────────────────────────────

/**
 * Contexts in which a numeric literal is NOT a magic number:
 *   • Right-hand side of a const/let/var declaration (it's being named)
 *   • Default parameter value
 *   • Array length checks (n.length === 0 / 1 are acceptable)
 *   • Exponent in Math.pow / ** operator (small integers are conventional)
 */
function isMagicNumberContext(path) {
  const { parent } = path;
  if (!parent) return true;

  switch (parent.type) {
    // const TIMEOUT = 5000; — this names the number
    case 'VariableDeclarator':
      return false;

    // function f(x = 0) — conventional default
    case 'AssignmentPattern':
      return false;

    // { key: 42 } — object values flagged; object keys are always string-like
    case 'ObjectProperty':
      return parent.key === path.node; // skip if it's the key, flag if value

    // Array elements ARE flagged — [1, 2, 3] likely magic
    // Switch cases: case 42: — flag these
    default:
      return true;
  }
}

function checkMagicNumbers(fileResult, ignoreSet, severity) {
  const findings = [];

  walkAST(fileResult.ast, {
    NumericLiteral(path) {
      const value = path.node.value;
      if (ignoreSet.has(value)) return;

      if (!isMagicNumberContext(path)) return;

      // Additional allowances: very simple indices and exponents
      // Skip if inside a unary minus (the actual value is negative — handled by parent)
      if (path.parent?.type === 'UnaryExpression' && path.parent.operator === '-') return;

      findings.push({
        ruleId: 'smell/magic-numbers',
        severity,
        filePath: fileResult.path,
        line: getLine(path.node),
        column: getColumn(path.node),
        message: `Magic number ${value} — give it a named constant`,
        why: 'Unnamed literals scatter meaning across the codebase. When the value needs to change, you must find every occurrence.',
        suggestion: `Extract to a named constant: \`const VALUE = ${value};\``,
      });
    },
  });

  return findings;
}

// ── Empty Catch ────────────────────────────────────────────────────────────

function checkEmptyCatch(fileResult, severity) {
  const findings = [];

  walkAST(fileResult.ast, {
    CatchClause(path) {
      const { body } = path.node;

      // body.body is the array of statements; empty means no handling at all
      if (!body.body || body.body.length === 0) {
        findings.push({
          ruleId: 'smell/empty-catch',
          severity,
          filePath: fileResult.path,
          line: getLine(path.node),
          column: getColumn(path.node),
          message: 'Empty catch block silently swallows errors',
          why: 'An empty catch makes it impossible to know an error occurred. Silent failures are notoriously hard to debug.',
          suggestion: 'At minimum log the error: `catch (err) { console.error(err); }`. If intentional, add a comment explaining why.',
        });
      }
    },
  });

  return findings;
}

// ── Unused Variables ───────────────────────────────────────────────────────

/**
 * Uses Babel traverse's scope analysis to find declared-but-unreferenced bindings.
 *
 * We only report on `let` / `const` / `var` VariableDeclarator nodes whose
 * declared name is a plain Identifier (destructuring is excluded — it's too
 * easy to get false positives there). Names matching the ignore pattern
 * (default: /^_/) are skipped.
 */
function checkUnusedVars(fileResult, ignorePattern, severity) {
  const findings = [];
  const re = new RegExp(ignorePattern);

  walkAST(fileResult.ast, {
    VariableDeclaration(path) {
      for (const declarator of path.node.declarations) {
        // Skip destructuring patterns
        if (declarator.id.type !== 'Identifier') continue;

        const varName = declarator.id.name;

        // Respect the ignore-prefix convention
        if (re.test(varName)) continue;

        const binding = path.scope.getBinding(varName);
        if (!binding) continue;

        // references: read usages. constantViolations: write-only reassignments.
        // A variable with 0 references and 0 violations is never read.
        if (binding.references === 0 && binding.constantViolations.length === 0) {
          findings.push({
            ruleId: 'smell/unused-vars',
            severity,
            filePath: fileResult.path,
            line: getLine(declarator.id),
            column: getColumn(declarator.id),
            message: `Variable "${varName}" is declared but never used`,
            why: 'Unused variables clutter the code, may indicate incomplete refactoring, and confuse readers who try to understand their purpose.',
            suggestion: `Remove "${varName}", or prefix with "_" if it must remain (e.g. for destructuring).`,
          });
        }
      }
    },
  });

  return findings;
}

// ── Analyzer entry point ───────────────────────────────────────────────────

export async function analyze(fileResults, config) {
  registerDefaultRules();
  const findings = [];

  const largeFileRule    = getRule('smell/large-file');
  const magicNumRule     = getRule('smell/magic-numbers');
  const emptyCatchRule   = getRule('smell/empty-catch');
  const unusedVarsRule   = getRule('smell/unused-vars');

  const largeFileThreshold = config?.thresholds?.fileLength ?? largeFileRule?.defaultOptions?.threshold ?? 500;
  const magicIgnore        = new Set(config?.thresholds?.magicNumberIgnore ?? magicNumRule?.defaultOptions?.ignore ?? [0, 1, -1, 2, 100]);
  const unusedVarsPattern  = config?.thresholds?.unusedVarsIgnore ?? unusedVarsRule?.defaultOptions?.ignorePattern ?? '^_';

  for (const fileResult of fileResults) {
    if (!fileResult.ast || fileResult.error) continue;

    if (largeFileRule?.enabled !== false) {
      findings.push(...checkLargeFile(fileResult, largeFileThreshold, largeFileRule.severity));
    }

    if (magicNumRule?.enabled !== false) {
      findings.push(...checkMagicNumbers(fileResult, magicIgnore, magicNumRule.severity));
    }

    if (emptyCatchRule?.enabled !== false) {
      findings.push(...checkEmptyCatch(fileResult, emptyCatchRule.severity));
    }

    if (unusedVarsRule?.enabled !== false) {
      findings.push(...checkUnusedVars(fileResult, unusedVarsPattern, unusedVarsRule.severity));
    }

    // Attach file-level metrics for the scoring engine
    fileResult.metrics.lines = fileResult.lines;
    fileResult.metrics.smellCount = findings.filter(f => f.filePath === fileResult.path).length;
  }

  return findings;
}
