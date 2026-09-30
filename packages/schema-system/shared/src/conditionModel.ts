/**
 * Condition model — a small, lossless editing grammar over the expressions a visual editor can
 * show as rows.
 *
 * `parseCondition` reads an expression token into a flat comparison/group structure the editor
 * renders as rows; `serializeCondition` prints it back. Parsing is deliberately strict: anything the
 * grammar can't represent exactly (arithmetic, a comprehension, a call other than `count` and the
 * form-state readers, deeper nesting than {@link MAX_CONDITION_DEPTH}) returns `null`, and the
 * editor falls back to the raw expression editor for that condition. That keeps the round trip
 * honest — the builder never silently rewrites an expression it didn't fully understand.
 *
 * Built on the expression AST rather than on the token objects it replaced: the rows are the same,
 * the spelling underneath is `{ $: "local.open && item.n > 0" }`.
 */
import type { Expr, ExpressionSource } from './expressions';
import { isExpressionToken, parseExpression, printExpression } from './expressions';

// ── Public types ────────────────────────────────────────────────────────────

export type ComparisonOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'nin' | 'truthy' | 'falsy';

/** Operators that take no right-hand operand. */
export const UNARY_OPERATORS: ComparisonOperator[] = ['truthy', 'falsy'];

/** Validation-state readers, which take a field name rather than a value. */
export type FormStateToken = 'formValid' | 'valid' | 'touched' | 'error';

export type ConditionOperand =
  /** A store member — `spaceStore.members`, `modules.notes.open`. */
  | { kind: 'store'; path: string }
  /** A `$localState`/`$queries` field — the path after `local.`. */
  | { kind: 'local'; path: string }
  /** A name bound by `$each` or a host binding — `item.name`, `me.did`. */
  | { kind: 'context'; path: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  /** A literal list, only valid as the right-hand side of `in`. */
  | { kind: 'list'; value: (string | number | boolean)[] }
  /** `count(…)` over a list-valued reference — "how many X are there". */
  | { kind: 'count'; items: ConditionOperand }
  /** `formValid()` / `valid('f')` / `touched('f')` / `error('f')`. */
  | { kind: 'formState'; token: FormStateToken; field: string };

export interface ConditionComparison {
  type: 'comparison';
  operator: ComparisonOperator;
  left: ConditionOperand;
  /** Absent for unary operators. */
  right?: ConditionOperand;
}

export interface ConditionGroup {
  type: 'group';
  operator: 'and' | 'or';
  children: ConditionExpr[];
}

export type ConditionExpr = ConditionComparison | ConditionGroup;

/**
 * How many levels of grouping the builder represents: a top-level group whose children
 * may themselves be groups, but no deeper. Real templates nest at most this far; beyond
 * it the row-based UI stops being clearer than the expression.
 */
export const MAX_CONDITION_DEPTH = 2;

const FORM_STATE_CALLS: Record<string, FormStateToken> = {
  formValid: 'formValid',
  valid: 'valid',
  touched: 'touched',
  error: 'error',
};

// ── Parsing ─────────────────────────────────────────────────────────────────

/** A dotted reference, or null for anything else. */
function chainOf(expr: Expr): string[] | null {
  if (expr.kind === 'ident') return [expr.name];
  if (expr.kind === 'member') {
    const inner = chainOf(expr.object);
    return inner ? [...inner, expr.property] : null;
  }
  return null;
}

function referenceOperand(expr: Expr): ConditionOperand | null {
  const chain = chainOf(expr);
  if (!chain) return null;
  const [root, ...rest] = chain;
  if (root === 'local') return rest.length ? { kind: 'local', path: rest.join('.') } : null;
  if (/Store$/.test(root) || root === 'modules') return rest.length ? { kind: 'store', path: chain.join('.') } : null;
  return { kind: 'context', path: chain.join('.') };
}

function parseOperand(expr: Expr): ConditionOperand | null {
  if (expr.kind === 'literal') return { kind: 'literal', value: expr.value };
  if (expr.kind === 'list') {
    const values: (string | number | boolean)[] = [];
    for (const element of expr.elements) {
      if (element.kind !== 'literal' || element.value === null) return null;
      values.push(element.value);
    }
    return { kind: 'list', value: values };
  }
  if (expr.kind === 'call') {
    const args = expr.receiver ? [expr.receiver, ...expr.args] : expr.args;
    if (expr.callee === 'count' && args.length === 1) {
      const items = parseOperand(args[0]);
      if (!items || items.kind === 'list' || items.kind === 'literal') return null;
      return { kind: 'count', items };
    }
    const token = FORM_STATE_CALLS[expr.callee];
    if (token === 'formValid' && args.length === 0) return { kind: 'formState', token, field: '$scope' };
    if (token && token !== 'formValid' && args.length === 1) {
      const [field] = args;
      if (field.kind === 'literal' && typeof field.value === 'string')
        return { kind: 'formState', token, field: field.value };
    }
    return null;
  }
  return referenceOperand(expr);
}

const BINARY_OPS: Record<string, ComparisonOperator> = { '==': 'eq', '!=': 'ne', '>': 'gt', '<': 'lt', in: 'in' };

function parseExpr(expr: Expr, depth: number): ConditionExpr | null {
  if (expr.kind === 'logical' && (expr.op === '&&' || expr.op === '||')) {
    if (depth + 1 > MAX_CONDITION_DEPTH) return null;
    const operator = expr.op === '&&' ? 'and' : 'or';
    // `a && b && c` parses left-nested; flatten a chain of the same connective into one group.
    const parts: Expr[] = [];
    const gather = (node: Expr): void => {
      if (node.kind === 'logical' && node.op === expr.op) {
        gather(node.left);
        gather(node.right);
      } else parts.push(node);
    };
    gather(expr);
    const children: ConditionExpr[] = [];
    for (const part of parts) {
      const parsed = parseExpr(part, depth + 1);
      if (!parsed) return null;
      children.push(parsed);
    }
    return { type: 'group', operator, children };
  }

  if (expr.kind === 'binary') {
    const operator = BINARY_OPS[expr.op];
    if (!operator) return null;
    const left = parseOperand(expr.left);
    const right = parseOperand(expr.right);
    if (!left || !right) return null;
    if (left.kind === 'list') return null;
    if (right.kind === 'list' && operator !== 'in') return null;
    return { type: 'comparison', operator, left, right };
  }

  if (expr.kind === 'unary' && expr.op === '!') {
    // `!(a in list)` is the "is not one of" row.
    if (expr.operand.kind === 'binary' && expr.operand.op === 'in') {
      const left = parseOperand(expr.operand.left);
      const right = parseOperand(expr.operand.right);
      if (left && right && left.kind !== 'list') return { type: 'comparison', operator: 'nin', left, right };
      return null;
    }
    const operand = parseOperand(expr.operand);
    if (!operand || operand.kind === 'list') return null;
    return { type: 'comparison', operator: 'falsy', left: operand };
  }

  // A bare reference used as a condition — `local.showComments`.
  const operand = parseOperand(expr);
  if (operand && operand.kind !== 'list' && operand.kind !== 'literal') {
    return { type: 'comparison', operator: 'truthy', left: operand };
  }
  return null;
}

function parseSource(token: unknown): Expr | null {
  if (!isExpressionToken(token)) return null;
  try {
    return parseExpression(token.$);
  } catch {
    return null;
  }
}

/**
 * Parse a condition token into the editing model.
 * Returns null when the expression is outside the grammar — callers should fall back to the raw editor.
 */
export function parseCondition(token: unknown): ConditionExpr | null {
  const expr = parseSource(token);
  return expr ? parseExpr(expr, 0) : null;
}

// ── Serializing ─────────────────────────────────────────────────────────────

function quote(value: string): string {
  return printExpression({ kind: 'literal', value, span: [0, 0] });
}

function operandSource(operand: ConditionOperand): string {
  switch (operand.kind) {
    case 'store':
    case 'context':
      return operand.path;
    case 'local':
      return `local.${operand.path}`;
    case 'literal':
      return operand.value === null
        ? 'null'
        : typeof operand.value === 'string'
          ? quote(operand.value)
          : String(operand.value);
    case 'list':
      return `[${operand.value.map((v) => (typeof v === 'string' ? quote(v) : String(v))).join(', ')}]`;
    case 'count':
      return `count(${operandSource(operand.items)})`;
    case 'formState':
      return operand.token === 'formValid' ? 'formValid()' : `${operand.token}(${quote(operand.field)})`;
  }
}

const OPERATOR_TEXT: Record<Exclude<ComparisonOperator, 'truthy' | 'falsy' | 'nin'>, string> = {
  eq: '==',
  ne: '!=',
  gt: '>',
  lt: '<',
  in: 'in',
};

function conditionSource(expr: ConditionExpr, nested = false): string {
  if (expr.type === 'group') {
    const joined = expr.children
      .map((child) => conditionSource(child, true))
      .join(expr.operator === 'and' ? ' && ' : ' || ');
    return nested ? `(${joined})` : joined;
  }
  if (expr.operator === 'truthy') return operandSource(expr.left);
  if (expr.operator === 'falsy') return `!${operandSource(expr.left)}`;
  const right: ConditionOperand = expr.right ?? { kind: 'literal', value: null };
  if (expr.operator === 'nin') return `!(${operandSource(expr.left)} in ${operandSource(right)})`;
  return `${operandSource(expr.left)} ${OPERATOR_TEXT[expr.operator]} ${operandSource(right)}`;
}

export function serializeCondition(expr: ConditionExpr): ExpressionSource {
  return { $: conditionSource(expr) };
}

// ── Values (as opposed to conditions) ───────────────────────────────────────

/**
 * A value position — a `children` entry, or a prop that resolves to a value rather than
 * a boolean. Parses to an operand so the editor can offer the same reference picker it
 * uses inside conditions; returns null for expressions it can't represent (arithmetic,
 * interpolation, a comprehension), which fall back to the raw editor.
 */
export function parseValue(token: unknown): ConditionOperand | null {
  if (typeof token === 'string') return { kind: 'literal', value: token };
  if (typeof token === 'number' || typeof token === 'boolean' || token === null)
    return { kind: 'literal', value: token };
  const expr = parseSource(token);
  return expr ? parseOperand(expr) : null;
}

/** A literal stays a literal; a reference becomes an expression token. */
export function serializeValue(operand: ConditionOperand): unknown {
  if (operand.kind === 'literal') return operand.value;
  if (operand.kind === 'list') return operand.value;
  return { $: operandSource(operand) };
}

/** A conditional value — the ternary `test ? a : b` with literal or reference branches. */
export interface ValueIf {
  condition: unknown;
  then: unknown;
  else?: unknown;
}

/**
 * Recognise `{ $: "cond ? a : b" }` used in a value position — including inside `children`,
 * where it renders one of two strings. The branches must be literals or references; a nested
 * ternary or arithmetic is the raw editor's.
 */
export function parseValueIf(token: unknown): ValueIf | null {
  const expr = parseSource(token);
  if (!expr || expr.kind !== 'conditional') return null;
  const branch = (node: Expr): unknown => {
    const operand = parseOperand(node);
    return operand ? serializeValue(operand) : undefined;
  };
  const then = branch(expr.consequent);
  if (then === undefined) return null;
  const otherwise =
    expr.alternate.kind === 'literal' && expr.alternate.value === null ? undefined : branch(expr.alternate);
  if (expr.alternate.kind !== 'literal' && otherwise === undefined) return null;
  const condition: ExpressionSource = { $: printExpression(expr.test) };
  return otherwise === undefined ? { condition, then } : { condition, then, else: otherwise };
}

function valueSource(value: unknown): string {
  if (isExpressionToken(value)) return `(${value.$})`;
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'null';
}

export function serializeValueIf(value: ValueIf): ExpressionSource {
  const test = isExpressionToken(value.condition) ? value.condition.$ : valueSource(value.condition);
  return { $: `${test} ? ${valueSource(value.then)} : ${valueSource(value.else ?? null)}` };
}

/**
 * The authoring shapes a node's `children` can take when it holds content rather than
 * child nodes. Drives which editor the inspector shows, and what converting between
 * them means.
 */
export type ContentShape = 'text' | 'value' | 'conditional' | 'custom';

export function classifyContent(children: unknown[] | undefined): ContentShape {
  if (!children || children.length === 0) return 'text';
  // Several entries concatenated in place have no single-control equivalent.
  if (children.length > 1) return 'custom';
  const [only] = children;
  if (typeof only === 'string') return 'text';
  if (parseValueIf(only)) return 'conditional';
  if (parseValue(only)) return 'value';
  return 'custom';
}

/**
 * The plain-text reading of a content token, used when converting to text. A conditional
 * collapses to its `then` branch — the branch that renders in the common case.
 */
export function contentAsText(token: unknown): string {
  if (typeof token === 'string') return token;
  const branch = parseValueIf(token);
  if (branch && typeof branch.then === 'string') return branch.then;
  return '';
}

// ── Editing helpers ─────────────────────────────────────────────────────────

export function isUnaryOperator(operator: ComparisonOperator): boolean {
  return UNARY_OPERATORS.includes(operator);
}

/** An empty comparison row, used when adding a condition to a node that has none. */
export function emptyComparison(): ConditionComparison {
  return { type: 'comparison', operator: 'truthy', left: { kind: 'literal', value: '' } };
}

/** True when a comparison is still a blank template row (no reference chosen yet). */
export function isBlankComparison(expr: ConditionExpr): boolean {
  return expr.type === 'comparison' && expr.left.kind === 'literal' && expr.left.value === '';
}
