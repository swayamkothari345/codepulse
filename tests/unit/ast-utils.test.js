import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  parseFile,
  walkAST,
  countLines,
  getLine,
  getEndLine,
  getColumn,
  nodeLength,
  getFunctionName,
  isFunctionNode,
} from '../../src/utils/ast-utils.js';

let tmpDir;

function write(name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepulse-ast-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseFile', () => {
  it('parses a simple ES module', () => {
    const p = write('esm.js', 'export const x = 1;\nexport const y = 2;');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
    expect(ast).toBeDefined();
    expect(ast.type).toBe('File');
  });

  it('parses a CommonJS module', () => {
    const p = write('cjs.js', 'const path = require("path");\nmodule.exports = { path };');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
    expect(ast).toBeDefined();
  });

  it('parses JSX syntax', () => {
    const p = write('comp.jsx', 'export default function App() { return <div className="app">Hello</div>; }');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
    expect(ast).toBeDefined();
  });

  it('parses async/await', () => {
    const p = write('async.js', 'async function fetch() { const r = await getData(); return r; }');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
    expect(ast).toBeDefined();
  });

  it('parses arrow functions', () => {
    const p = write('arrow.js', 'const double = (x) => x * 2;\nconst square = x => x ** 2;');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
    expect(ast).toBeDefined();
  });

  it('parses optional chaining', () => {
    const p = write('optional.js', 'const x = obj?.foo?.bar ?? "default";');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
  });

  it('parses destructuring', () => {
    const p = write('destructure.js', 'const { a, b, ...rest } = obj;\nconst [first, ...others] = arr;');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
  });

  it('parses template literals', () => {
    const p = write('template.js', 'const msg = `Hello ${name}, you have ${count} messages`;');
    const { ast, error } = parseFile(p);
    expect(error).toBeNull();
  });

  it('returns code alongside AST', () => {
    const p = write('withcode.js', 'const x = 42;');
    const { code } = parseFile(p);
    expect(code).toBe('const x = 42;');
  });

  it('returns sourceType', () => {
    const p = write('srctype.mjs', 'export const x = 1;');
    const { sourceType } = parseFile(p);
    expect(['module', 'script']).toContain(sourceType);
  });

  it('returns parseErrors array (may be empty for valid code)', () => {
    const p = write('clean.js', 'const x = 1;');
    const { parseErrors } = parseFile(p);
    expect(Array.isArray(parseErrors)).toBe(true);
  });

  it('handles completely unreadable file gracefully', () => {
    const { ast, error, code } = parseFile('/nonexistent/absolute/path.js');
    expect(error).toBeDefined();
    expect(error.message).toMatch(/Cannot read file/);
    expect(ast).toBeNull();
    expect(code).toBeNull();
  });

  it('handles syntactically broken file without crashing', () => {
    // Write code that is truly unrecoverable
    const p = write('broken.js', '<<<>>>{{{{]]]] function ))) ===');
    const result = parseFile(p);
    // Either hard error or partial AST with soft errors — must not throw
    expect(result).toHaveProperty('ast');
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('parseErrors');
  });
});

describe('walkAST', () => {
  it('visits function declarations', () => {
    const p = write('walk.js', 'function greet(name) { return "hi " + name; }');
    const { ast } = parseFile(p);
    const visited = [];
    walkAST(ast, {
      FunctionDeclaration(nodePath) {
        visited.push(nodePath.node.id?.name);
      },
    });
    expect(visited).toContain('greet');
  });

  it('visits all identifiers', () => {
    const p = write('identifiers.js', 'const foo = bar + baz;');
    const { ast } = parseFile(p);
    const names = [];
    walkAST(ast, {
      Identifier(nodePath) {
        names.push(nodePath.node.name);
      },
    });
    expect(names).toContain('foo');
    expect(names).toContain('bar');
    expect(names).toContain('baz');
  });
});

describe('countLines', () => {
  it('returns 1 for single-line code', () => {
    expect(countLines('const x = 1;')).toBe(1);
  });

  it('counts newlines correctly', () => {
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('handles empty string', () => {
    expect(countLines('')).toBe(1);
  });

  it('returns 0 for null/undefined', () => {
    expect(countLines(null)).toBe(0);
    expect(countLines(undefined)).toBe(0);
  });
});

describe('getLine / getEndLine / getColumn', () => {
  it('returns 0 for null node', () => {
    expect(getLine(null)).toBe(0);
    expect(getEndLine(null)).toBe(0);
    expect(getColumn(null)).toBe(0);
  });

  it('returns line from loc', () => {
    const node = { loc: { start: { line: 7, column: 3 }, end: { line: 12, column: 1 } } };
    expect(getLine(node)).toBe(7);
    expect(getEndLine(node)).toBe(12);
    expect(getColumn(node)).toBe(3);
  });
});

describe('nodeLength', () => {
  it('returns 0 for null node', () => {
    expect(nodeLength(null)).toBe(0);
  });

  it('calculates span correctly', () => {
    const node = { loc: { start: { line: 5 }, end: { line: 10 } } };
    expect(nodeLength(node)).toBe(6);
  });

  it('returns 1 for single-line node', () => {
    const node = { loc: { start: { line: 3 }, end: { line: 3 } } };
    expect(nodeLength(node)).toBe(1);
  });
});

describe('isFunctionNode', () => {
  it('recognises FunctionDeclaration', () => {
    expect(isFunctionNode({ type: 'FunctionDeclaration' })).toBe(true);
  });

  it('recognises FunctionExpression', () => {
    expect(isFunctionNode({ type: 'FunctionExpression' })).toBe(true);
  });

  it('recognises ArrowFunctionExpression', () => {
    expect(isFunctionNode({ type: 'ArrowFunctionExpression' })).toBe(true);
  });

  it('recognises ClassMethod', () => {
    expect(isFunctionNode({ type: 'ClassMethod' })).toBe(true);
  });

  it('rejects non-function nodes', () => {
    expect(isFunctionNode({ type: 'IfStatement' })).toBe(false);
    expect(isFunctionNode({ type: 'Identifier' })).toBe(false);
  });
});

describe('getFunctionName', () => {
  it('returns name from function declaration id', () => {
    const node = { id: { name: 'myFunc' } };
    expect(getFunctionName(node, null)).toBe('myFunc');
  });

  it('returns name from variable declarator parent', () => {
    const node = { id: null };
    const parent = { type: 'VariableDeclarator', id: { name: 'arrowFn' } };
    expect(getFunctionName(node, parent)).toBe('arrowFn');
  });

  it('returns <anonymous> for unnamed function expressions', () => {
    const node = { id: null };
    expect(getFunctionName(node, null)).toBe('<anonymous>');
  });
});
