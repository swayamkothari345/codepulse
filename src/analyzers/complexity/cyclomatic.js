/**
 * Cyclomatic complexity — counts the number of linearly independent paths
 * through a function.
 *
 * Base = 1. Each of the following adds 1:
 *   if / else-if / for / for-in / for-of / while / do-while / catch
 *   switch case (non-default)
 *   ternary (?:)
 *   logical operators (&& / || / ??)
 *   logical assignments (&&= / ||= / ??=)
 *
 * Nested function bodies are NOT counted — each function is measured
 * independently.
 */

import { isFunctionNode } from '../../utils/ast-utils.js';

const SKIP_KEYS = new Set([
  'type', 'loc', 'start', 'end', 'extra',
  'innerComments', 'leadingComments', 'trailingComments',
]);

/**
 * Walk every node reachable from `node`, calling `onNode` for each,
 * but never descending into nested function definitions.
 */
function walkSkipFunctions(node, onNode) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) walkSkipFunctions(item, onNode);
    return;
  }

  if (!node.type) return;

  // Never descend into a nested function's body
  if (isFunctionNode(node)) return;

  onNode(node);

  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    walkSkipFunctions(node[key], onNode);
  }
}

/**
 * Compute the cyclomatic complexity of a single function AST node.
 * @param {object} funcNode — Babel FunctionDeclaration / FunctionExpression /
 *                            ArrowFunctionExpression / ClassMethod / ObjectMethod
 * @returns {number}
 */
export function computeCyclomatic(funcNode) {
  let complexity = 1; // base path

  // funcNode.body is the BlockStatement (or an expression for arrow fns).
  // We walk the body, not the params, so parameter defaults don't add branches.
  const body = funcNode.body ?? funcNode;

  walkSkipFunctions(body, (node) => {
    switch (node.type) {
      case 'IfStatement':
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'CatchClause':
      case 'ConditionalExpression':
        complexity++;
        break;

      case 'SwitchCase':
        // Count only non-default cases
        if (node.test !== null) complexity++;
        break;

      case 'LogicalExpression':
        // && || ?? each represent a branch
        complexity++;
        break;

      case 'AssignmentExpression':
        if (node.operator === '&&=' || node.operator === '||=' || node.operator === '??=') {
          complexity++;
        }
        break;

      default:
        break;
    }
  });

  return complexity;
}
