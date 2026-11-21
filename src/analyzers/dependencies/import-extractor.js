/**
 * Import Extractor
 *
 * Collects every local import/require from a file's AST.
 * Handles:
 *   • ES module static imports:  import foo from './foo'
 *   • ES module dynamic imports: import('./foo')
 *   • CommonJS require:          require('./foo')
 *   • require.resolve:           require.resolve('./foo')
 *
 * Only LOCAL specifiers (starting with '.') are returned.
 * Node built-ins and npm packages are intentionally ignored since they
 * don't form part of the project's internal dependency graph.
 */

import { walkAST, getLine } from '../../utils/ast-utils.js';

/**
 * @typedef {object} RawImport
 * @property {string}  source  — the raw specifier as written in source (e.g. './utils')
 * @property {string}  kind    — 'static' | 'dynamic' | 'require'
 * @property {number}  line    — source line number
 */

/**
 * Extract all local imports from a file's AST.
 * @param {object} ast      — Babel File node
 * @param {string} filePath — absolute path of the containing file (unused here, kept for symmetry)
 * @returns {RawImport[]}
 */
export function extractImports(ast, _filePath) {
  if (!ast) return [];
  const imports = [];

  walkAST(ast, {
    // import foo from './foo'
    // import { a, b } from '../lib'
    // import * as ns from './ns'
    ImportDeclaration(path) {
      const source = path.node.source?.value;
      if (source && isLocal(source)) {
        imports.push({ source, kind: 'static', line: getLine(path.node) });
      }
    },

    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const firstArg = args?.[0];
      if (!firstArg || firstArg.type !== 'StringLiteral') return;

      // require('./foo')
      if (callee.type === 'Identifier' && callee.name === 'require') {
        if (isLocal(firstArg.value)) {
          imports.push({ source: firstArg.value, kind: 'require', line: getLine(path.node) });
        }
        return;
      }

      // require.resolve('./foo')
      if (
        callee.type === 'MemberExpression' &&
        callee.object?.name === 'require' &&
        callee.property?.name === 'resolve'
      ) {
        if (isLocal(firstArg.value)) {
          imports.push({ source: firstArg.value, kind: 'require', line: getLine(path.node) });
        }
        return;
      }

      // import('./foo')  — callee.type === 'Import'
      if (callee.type === 'Import') {
        if (isLocal(firstArg.value)) {
          imports.push({ source: firstArg.value, kind: 'dynamic', line: getLine(path.node) });
        }
      }
    },
  });

  return imports;
}

function isLocal(source) {
  return source.startsWith('./') || source.startsWith('../');
}
