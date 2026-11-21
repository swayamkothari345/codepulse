import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { readFileSafe } from './file-utils.js';

// @babel/traverse ships as CJS; handle both interop styles.
const traverse = typeof _traverse === 'function'
  ? _traverse
  : (_traverse.default ?? _traverse);

/**
 * Babel parser plugins enabled for all files.
 * Covers everything in modern JS + JSX without TypeScript.
 */
const PARSE_PLUGINS = [
  'jsx',
  'asyncGenerators',
  'bigInt',
  'classProperties',
  'classPrivateProperties',
  'classPrivateMethods',
  'classStaticBlock',
  'dynamicImport',
  'exportDefaultFrom',
  'nullishCoalescingOperator',
  'numericSeparator',
  'objectRestSpread',
  'optionalCatchBinding',
  'optionalChaining',
  'privateIn',
  'topLevelAwait',
  'logicalAssignment',
  'decorators-legacy',
];

/**
 * Parse a JS/JSX/MJS/CJS file into a Babel AST.
 *
 * Returns:
 *   { ast, code, sourceType, parseErrors, error }
 *
 * - ast:         Babel File node, or null if unrecoverable.
 * - code:        Raw source string, or null if file is unreadable.
 * - sourceType:  'module' | 'script'
 * - parseErrors: Array of soft parse errors recovered by Babel (may be empty).
 * - error:       Hard Error — file unreadable or completely unparseable.
 */
export function parseFile(filePath) {
  const code = readFileSafe(filePath);
  if (code === null) {
    return { ast: null, code: null, sourceType: null, parseErrors: [], error: new Error(`Cannot read file: ${filePath}`) };
  }

  // Try sourceType=module first (covers ESM and most modern files),
  // then fall back to script (covers CJS and legacy files).
  for (const sourceType of ['module', 'script']) {
    try {
      const ast = parse(code, {
        sourceType,
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        allowSuperOutsideMethod: true,
        errorRecovery: true,          // return a partial AST on syntax errors
        plugins: PARSE_PLUGINS,
      });

      return {
        ast,
        code,
        sourceType,
        parseErrors: ast.errors ?? [],
        error: null,
      };
    } catch {
      // Try next sourceType
    }
  }

  return {
    ast: null,
    code,
    sourceType: null,
    parseErrors: [],
    error: new Error(`Parse failed: ${filePath}`),
  };
}

/**
 * Walk an AST with a Babel visitor object.
 * Thin wrapper so callers never import @babel/traverse directly.
 */
export function walkAST(ast, visitor) {
  traverse(ast, visitor);
}

/**
 * Count total lines in a source string.
 */
export function countLines(code) {
  if (code == null) return 0;   // null or undefined → no file
  if (code === '') return 1;    // empty file still has one (empty) line
  return code.split('\n').length;
}

/**
 * Get the 1-based start line of an AST node. Returns 0 if unknown.
 */
export function getLine(node) {
  return node?.loc?.start?.line ?? 0;
}

/**
 * Get the 1-based end line of an AST node. Returns 0 if unknown.
 */
export function getEndLine(node) {
  return node?.loc?.end?.line ?? 0;
}

/**
 * Get the 0-based start column of an AST node.
 */
export function getColumn(node) {
  return node?.loc?.start?.column ?? 0;
}

/**
 * Calculate the number of lines spanned by an AST node.
 */
export function nodeLength(node) {
  const start = getLine(node);
  const end = getEndLine(node);
  if (start === 0 && end === 0) return 0;
  return end - start + 1;
}

/**
 * Extract the name of a function node (FunctionDeclaration, FunctionExpression,
 * ArrowFunctionExpression, or ObjectMethod/ClassMethod).
 * Returns '<anonymous>' if no name can be determined.
 */
export function getFunctionName(node, parentNode) {
  // Named function declaration: function foo() {}
  if (node.id?.name) return node.id.name;

  // Variable assignment: const foo = () => {}
  if (parentNode?.type === 'VariableDeclarator' && parentNode.id?.name) {
    return parentNode.id.name;
  }

  // Object/class method: { foo() {} }
  if (parentNode?.type === 'ObjectProperty' || parentNode?.type === 'ClassProperty') {
    if (parentNode.key?.name) return parentNode.key.name;
  }

  // Assignment expression: foo = function() {}
  if (parentNode?.type === 'AssignmentExpression' && parentNode.left?.name) {
    return parentNode.left.name;
  }

  return '<anonymous>';
}

/**
 * Returns true if the node is any kind of function node.
 */
export function isFunctionNode(node) {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod'
  );
}
