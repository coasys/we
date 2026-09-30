/**
 * The expression language's syntax tree.
 *
 * ## Why a grammar, and why this small
 *
 * The value operators — `$eq`, `$and`, `$concat`, `$count`, `$plural` and the rest — were an
 * expression language being written one operator at a time, as JSON. Each addition widened what an
 * author had to learn, what the validator had to know and what the LLM context had to carry, and
 * there was no natural stopping point: `$setLocal`'s `by` is documented as "the only arithmetic the
 * schema layer has", `$filter`'s `limit` exists because there is "no arithmetic and no slice", and
 * `$plural` exists because there is no interpolation.
 *
 * This is the same semantics with a closed grammar. Literals, references, comparison, boolean and
 * arithmetic operators, string interpolation, a ternary, and five comprehension macros. **Nothing
 * else will be added to the grammar.** A new capability at the value layer is a function in the
 * registry (`functions.ts`) — code, catalogued and documented like a component — which is where the
 * data/code line says it belongs.
 *
 * ## What it deliberately cannot do
 *
 * - **Define functions or recurse.** The macros bind one variable over a finite list; evaluation is
 *   total and bounded by the data.
 * - **Call methods on values.** `a.f(b)` is sugar for the library call `f(a, b)`; a value's own
 *   methods are never reachable. This is the discipline `walkPath` learned the hard way — it used to
 *   invoke any function it walked past.
 * - **Reach a prototype.** `__proto__`, `constructor` and `prototype` are refused by the parser.
 *
 * Every node carries a `span` so a checker can point at a column, which is the feedback an LLM
 * authoring loop needs and a nested-object error path could never give.
 */

/** `[start, end)` offsets into the source string. */
export type Span = readonly [number, number];

export type LiteralValue = string | number | boolean | null;

export interface LiteralExpr {
  kind: 'literal';
  value: LiteralValue;
  span: Span;
}

/** A backtick string: literal runs interleaved with `${…}` expressions. */
export interface TemplateExpr {
  kind: 'template';
  parts: (string | Expr)[];
  span: Span;
}

/** A root name — a context variable, a store, `local`, a macro variable, or `me`. */
export interface IdentExpr {
  kind: 'ident';
  name: string;
  span: Span;
}

export interface MemberExpr {
  kind: 'member';
  object: Expr;
  property: string;
  span: Span;
}

export interface IndexExpr {
  kind: 'index';
  object: Expr;
  index: Expr;
  span: Span;
}

export type UnaryOp = '!' | '-';

export interface UnaryExpr {
  kind: 'unary';
  op: UnaryOp;
  operand: Expr;
  span: Span;
}

export type BinaryOp = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'in' | '+' | '-' | '*' | '/' | '%';

export interface BinaryExpr {
  kind: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export type LogicalOp = '&&' | '||' | '??';

/** Short-circuiting, which is why it is not a `binary`. */
export interface LogicalExpr {
  kind: 'logical';
  op: LogicalOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface ConditionalExpr {
  kind: 'conditional';
  test: Expr;
  consequent: Expr;
  alternate: Expr;
  span: Span;
}

/**
 * A library call. `receiver` is set when written in method form — `items.count()` — and is the
 * first argument semantically; it is kept apart so the printer can put it back where the author
 * wrote it.
 */
export interface CallExpr {
  kind: 'call';
  callee: string;
  receiver?: Expr;
  args: Expr[];
  span: Span;
}

export type MacroName = 'filter' | 'map' | 'find' | 'exists' | 'all';

export const MACRO_NAMES: readonly MacroName[] = ['filter', 'map', 'find', 'exists', 'all'];

/**
 * A comprehension: `items.filter(x, x.done)`. The one place the grammar binds a name, and the
 * whole of its expressive power beyond a function call.
 */
export interface MacroExpr {
  kind: 'macro';
  name: MacroName;
  receiver: Expr;
  variable: string;
  body: Expr;
  span: Span;
}

export interface ListExpr {
  kind: 'list';
  elements: Expr[];
  span: Span;
}

export interface ObjectEntry {
  key: string;
  value: Expr;
}

/** `{ role: 'admin', name: { contains: local.search } }` — the where-object shape, as a literal. */
export interface ObjectExpr {
  kind: 'object';
  entries: ObjectEntry[];
  span: Span;
}

export type Expr =
  | LiteralExpr
  | TemplateExpr
  | IdentExpr
  | MemberExpr
  | IndexExpr
  | UnaryExpr
  | BinaryExpr
  | LogicalExpr
  | ConditionalExpr
  | CallExpr
  | MacroExpr
  | ListExpr
  | ObjectExpr;

/** Property names no expression may read, whatever the data. */
export const DENIED_PROPERTIES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The names a reference can start from that are neither a store nor a macro variable.
 *
 * `local` is the namespace `$localState` and `$queries` declare into. `me` and `currentDataset` are
 * the host's neutral identity and dataset bindings. `event` is the callback argument inside a
 * handler, `arg` its older spelling, and `result` what a settled `$action` resolved to. `index` and
 * `prev` are what `$each` binds beside the item; `surface` is the responsive boundary. `item` is
 * `$each`'s default name.
 */
export const WELL_KNOWN_ROOTS: ReadonlySet<string> = new Set([
  'local',
  'me',
  'currentDataset',
  'event',
  'arg',
  'result',
  'index',
  'prev',
  'surface',
  'item',
]);

/** Roots that only exist once a callback has fired, so an expression naming one is call-time. */
export const CALL_TIME_ROOTS: ReadonlySet<string> = new Set(['event', 'arg', 'result']);

/** Walk every node, parents before children. */
export function walkExpr(expr: Expr, visit: (node: Expr) => void): void {
  visit(expr);
  switch (expr.kind) {
    case 'template':
      for (const part of expr.parts) if (typeof part !== 'string') walkExpr(part, visit);
      return;
    case 'member':
      walkExpr(expr.object, visit);
      return;
    case 'index':
      walkExpr(expr.object, visit);
      walkExpr(expr.index, visit);
      return;
    case 'unary':
      walkExpr(expr.operand, visit);
      return;
    case 'binary':
    case 'logical':
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      return;
    case 'conditional':
      walkExpr(expr.test, visit);
      walkExpr(expr.consequent, visit);
      walkExpr(expr.alternate, visit);
      return;
    case 'call':
      if (expr.receiver) walkExpr(expr.receiver, visit);
      for (const arg of expr.args) walkExpr(arg, visit);
      return;
    case 'macro':
      walkExpr(expr.receiver, visit);
      walkExpr(expr.body, visit);
      return;
    case 'list':
      for (const element of expr.elements) walkExpr(element, visit);
      return;
    case 'object':
      for (const entry of expr.entries) walkExpr(entry.value, visit);
      return;
    default:
      return;
  }
}

/**
 * Every root name the expression reads, excluding macro variables bound inside it.
 *
 * What the capability walker, the call-time test and the checker all start from. Macro variables
 * are subtracted per body rather than globally, so `items.map(x, x.name)` reports `items` and not
 * `x` — and an outer `x` read outside the body is still reported.
 */
export function referencedRoots(expr: Expr): Set<string> {
  const roots = new Set<string>();
  const collect = (node: Expr, bound: ReadonlySet<string>): void => {
    switch (node.kind) {
      case 'ident':
        if (!bound.has(node.name)) roots.add(node.name);
        return;
      case 'macro': {
        collect(node.receiver, bound);
        collect(node.body, new Set([...bound, node.variable]));
        return;
      }
      case 'template':
        for (const part of node.parts) if (typeof part !== 'string') collect(part, bound);
        return;
      case 'member':
        collect(node.object, bound);
        return;
      case 'index':
        collect(node.object, bound);
        collect(node.index, bound);
        return;
      case 'unary':
        collect(node.operand, bound);
        return;
      case 'binary':
      case 'logical':
        collect(node.left, bound);
        collect(node.right, bound);
        return;
      case 'conditional':
        collect(node.test, bound);
        collect(node.consequent, bound);
        collect(node.alternate, bound);
        return;
      case 'call':
        if (node.receiver) collect(node.receiver, bound);
        for (const arg of node.args) collect(arg, bound);
        return;
      case 'list':
        for (const element of node.elements) collect(element, bound);
        return;
      case 'object':
        for (const entry of node.entries) collect(entry.value, bound);
        return;
      default:
        return;
    }
  };
  collect(expr, new Set());
  return roots;
}

/**
 * Dotted paths read from a root — `spaceStore.members`, `local.search`, `item.author.did`.
 *
 * Only the static prefix: `a.b[c].d` reports `a.b`, since `c` is not known until evaluation. What
 * `templateSurface`'s walker needs to classify a store reference, and what the checker needs to
 * name a member.
 */
export function referencedPaths(expr: Expr): { root: string; path: string[]; span: Span }[] {
  const paths: { root: string; path: string[]; span: Span }[] = [];
  const seen = new Set<Expr>();

  const chain = (node: Expr): { root: string; path: string[] } | null => {
    if (node.kind === 'ident') return { root: node.name, path: [] };
    if (node.kind === 'member') {
      const inner = chain(node.object);
      return inner ? { root: inner.root, path: [...inner.path, node.property] } : null;
    }
    return null;
  };

  const collect = (node: Expr, bound: ReadonlySet<string>): void => {
    if (seen.has(node)) return;
    if (node.kind === 'member' || node.kind === 'ident') {
      const found = chain(node);
      if (found && !bound.has(found.root)) {
        paths.push({ ...found, span: node.span });
        // The inner members of this chain are the same reference, not further ones.
        let inner: Expr = node;
        while (inner.kind === 'member') {
          seen.add(inner);
          inner = inner.object;
        }
        seen.add(inner);
        return;
      }
      if (node.kind === 'member') collect(node.object, bound);
      return;
    }
    if (node.kind === 'macro') {
      collect(node.receiver, bound);
      collect(node.body, new Set([...bound, node.variable]));
      return;
    }
    walkChildren(node, (child) => collect(child, bound));
  };

  collect(expr, new Set());
  return paths;
}

function walkChildren(node: Expr, visit: (child: Expr) => void): void {
  switch (node.kind) {
    case 'template':
      for (const part of node.parts) if (typeof part !== 'string') visit(part);
      return;
    case 'member':
      visit(node.object);
      return;
    case 'index':
      visit(node.object);
      visit(node.index);
      return;
    case 'unary':
      visit(node.operand);
      return;
    case 'binary':
    case 'logical':
      visit(node.left);
      visit(node.right);
      return;
    case 'conditional':
      visit(node.test);
      visit(node.consequent);
      visit(node.alternate);
      return;
    case 'call':
      if (node.receiver) visit(node.receiver);
      for (const arg of node.args) visit(arg);
      return;
    case 'macro':
      visit(node.receiver);
      visit(node.body);
      return;
    case 'list':
      for (const element of node.elements) visit(element);
      return;
    case 'object':
      for (const entry of node.entries) visit(entry.value);
      return;
    default:
      return;
  }
}
