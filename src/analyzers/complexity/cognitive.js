/**
 * Cognitive complexity — measures how hard a function is to read and understand.
 *
 * Rules (loosely following the SonarSource white paper):
 *   • Structural elements (if / loops / switch / catch) add (1 + nesting level).
 *   • else-if and else clauses add 1 flat (no nesting increment).
 *   • Each logical operator (&&, ||, ??) adds 1 flat.
 *   • Nesting level increases for: if-body, loop-body, switch-body, catch-body.
 *   • Nested function bodies are excluded — each function is measured independently.
 */

import { isFunctionNode } from '../../utils/ast-utils.js';

const SKIP_KEYS = new Set([
  'type', 'loc', 'start', 'end', 'extra',
  'innerComments', 'leadingComments', 'trailingComments',
]);

/**
 * Compute the cognitive complexity of a single function AST node.
 * @param {object} funcNode
 * @returns {number}
 */
export function computeCognitive(funcNode) {
  let score = 0;

  /**
   * Walk a node.
   * @param {object} node
   * @param {number} nesting — current nesting depth (0 = top of function)
   * @param {boolean} isElseIf — true when this IfStatement is in an else-if chain
   */
  function walk(node, nesting, isElseIf = false) {
    if (!node || typeof node !== 'object') return;
    if (!node.type) return;

    // Skip nested function definitions entirely
    if (isFunctionNode(node)) return;

    switch (node.type) {
      case 'IfStatement': {
        if (isElseIf) {
          score += 1; // else-if: flat increment, no nesting penalty
        } else {
          score += 1 + nesting; // top-level if or nested if
        }
        // Walk the condition at the same nesting (no structural increase there)
        walkGeneric(node.test, nesting);
        // Body of the if runs at nesting + 1
        walkBlock(node.consequent, nesting + 1);

        if (node.alternate) {
          if (node.alternate.type === 'IfStatement') {
            // else-if: pass isElseIf=true so it adds +1 flat
            walk(node.alternate, nesting, true);
          } else {
            // plain else: +1 flat, body at nesting + 1
            score += 1;
            walkBlock(node.alternate, nesting + 1);
          }
        }
        return;
      }

      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement': {
        score += 1 + nesting;
        walkLoopChildren(node, nesting + 1);
        return;
      }

      case 'SwitchStatement': {
        score += 1 + nesting;
        for (const c of node.cases) {
          walkBlock(c, nesting + 1);
        }
        return;
      }

      case 'CatchClause': {
        score += 1 + nesting;
        walkBlock(node.body, nesting + 1);
        return;
      }

      case 'LogicalExpression': {
        // Each && / || / ?? adds 1 flat
        score += 1;
        walk(node.left, nesting);
        walk(node.right, nesting);
        return;
      }

      case 'ConditionalExpression': {
        score += 1 + nesting;
        walk(node.test, nesting);
        walk(node.consequent, nesting + 1);
        walk(node.alternate, nesting + 1);
        return;
      }

      default:
        walkGeneric(node, nesting);
    }
  }

  /**
   * Walk all direct children of a node at the given nesting level.
   * Used for generic nodes where we just need to descend.
   */
  function walkGeneric(node, nesting) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) if (item?.type) walk(item, nesting);
      return;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item?.type) walk(item, nesting);
      } else if (child?.type) {
        walk(child, nesting);
      }
    }
  }

  /**
   * Walk a BlockStatement's statements, or a single statement/expression.
   */
  function walkBlock(node, nesting) {
    if (!node) return;
    if (node.type === 'BlockStatement') {
      for (const stmt of node.body) walk(stmt, nesting);
    } else {
      walk(node, nesting);
    }
  }

  /**
   * Walk the structural parts of a loop (init, test, update are not nesting-structural).
   */
  function walkLoopChildren(node, nesting) {
    // Walk the loop body at the increased nesting; walk other parts at base nesting
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = node[key];
      if (!child) continue;
      const isBody = key === 'body';
      if (Array.isArray(child)) {
        for (const item of child) if (item?.type) walk(item, isBody ? nesting : nesting - 1);
      } else if (child?.type) {
        walk(child, isBody ? nesting : nesting - 1);
      }
    }
  }

  // Start walking from the function body
  if (funcNode.body?.type === 'BlockStatement') {
    for (const stmt of funcNode.body.body) walk(stmt, 0);
  } else if (funcNode.body) {
    // Arrow function with expression body: const f = x => x * 2
    walk(funcNode.body, 0);
  }

  return score;
}
