/**
 * Between the operator tokens and the expression tree — both ways.
 *
 * The operators *are* this language's syntax tree, written by hand as JSON. So the old form is not
 * retired, it is accepted: `operatorToExpr` turns a value-operator tree into the AST the evaluator
 * runs, which is what lets the renderer take either spelling and the codemod print every existing
 * template into the new one. `exprToOperator` goes the other way for the subset the visual editor's
 * condition builder represents, so an expression condition still opens in the row editor.
 *
 * Both return `null` for anything outside their subset rather than approximating. A conversion that
 * guessed would change what a template does on the day it was converted.
 */
import type { Expr, LiteralValue } from './ast';
import { parseExpression } from './parser';

const VALUE_OPERATORS = new Set([
  '$store',
  '$local',
  '$concat',
  '$if',
  '$map',
  '$pick',
  '$eq',
  '$ne',
  '$lt',
  '$gt',
  '$in',
  '$not',
  '$and',
  '$or',
  '$filter',
  '$count',
  '$find',
  '$plural',
  '$source',
  '$error',
  '$valid',
  '$touched',
  '$formValid',
]);

const noSpan = [0, 0] as const;

const literal = (value: LiteralValue): Expr => ({ kind: 'literal', value, span: noSpan });
const ident = (name: string): Expr => ({ kind: 'ident', name, span: noSpan });
const call = (callee: string, args: Expr[]): Expr => ({ kind: 'call', callee, args, span: noSpan });

/** `a.b.c` from a dotted path, refusing a segment no expression could name. */
function pathExpr(root: string, segments: string[]): Expr | null {
  let expr = ident(root);
  for (const segment of segments) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      // `$store: 'routeStore.segments.0'` — a numeric segment is an index.
      if (/^\d+$/.test(segment)) {
        expr = { kind: 'index', object: expr, index: literal(Number(segment)), span: noSpan };
        continue;
      }
      return null;
    }
    expr = { kind: 'member', object: expr, property: segment, span: noSpan };
  }
  return expr;
}

/** `'$item.name'` → `item.name`; `'$item'` → `item`. Null for a string that is not a reference. */
function contextRef(text: string): Expr | null {
  if (!text.startsWith('$') || text.length < 2) return null;
  const [root, ...rest] = text.slice(1).split('.');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(root)) return null;
  return pathExpr(root, rest);
}

export interface ConvertOptions {
  /**
   * Inside a `$map` select, only `$item.…` strings were substituted; any other `$`-string was a
   * literal. The conversion has to keep that, or a template's output changes.
   */
  inMapSelect?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isObjectWithTokens = (value: Record<string, unknown>): boolean =>
  Object.keys(value).some((key) => key.startsWith('$'));

/**
 * A value-operator tree as an expression, or null when any part of it is outside the value layer —
 * an action, a query, a schema node, a handler array.
 */
export function operatorToExpr(value: unknown, options: ConvertOptions = {}): Expr | null {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return literal(value);

  if (typeof value === 'string') {
    if (options.inMapSelect) {
      if (value.startsWith('$item.')) return contextRef(value);
      return literal(value);
    }
    return contextRef(value) ?? literal(value);
  }

  if (Array.isArray(value)) {
    const elements: Expr[] = [];
    for (const element of value) {
      const converted = operatorToExpr(element, options);
      if (!converted) return null;
      elements.push(converted);
    }
    return { kind: 'list', elements, span: noSpan };
  }

  if (!isRecord(value)) return null;

  if (!isObjectWithTokens(value)) {
    // A where-object, a $map select, a literal record. `type`/`children` would make it a node.
    if ('type' in value || 'children' in value) return null;
    const entries: { key: string; value: Expr }[] = [];
    for (const [key, entry] of Object.entries(value)) {
      const converted = operatorToExpr(entry, options);
      if (!converted) return null;
      entries.push({ key, value: converted });
    }
    return { kind: 'object', entries, span: noSpan };
  }

  const keys = Object.keys(value);
  const [op] = keys;
  if (!VALUE_OPERATORS.has(op)) return null;

  const convert = (inner: unknown): Expr | null => operatorToExpr(inner, options);
  const convertAll = (items: unknown): Expr[] | null => {
    if (!Array.isArray(items)) return null;
    const out: Expr[] = [];
    for (const item of items) {
      const converted = convert(item);
      if (!converted) return null;
      out.push(converted);
    }
    return out;
  };
  const binary = (opText: '==' | '!=' | '<' | '>' | 'in'): Expr | null => {
    const pair = convertAll(value[op]);
    if (!pair || pair.length !== 2) return null;
    return { kind: 'binary', op: opText, left: pair[0], right: pair[1], span: noSpan };
  };
  const logical = (opText: '&&' | '||'): Expr | null => {
    const operands = convertAll(value[op]);
    if (!operands || operands.length === 0) return null;
    return operands.reduce((left, right) => ({ kind: 'logical', op: opText, left, right, span: noSpan }));
  };

  switch (op) {
    case '$store': {
      if (keys.length !== 1 || typeof value.$store !== 'string') return null;
      const [root, ...rest] = value.$store.split('.');
      if (rest.length === 0) return null;
      return pathExpr(root, rest);
    }
    case '$local': {
      if (keys.length !== 1 || typeof value.$local !== 'string') return null;
      return pathExpr('local', value.$local.split('.'));
    }
    case '$eq':
      return keys.length === 1 ? binary('==') : null;
    case '$ne':
      return keys.length === 1 ? binary('!=') : null;
    case '$lt':
      return keys.length === 1 ? binary('<') : null;
    case '$gt':
      return keys.length === 1 ? binary('>') : null;
    case '$in':
      return keys.length === 1 ? binary('in') : null;
    case '$and':
      return keys.length === 1 ? logical('&&') : null;
    case '$or':
      return keys.length === 1 ? logical('||') : null;
    case '$not': {
      if (keys.length !== 1) return null;
      const operand = convert(value.$not);
      return operand ? { kind: 'unary', op: '!', operand, span: noSpan } : null;
    }
    case '$concat': {
      if (keys.length !== 1) return null;
      const parts = convertAll(value.$concat);
      if (!parts) return null;
      const templateParts: (string | Expr)[] = [];
      for (const part of parts) {
        if (part.kind === 'literal' && typeof part.value === 'string') {
          const previous = templateParts[templateParts.length - 1];
          if (typeof previous === 'string') templateParts[templateParts.length - 1] = previous + part.value;
          else templateParts.push(part.value);
        } else {
          templateParts.push(part);
        }
      }
      return { kind: 'template', parts: templateParts, span: noSpan };
    }
    case '$if': {
      if (keys.length !== 1 || !isRecord(value.$if)) return null;
      const spec = value.$if;
      const specKeys = Object.keys(spec);
      if (specKeys.some((key) => key !== 'condition' && key !== 'then' && key !== 'else')) return null;
      if (!('then' in spec)) return null;
      const test = convert(spec.condition);
      const consequent = convert(spec.then);
      const alternate = 'else' in spec ? convert(spec.else) : literal(null);
      if (!test || !consequent || !alternate) return null;
      return { kind: 'conditional', test, consequent, alternate, span: noSpan };
    }
    case '$count': {
      if (keys.length !== 1 || !isRecord(value.$count)) return null;
      const items = convert(value.$count.items);
      return items ? call('count', [items]) : null;
    }
    case '$filter': {
      if (keys.length !== 1 || !isRecord(value.$filter)) return null;
      const spec = value.$filter;
      const items = convert(spec.items);
      const where = isRecord(spec.where) ? convert(spec.where) : null;
      if (!items || !where) return null;
      const args = [items, where];
      if (spec.limit !== undefined) {
        const limit = convert(spec.limit);
        if (!limit) return null;
        args.push(limit);
      }
      return call('filter', args);
    }
    case '$find': {
      if (keys.length !== 1 || !isRecord(value.$find)) return null;
      const spec = value.$find;
      const items = convert(spec.items);
      if (!items) return null;
      const args = [items];
      if (spec.where !== undefined) {
        const where = isRecord(spec.where) ? convert(spec.where) : null;
        if (!where) return null;
        args.push(where);
      }
      const found = call('find', args);
      if (spec.select === undefined) return found;
      if (typeof spec.select !== 'string') return null;
      return pathExprFrom(found, spec.select);
    }
    case '$plural': {
      if (keys.length !== 1 || !isRecord(value.$plural)) return null;
      const spec = value.$plural;
      const count = convert(spec.count);
      if (!count || typeof spec.one !== 'string' || typeof spec.other !== 'string') return null;
      return call('plural', [count, literal(spec.one), literal(spec.other)]);
    }
    case '$pick': {
      if (keys.length !== 1 || !isRecord(value.$pick)) return null;
      const from = convert(value.$pick.from);
      const names = value.$pick.props;
      // Key names, never references — `$likeCount` is a projection key, not a context variable.
      if (!from || !Array.isArray(names) || !names.every((name) => typeof name === 'string')) return null;
      return call('pick', [
        from,
        { kind: 'list', elements: names.map((name) => literal(name as string)), span: noSpan },
      ]);
    }
    case '$map': {
      if (keys.length !== 1 || !isRecord(value.$map)) return null;
      const spec = value.$map;
      const items = convert(spec.items);
      if (!items || !isRecord(spec.select)) return null;
      const body = operatorToExpr(spec.select, { ...options, inMapSelect: true });
      if (!body) return null;
      return { kind: 'macro', name: 'map', receiver: items, variable: 'item', body, span: noSpan };
    }
    case '$source': {
      if (keys.length !== 1 || !isRecord(value.$source) || typeof value.$source.name !== 'string') return null;
      const name = value.$source.name;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
      if (value.$source.options === undefined) return call(name, []);
      const options = convert(value.$source.options);
      return options ? call(name, [options]) : null;
    }
    case '$error':
    case '$valid':
    case '$touched': {
      if (keys.length !== 1 || typeof value[op] !== 'string') return null;
      return call(op.slice(1), [literal(value[op] as string)]);
    }
    case '$formValid':
      return keys.length === 1 ? call('formValid', []) : null;
    default:
      return null;
  }
}

function pathExprFrom(base: Expr, dotted: string): Expr | null {
  let expr = base;
  for (const segment of dotted.split('.')) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) return null;
    expr = { kind: 'member', object: expr, property: segment, span: noSpan };
  }
  return expr;
}

/** Parse and convert in one step — what a codemod or an editor round-trip wants. */
export function expressionSourceToOperator(source: string): unknown | null {
  try {
    return exprToOperator(parseExpression(source));
  } catch {
    return null;
  }
}

/**
 * The inverse, for the editor's condition subset: references, literals, lists, comparisons,
 * connectives, `count(…)` and the form-state readers. Null for anything else.
 */
export function exprToOperator(expr: Expr): unknown | null {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'ident':
    case 'member': {
      const path = chainOf(expr);
      if (!path) return null;
      const [root, ...rest] = path;
      if (root === 'local') return rest.length ? { $local: rest.join('.') } : null;
      if (rest.length && /Store$/.test(root)) return { $store: path.join('.') };
      if (root === 'modules' && rest.length >= 2) return { $store: path.join('.') };
      return `$${path.join('.')}`;
    }
    case 'list': {
      const out: unknown[] = [];
      for (const element of expr.elements) {
        const converted = exprToOperator(element);
        if (converted === null && !(element.kind === 'literal' && element.value === null)) return null;
        out.push(converted);
      }
      return out;
    }
    case 'unary': {
      if (expr.op !== '!') return null;
      const operand = exprToOperator(expr.operand);
      return operand === null ? null : { $not: operand };
    }
    case 'binary': {
      const tokens: Record<string, string> = { '==': '$eq', '!=': '$ne', '<': '$lt', '>': '$gt', in: '$in' };
      const token = tokens[expr.op];
      if (!token) return null;
      const left = exprToOperator(expr.left);
      const right = exprToOperator(expr.right);
      if (left === null || right === null) return null;
      return { [token]: [left, right] };
    }
    case 'logical': {
      if (expr.op === '??') return null;
      const token = expr.op === '&&' ? '$and' : '$or';
      const flat: unknown[] = [];
      const gather = (node: Expr): boolean => {
        if (node.kind === 'logical' && node.op === expr.op) return gather(node.left) && gather(node.right);
        const converted = exprToOperator(node);
        if (converted === null) return false;
        flat.push(converted);
        return true;
      };
      return gather(expr) ? { [token]: flat } : null;
    }
    case 'call': {
      const args = expr.receiver ? [expr.receiver, ...expr.args] : expr.args;
      if (expr.callee === 'count' && args.length === 1) {
        const items = exprToOperator(args[0]);
        return items === null ? null : { $count: { items } };
      }
      if (['error', 'valid', 'touched'].includes(expr.callee) && args.length === 1) {
        const [field] = args;
        if (field.kind === 'literal' && typeof field.value === 'string') return { [`$${expr.callee}`]: field.value };
        return null;
      }
      if (expr.callee === 'formValid' && args.length === 0) return { $formValid: '$scope' };
      return null;
    }
    default:
      return null;
  }
}

function chainOf(expr: Expr): string[] | null {
  if (expr.kind === 'ident') return [expr.name];
  if (expr.kind === 'member') {
    const inner = chainOf(expr.object);
    return inner ? [...inner, expr.property] : null;
  }
  return null;
}
