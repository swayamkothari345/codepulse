/**
 * AST Normalizer for duplication detection.
 *
 * Converts an AST node (or array of statement nodes) into a canonical
 * string that is structurally identical for code that differs only in:
 *   • Variable / function names   → 'V'
 *   • String literal values       → 'S'
 *   • Numeric literal values      → 'N'
 *   • Boolean literal values      → 'B'
 *   • Template literal contents   → 'TPL'
 *
 * Structural features preserved:
 *   • Node types (IfStatement, ForStatement, ReturnStatement, …)
 *   • Operator types (+, *, &&, ===, …)
 *   • Parameter counts
 *   • Nesting depth / block structure
 *   • Array and object shapes
 */

/**
 * Normalize an array of statement nodes to a comparable string.
 * @param {object[]} stmts — Babel AST statement nodes
 * @returns {string}
 */
export function normalizeStatements(stmts) {
  return stmts.map(normalizeNode).join(';');
}

/**
 * Normalize a single AST node.
 * @param {object|null} node
 * @returns {string}
 */
export function normalizeNode(node) {
  if (node === null || node === undefined) return 'nil';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return '[' + node.map(normalizeNode).join(',') + ']';
  if (!node.type) return '?';

  switch (node.type) {
    // ── Literals (erase values, keep type) ──────────────────────────────
    case 'Identifier':
      return 'V';

    case 'StringLiteral':
    case 'DirectiveLiteral':
      return 'S';

    case 'NumericLiteral':
      return 'N';

    case 'BigIntLiteral':
      return 'BIG';

    case 'BooleanLiteral':
      return 'B';

    case 'NullLiteral':
      return 'null';

    case 'RegExpLiteral':
      return 'RE';

    case 'TemplateLiteral':
      // Normalize quasis and expressions
      return `TPL(${node.expressions.map(normalizeNode).join(',')})`;

    case 'TaggedTemplateExpression':
      return `Tagged(${normalizeNode(node.tag)},${normalizeNode(node.quasi)})`;

    // ── Expressions ───────────────────────────────────────────────────────
    case 'BinaryExpression':
      return `Bin(${normalizeNode(node.left)},${node.operator},${normalizeNode(node.right)})`;

    case 'LogicalExpression':
      return `Log(${normalizeNode(node.left)},${node.operator},${normalizeNode(node.right)})`;

    case 'AssignmentExpression':
      return `Assign(${node.operator},${normalizeNode(node.left)},${normalizeNode(node.right)})`;

    case 'UnaryExpression':
      return `Unary(${node.operator},${normalizeNode(node.argument)})`;

    case 'UpdateExpression':
      return `Update(${node.operator},${node.prefix},${normalizeNode(node.argument)})`;

    case 'MemberExpression':
      // Keep the structure but erase names
      return `Mem(${normalizeNode(node.object)},V)`;

    case 'OptionalMemberExpression':
      return `OptMem(${normalizeNode(node.object)},V)`;

    case 'CallExpression':
      return `Call(${normalizeNode(node.callee)},${node.arguments.map(normalizeNode).join(',')})`;

    case 'OptionalCallExpression':
      return `OptCall(${normalizeNode(node.callee)},${node.arguments.map(normalizeNode).join(',')})`;

    case 'NewExpression':
      return `New(${normalizeNode(node.callee)},${node.arguments.map(normalizeNode).join(',')})`;

    case 'ConditionalExpression':
      return `Cond(${normalizeNode(node.test)},${normalizeNode(node.consequent)},${normalizeNode(node.alternate)})`;

    case 'AwaitExpression':
      return `Await(${normalizeNode(node.argument)})`;

    case 'YieldExpression':
      return `Yield(${node.delegate},${normalizeNode(node.argument)})`;

    case 'SequenceExpression':
      return `Seq(${node.expressions.map(normalizeNode).join(',')})`;

    case 'SpreadElement':
    case 'RestElement':
      return `Spread(${normalizeNode(node.argument)})`;

    case 'ArrayExpression':
      return `Arr(${node.elements.map(e => e ? normalizeNode(e) : 'hole').join(',')})`;

    case 'ObjectExpression':
      return `Obj(${node.properties.map(normalizeNode).join(',')})`;

    case 'ObjectProperty':
    case 'Property':
      return `Prop(V,${normalizeNode(node.value)},${node.computed})`;

    case 'ObjectMethod':
      return `ObjMeth(V,${node.params.length},${normalizeNode(node.body)})`;

    case 'AssignmentPattern':
      return `Default(${normalizeNode(node.left)},${normalizeNode(node.right)})`;

    case 'ArrayPattern':
      return `ArrPat(${node.elements.map(e => e ? normalizeNode(e) : 'hole').join(',')})`;

    case 'ObjectPattern':
      return `ObjPat(${node.properties.map(normalizeNode).join(',')})`;

    case 'ChainExpression':
      return `Chain(${normalizeNode(node.expression)})`;

    // ── Statements ────────────────────────────────────────────────────────
    case 'ExpressionStatement':
      return `Expr(${normalizeNode(node.expression)})`;

    case 'BlockStatement':
      return `{${node.body.map(normalizeNode).join(';')}}`;

    case 'ReturnStatement':
      return `Ret(${normalizeNode(node.argument)})`;

    case 'ThrowStatement':
      return `Throw(${normalizeNode(node.argument)})`;

    case 'VariableDeclaration':
      return `Var(${node.kind},${node.declarations.map(normalizeNode).join(',')})`;

    case 'VariableDeclarator':
      return `Decl(${normalizeNode(node.id)},${normalizeNode(node.init)})`;

    case 'IfStatement':
      return `If(${normalizeNode(node.test)},${normalizeNode(node.consequent)},${normalizeNode(node.alternate)})`;

    case 'ForStatement':
      return `For(${normalizeNode(node.init)},${normalizeNode(node.test)},${normalizeNode(node.update)},${normalizeNode(node.body)})`;

    case 'ForInStatement':
      return `ForIn(${normalizeNode(node.left)},${normalizeNode(node.right)},${normalizeNode(node.body)})`;

    case 'ForOfStatement':
      return `ForOf(${node.await},${normalizeNode(node.left)},${normalizeNode(node.right)},${normalizeNode(node.body)})`;

    case 'WhileStatement':
      return `While(${normalizeNode(node.test)},${normalizeNode(node.body)})`;

    case 'DoWhileStatement':
      return `DoWhile(${normalizeNode(node.test)},${normalizeNode(node.body)})`;

    case 'SwitchStatement':
      return `Switch(${normalizeNode(node.discriminant)},${node.cases.map(normalizeNode).join(',')})`;

    case 'SwitchCase':
      return `Case(${normalizeNode(node.test)},${node.consequent.map(normalizeNode).join(';')})`;

    case 'TryStatement':
      return `Try(${normalizeNode(node.block)},${normalizeNode(node.handler)},${normalizeNode(node.finalizer)})`;

    case 'CatchClause':
      return `Catch(${normalizeNode(node.param)},${normalizeNode(node.body)})`;

    case 'BreakStatement':
      return 'Break';

    case 'ContinueStatement':
      return 'Continue';

    case 'LabeledStatement':
      return `Label(${normalizeNode(node.body)})`;

    case 'WithStatement':
      return `With(${normalizeNode(node.object)},${normalizeNode(node.body)})`;

    // ── Functions ──────────────────────────────────────────────────────────
    case 'FunctionDeclaration':
    case 'FunctionExpression':
      return `Fn(${node.async},${node.generator},${node.params.length},${normalizeNode(node.body)})`;

    case 'ArrowFunctionExpression':
      return `Arrow(${node.async},${node.params.length},${normalizeNode(node.body)})`;

    case 'ClassDeclaration':
    case 'ClassExpression':
      return `Class(${node.superClass ? 'ext' : ''},${node.body.body.map(normalizeNode).join(';')})`;

    case 'ClassMethod':
      return `CMeth(${node.kind},V,${node.static},${node.async},${node.params.length},${normalizeNode(node.body)})`;

    // ── Imports / Exports ──────────────────────────────────────────────────
    case 'ImportDeclaration':
      return `Import(${node.specifiers.length})`;

    case 'ExportNamedDeclaration':
      return `Export(${normalizeNode(node.declaration)})`;

    case 'ExportDefaultDeclaration':
      return `ExportDefault(${normalizeNode(node.declaration)})`;

    // ── Misc ──────────────────────────────────────────────────────────────
    case 'EmptyStatement':
      return 'Empty';

    default:
      // Fall back to just the type name so unknown nodes don't crash
      return node.type;
  }
}
