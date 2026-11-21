import { registerRule } from './registry.js';

let _registered = false;

/**
 * Register all built-in rules. Safe to call multiple times (idempotent).
 */
export function registerDefaultRules() {
  if (_registered) return;
  _registered = true;

  // ── Complexity ───────────────────────────────────────────────────────────

  registerRule({
    id: 'complexity/cyclomatic',
    name: 'Cyclomatic Complexity',
    description: 'Functions with high cyclomatic complexity are difficult to test and maintain. Each branch (if, &&, ||, ??, for, while, catch, ternary) adds 1.',
    category: 'complexity',
    severity: 'high',
    defaultOptions: { threshold: 10 },
  });

  registerRule({
    id: 'complexity/cognitive',
    name: 'Cognitive Complexity',
    description: 'Measures how hard a function is to understand, penalising nesting more heavily than raw branch count.',
    category: 'complexity',
    severity: 'high',
    defaultOptions: { threshold: 15 },
  });

  registerRule({
    id: 'complexity/nesting-depth',
    name: 'Deep Nesting',
    description: 'Deeply nested control structures (if/for/while/try) are hard to read and test.',
    category: 'complexity',
    severity: 'medium',
    defaultOptions: { threshold: 4 },
  });

  registerRule({
    id: 'complexity/parameters',
    name: 'Too Many Parameters',
    description: 'Functions with many parameters are harder to call correctly and test exhaustively.',
    category: 'complexity',
    severity: 'medium',
    defaultOptions: { threshold: 5 },
  });

  registerRule({
    id: 'complexity/function-length',
    name: 'Function Too Long',
    description: 'Very long functions often do too many things and should be decomposed.',
    category: 'complexity',
    severity: 'medium',
    defaultOptions: { threshold: 50 },
  });

  // ── Code Smells ───────────────────────────────────────────────────────────

  registerRule({
    id: 'smell/large-file',
    name: 'Large File',
    description: 'Files exceeding the line threshold often violate the single-responsibility principle.',
    category: 'smell',
    severity: 'medium',
    defaultOptions: { threshold: 500 },
  });

  registerRule({
    id: 'smell/magic-numbers',
    name: 'Magic Numbers',
    description: 'Numeric literals embedded directly in logic are hard to understand and change safely.',
    category: 'smell',
    severity: 'low',
    defaultOptions: { ignore: [0, 1, -1, 2, 100] },
  });

  registerRule({
    id: 'smell/empty-catch',
    name: 'Empty Catch Block',
    description: 'Catch blocks with no handling silently swallow errors, making debugging very hard.',
    category: 'smell',
    severity: 'high',
    defaultOptions: {},
  });

  registerRule({
    id: 'smell/unused-vars',
    name: 'Unused Variables',
    description: 'Variables declared but never referenced clutter the codebase and may indicate bugs.',
    category: 'smell',
    severity: 'medium',
    defaultOptions: { ignorePattern: '^_' },
  });

  // ── Dependencies ──────────────────────────────────────────────────────────

  registerRule({
    id: 'dependency/circular',
    name: 'Circular Dependency',
    description: 'Circular imports can cause module initialisation failures and tightly couple unrelated files.',
    category: 'dependency',
    severity: 'high',
    defaultOptions: {},
  });

  registerRule({
    id: 'dependency/too-many-imports',
    name: 'Too Many Dependencies',
    description: 'Files that import an excessive number of other files may have too many responsibilities.',
    category: 'dependency',
    severity: 'low',
    defaultOptions: { threshold: 15 },
  });

  // ── Duplication ───────────────────────────────────────────────────────────

  registerRule({
    id: 'duplication/block',
    name: 'Duplicate Code Block',
    description: 'Identical or structurally similar code blocks found in multiple locations should be extracted into shared utilities.',
    category: 'duplication',
    severity: 'medium',
    defaultOptions: { minLines: 6, similarityThreshold: 0.9 },
  });

  // ── Hygiene ───────────────────────────────────────────────────────────────

  registerRule({
    id: 'hygiene/console-log',
    name: 'Console Log Statement',
    description: 'console.log / console.debug left in production code is usually unintentional.',
    category: 'hygiene',
    severity: 'low',
    defaultOptions: { allow: ['console.error', 'console.warn'] },
  });
}

/**
 * Reset registration state (for use in tests only).
 */
export function _resetDefaultRules() {
  _registered = false;
}
