/**
 * Condition model — a small, lossless editing grammar over the boolean operator tokens.
 *
 * `parseCondition` converts a condition token into a flat comparison/group structure the
 * visual editor can render as rows; `serializeCondition` converts it back. Parsing is
 * deliberately strict: anything the grammar can't represent exactly (`$count`, `$concat`,
 * `$formValid`, deeper nesting than {@link MAX_CONDITION_DEPTH}) returns `null`, and the
 * editor falls back to the raw JSON editor for that condition. That keeps the round-trip
 * honest — the builder never silently rewrites an expression it didn't fully understand.
 */

import { expressionSourceToOperator, isExpressionToken, operatorToExpr, printExpression } from './expressions';

// ── Public types ────────────────────────────────────────────────────────────

export type ComparisonOperator = 'eq' | 'ne' | 'gt' | 'lt' | 'in' | 'nin' | 'truthy' | 'falsy';

/** Operators that take no right-hand operand. */
export const UNARY_OPERATORS: ComparisonOperator[] = ['truthy', 'falsy'];

/** Validation-state readers, which take a field name rather than a value. */
export type FormStateToken = 'formValid' | 'valid' | 'touched' | 'error';

export type ConditionOperand =
  | { kind: 'store'; path: string }
  | { kind: 'local'; path: string }
  /** A context reference string — `$item.name`, `$me.did`. */
  | { kind: 'context'; path: string }
  | { kind: 'literal'; value: string | number | boolean | null }
  /** A literal list, only valid as the right-hand side of `in`. */
  | { kind: 'list'; value: (string | number | boolean)[] }
  /** `$count` over a list-valued reference — "how many X are there". */
  | { kind: 'count'; items: ConditionOperand }
  /** `$formValid` / `$valid` / `$touched` / `$error` over a field name. */
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
 * it the row-based UI stops being clearer than the JSON.
 */
export const MAX_CONDITION_DEPTH = 2;

const BINARY_TOKEN_OPS: Record<string, ComparisonOperator> = {
  $eq: 'eq',
  $ne: 'ne',
  $gt: 'gt',
  $lt: 'lt',
  $in: 'in',
};

const FORM_STATE_TOKENS: Record<string, FormStateToken> = {
  $formValid: 'formValid',
  $valid: 'valid',
  $touched: 'touched',
  $error: 'error',
};

const OPERATOR_TOKENS: Record<ComparisonOperator, string> = {
  eq: '$eq',
  ne: '$ne',
  gt: '$gt',
  lt: '$lt',
  in: '$in',
  nin: '$in', // wrapped in $not by serializeCondition
  truthy: '',
  falsy: '$not',
};

// ── Parsing ─────────────────────────────────────────────────────────────────

function parseOperand(value: unknown): ConditionOperand | null {
  if (value === null) return { kind: 'literal', value: null };

  if (typeof value === 'string') {
    // A `$`-prefixed string is a context reference; anything else is a plain literal.
    return value.startsWith('$') ? { kind: 'context', path: value } : { kind: 'literal', value };
  }
  if (typeof value === 'number' || typeof value === 'boolean') return { kind: 'literal', value };

  if (Array.isArray(value)) {
    const primitives = value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    return primitives ? { kind: 'list', value: value as (string | number | boolean)[] } : null;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length !== 1) return null;
    if (typeof obj.$store === 'string') return { kind: 'store', path: obj.$store };
    if (typeof obj.$local === 'string') return { kind: 'local', path: obj.$local };

    // `$count` over a list — the only wrapping operator the builder represents, because
    // "how many of these are there" is how most list conditions are actually written.
    if (obj.$count && typeof obj.$count === 'object' && !Array.isArray(obj.$count)) {
      const countKeys = Object.keys(obj.$count as object);
      if (countKeys.length !== 1 || countKeys[0] !== 'items') return null;
      const items = parseOperand((obj.$count as Record<string, unknown>).items);
      if (!items || items.kind === 'list' || items.kind === 'literal') return null;
      return { kind: 'count', items };
    }

    // Validation-state readers. `$formValid: '$scope'` is the idiomatic whole-form check;
    // the others name a single field.
    const [tokenKey] = keys;
    const formToken = FORM_STATE_TOKENS[tokenKey];
    if (formToken) {
      const field = obj[tokenKey];
      if (typeof field === 'string') return { kind: 'formState', token: formToken, field };
      if (formToken === 'formValid' && field === true) return { kind: 'formState', token: formToken, field: '$scope' };
      return null;
    }
  }
  return null;
}

function parseExpr(token: unknown, depth: number): ConditionExpr | null {
  if (typeof token === 'object' && token !== null && !Array.isArray(token)) {
    const obj = token as Record<string, unknown>;
    const keys = Object.keys(obj);

    if (keys.length === 1) {
      const [key] = keys;
      const value = obj[key];

      // Logical groups
      if ((key === '$and' || key === '$or') && Array.isArray(value)) {
        if (depth + 1 > MAX_CONDITION_DEPTH) return null;
        const children: ConditionExpr[] = [];
        for (const child of value) {
          const parsed = parseExpr(child, depth + 1);
          if (!parsed) return null;
          children.push(parsed);
        }
        if (children.length === 0) return null;
        return { type: 'group', operator: key === '$and' ? 'and' : 'or', children };
      }

      // Binary comparisons
      const operator = BINARY_TOKEN_OPS[key];
      if (operator && Array.isArray(value) && value.length === 2) {
        const left = parseOperand(value[0]);
        const right = parseOperand(value[1]);
        if (!left || !right) return null;
        // A list only makes sense as the right-hand side of `in`.
        if (left.kind === 'list') return null;
        if (right.kind === 'list' && operator !== 'in') return null;
        return { type: 'comparison', operator, left, right };
      }

      if (key === '$not') {
        // `$not` over `$in` is the "is not one of" row — `$in` is the one comparison with
        // no negated counterpart, so this round-trips exactly rather than approximating.
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const inner = value as Record<string, unknown>;
          if (Object.keys(inner).length === 1 && Array.isArray(inner.$in) && inner.$in.length === 2) {
            const left = parseOperand(inner.$in[0]);
            const right = parseOperand(inner.$in[1]);
            if (left && right && left.kind !== 'list') return { type: 'comparison', operator: 'nin', left, right };
            return null;
          }
        }
        // `$not` over a plain reference reads as "is falsy". `$not` wrapping any other
        // comparison stays raw — folding it into `ne` would change the token on save.
        const operand = parseOperand(value);
        if (!operand || operand.kind === 'list') return null;
        return { type: 'comparison', operator: 'falsy', left: operand };
      }
    }
  }

  // A bare reference used as a condition — `condition: { $local: 'showComments' }`.
  const operand = parseOperand(token);
  if (operand && operand.kind !== 'list' && operand.kind !== 'literal') {
    return { type: 'comparison', operator: 'truthy', left: operand };
  }
  return null;
}

/**
 * Parse a condition token into the editing model.
 * Returns null when the token is outside the grammar — callers should fall back to raw JSON.
 */
export function parseCondition(token: unknown): ConditionExpr | null {
  if (token === undefined) return null;
  return parseExpr(asOperatorTree(token), 0);
}

/**
 * An expression token, as the operator tree the builder's grammar is written over.
 *
 * The builder edits comparisons and groups; an expression is the same thing in another spelling,
 * so a condition written as `{ $: "local.open && item.n > 0" }` opens in the row editor exactly as
 * its operator form would. Anything the editor subset cannot represent — arithmetic, a macro —
 * stays an expression and falls back to the raw editor, as an unrepresentable operator tree does.
 */
function asOperatorTree(token: unknown): unknown {
  if (!isExpressionToken(token)) return token;
  return expressionSourceToOperator(token.$) ?? token;
}

export type ConditionForm = 'operator' | 'expression';

/** Which spelling a condition token uses, so an edit can be written back in the same one. */
export function conditionForm(token: unknown): ConditionForm {
  return isExpressionToken(token) ? 'expression' : 'operator';
}

// ── Serializing ─────────────────────────────────────────────────────────────

function serializeOperand(operand: ConditionOperand): unknown {
  switch (operand.kind) {
    case 'store':
      return { $store: operand.path };
    case 'local':
      return { $local: operand.path };
    case 'context':
      return operand.path;
    case 'literal':
      return operand.value;
    case 'list':
      return operand.value;
    case 'count':
      return { $count: { items: serializeOperand(operand.items) } };
    case 'formState':
      return { [`$${operand.token}`]: operand.field };
  }
}

export function serializeCondition(expr: ConditionExpr, form: ConditionForm = 'operator'): unknown {
  const tree = serializeConditionTree(expr);
  if (form !== 'expression') return tree;
  const converted = operatorToExpr(tree);
  return converted ? { $: printExpression(converted) } : tree;
}

function serializeConditionTree(expr: ConditionExpr): unknown {
  if (expr.type === 'group') {
    return { [expr.operator === 'and' ? '$and' : '$or']: expr.children.map(serializeConditionTree) };
  }
  if (expr.operator === 'truthy') return serializeOperand(expr.left);
  if (expr.operator === 'falsy') return { $not: serializeOperand(expr.left) };
  const right: ConditionOperand = expr.right ?? { kind: 'literal', value: null };
  const comparison = { [OPERATOR_TOKENS[expr.operator]]: [serializeOperand(expr.left), serializeOperand(right)] };
  return expr.operator === 'nin' ? { $not: comparison } : comparison;
}

// ── Values (as opposed to conditions) ───────────────────────────────────────

/**
 * A value position — a `children` entry, or a prop that resolves to a value rather than
 * a boolean. Parses to an operand so the editor can offer the same reference picker it
 * uses inside conditions; returns null for expressions it can't represent ($concat,
 * $map, $plural, …), which fall back to raw JSON.
 */
export function parseValue(token: unknown): ConditionOperand | null {
  return parseOperand(asOperatorTree(token));
}

export function serializeValue(operand: ConditionOperand): unknown {
  return serializeOperand(operand);
}

/** The prop-level `$if` form — resolves to a value, unlike the node-level `$if` operator. */
export interface ValueIf {
  condition: unknown;
  then: unknown;
  else?: unknown;
}

/**
 * Recognise `{ $if: { condition, then, else? } }` used in a value position — including
 * inside `children`, where it renders one of two strings.
 */
export function parseValueIf(token: unknown): ValueIf | null {
  if (typeof token !== 'object' || token === null || Array.isArray(token)) return null;
  const obj = asOperatorTree(token) as Record<string, unknown>;
  if (Object.keys(obj).length !== 1 || !obj.$if) return null;

  const inner = obj.$if;
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return null;
  const { condition, then, else: otherwise, ...rest } = inner as Record<string, unknown>;
  // Transitions et al. belong to the node-level operator; if they're present this isn't
  // a plain value conditional and the raw editor should handle it.
  if (Object.keys(rest).length > 0) return null;
  if (condition === undefined || then === undefined) return null;

  return otherwise === undefined ? { condition, then } : { condition, then, else: otherwise };
}

export function serializeValueIf(value: ValueIf): unknown {
  const inner: Record<string, unknown> = { condition: value.condition, then: value.then };
  if (value.else !== undefined) inner.else = value.else;
  return { $if: inner };
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
