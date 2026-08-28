/**
 * Evaluate an expression against an environment.
 *
 * ## Inert by construction
 *
 * The environment answers two questions — what a root name means, and what a function name does —
 * and nothing else is reachable. Property access reads data: an object's own values, an array's
 * entries, a string's length. A function found on the way is read through the same rule `walkPath`
 * applies, which is the rule `$store` learned after it was found to be an execution channel: a
 * **tagged** accessor is a signal and is read; any other function resolves to `undefined`. There is
 * no method call — `a.f(b)` is the library's `f(a, b)` — so a value's own methods are unreachable
 * whatever it is.
 *
 * ## Total
 *
 * Nothing here throws on bad input. A missing name is `undefined`, arithmetic on a non-number is
 * arithmetic on 0, a comprehension over a non-list is empty. The checker reports the mistake at
 * validation time, with a column; at paint time the honest answer is "nothing", not a torn-down tree.
 *
 * ## Reactive
 *
 * Reads go through `readValue`, which calls tagged accessors. Run inside a framework memo, every
 * such read is a tracked dependency, and the whole expression re-evaluates when any of them changes
 * — which is exactly what the operator resolvers did with their per-operand `resolvePropFn` calls,
 * with one memo instead of one per operator.
 */
import { REACTIVE_ACCESSOR } from '../propResolvers/reactive';
import type { Expr } from './ast';
import { DENIED_PROPERTIES } from './ast';

/**
 * A root whose members are read through a getter rather than as an object's own properties —
 * `local`, whose fields are signals in `context.$local`, and a store, whose accessors must be read
 * by the tagging rule. A namespace in a value position is `undefined`: a store is not a value.
 */
export const NAMESPACE = Symbol('expression-namespace');

export interface Namespace {
  [NAMESPACE]: true;
  get(property: string): unknown;
}

export function namespace(get: (property: string) => unknown): Namespace {
  return { [NAMESPACE]: true, get };
}

/**
 * A function a callback handed over, which an expression may read as a value.
 *
 * The inert rule refuses every untagged function, and that is the right rule for the bag: a
 * template must not obtain a callable from a store. A callback's argument is the other way round —
 * it is the host handing the template something on purpose, and `onReady: { $setLocal: 'save',
 * value: { $: 'event.save' } }` is how a composer's `save()` reaches the button that calls it.
 * Marked rather than let through as-is, so nothing else that happens to be a function is.
 */
const CALLBACK_FUNCTION = Symbol('expression-callback-function');
const RAW = Symbol('expression-callback-raw');

type CallbackNamespace = Namespace & { [RAW]: unknown };

/**
 * The value of a call-time root — `event`, `arg`, `result` — as an expression reads it: its
 * properties are data, its functions are readable (bound to the object they came from), and the
 * whole thing settles back to the raw value, so `{ $: 'arg' }` still hands the argument itself on.
 */
export function callbackValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const ns = namespace((property) => {
    if (DENIED_PROPERTIES.has(property) || !(property in raw)) return undefined;
    const member = raw[property];
    if (typeof member === 'function') {
      if (REACTIVE_ACCESSOR in member) return member;
      const bound = (...args: unknown[]) => (member as (...a: unknown[]) => unknown).apply(raw, args);
      (bound as unknown as Record<symbol, true>)[CALLBACK_FUNCTION] = true;
      return bound;
    }
    return callbackValue(member);
  }) as CallbackNamespace;
  ns[RAW] = value;
  return ns;
}

export interface EvaluationEnv {
  /** What a root name means here. `bound: false` when it means nothing. */
  root(name: string): { bound: boolean; value: unknown };
  /** Call a library or host-registered function. `undefined` for a name nothing provides. */
  call(name: string, args: unknown[]): unknown;
}

const isNamespace = (value: unknown): value is Namespace =>
  typeof value === 'object' && value !== null && NAMESPACE in value;

/** Read through a tagged accessor; let a callback's function through; refuse any other function. */
export function readValue(value: unknown): unknown {
  if (typeof value === 'function') {
    if (REACTIVE_ACCESSOR in value) return readValue((value as unknown as () => unknown)());
    return CALLBACK_FUNCTION in value ? value : undefined;
  }
  return value;
}

/** A value fit to leave the evaluator: a callback value is its raw self, any other namespace undefined. */
function settle(value: unknown): unknown {
  const read = readValue(value);
  if (!isNamespace(read)) return read;
  return RAW in read ? (read as CallbackNamespace)[RAW] : undefined;
}

function readProperty(object: unknown, property: string): unknown {
  if (DENIED_PROPERTIES.has(property)) return undefined;
  if (isNamespace(object)) return object.get(property);
  const base = readValue(object);
  if (isNamespace(base)) return base.get(property);
  if (base === null || base === undefined) return undefined;
  if (typeof base === 'string') return property === 'length' ? base.length : undefined;
  if (typeof base !== 'object') return undefined;
  if (!(property in (base as object))) return undefined;
  return readValue((base as Record<string, unknown>)[property]);
}

function readIndex(object: unknown, index: unknown): unknown {
  const base = settle(object);
  if (base === null || base === undefined) return undefined;
  if (typeof index === 'number') {
    if (Array.isArray(base)) return readValue(base[index]);
    if (typeof base === 'string') return base[index];
    return undefined;
  }
  return readProperty(base, String(index));
}

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function evaluateExpression(expr: Expr, env: EvaluationEnv): unknown {
  return settle(evaluate(expr, env, new Map()));
}

function evaluate(expr: Expr, env: EvaluationEnv, scope: Map<string, unknown>): unknown {
  switch (expr.kind) {
    case 'literal':
      return expr.value;

    case 'template':
      return expr.parts
        .map((part) => {
          if (typeof part === 'string') return part;
          const value = settle(evaluate(part, env, scope));
          return value == null ? '' : String(value);
        })
        .join('');

    case 'ident': {
      if (scope.has(expr.name)) return scope.get(expr.name);
      const { bound, value } = env.root(expr.name);
      return bound ? value : undefined;
    }

    case 'member':
      return readProperty(evaluate(expr.object, env, scope), expr.property);

    case 'index':
      return readIndex(evaluate(expr.object, env, scope), settle(evaluate(expr.index, env, scope)));

    case 'unary': {
      const operand = settle(evaluate(expr.operand, env, scope));
      return expr.op === '!' ? !operand : -toNumber(operand);
    }

    case 'logical': {
      /*
        `&&` and `||` answer with a boolean, not with an operand as JavaScript does. They are the
        connectives `$and`/`$or` were, and those returned booleans — a `disabled` bound to
        `local.busy || local.error` must be `true`, not the error string. The value-picking idiom
        JavaScript's `||` is used for is `??`, which is here for exactly that.
      */
      const left = settle(evaluate(expr.left, env, scope));
      switch (expr.op) {
        case '&&':
          return left ? !!settle(evaluate(expr.right, env, scope)) : false;
        case '||':
          return left ? true : !!settle(evaluate(expr.right, env, scope));
        case '??':
          return left ?? settle(evaluate(expr.right, env, scope));
        default:
          return undefined;
      }
    }

    case 'binary': {
      const left = settle(evaluate(expr.left, env, scope));
      const right = settle(evaluate(expr.right, env, scope));
      switch (expr.op) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '<':
          return toNumber(left) < toNumber(right);
        case '>':
          return toNumber(left) > toNumber(right);
        case '<=':
          return toNumber(left) <= toNumber(right);
        case '>=':
          return toNumber(left) >= toNumber(right);
        case 'in':
          return Array.isArray(right) && right.includes(left);
        case '+':
          if (typeof left === 'number' && typeof right === 'number') return left + right;
          if (typeof left === 'string' || typeof right === 'string') return `${left ?? ''}${right ?? ''}`;
          return toNumber(left) + toNumber(right);
        case '-':
          return toNumber(left) - toNumber(right);
        case '*':
          return toNumber(left) * toNumber(right);
        case '/': {
          const divisor = toNumber(right);
          return divisor === 0 ? 0 : toNumber(left) / divisor;
        }
        case '%': {
          const divisor = toNumber(right);
          return divisor === 0 ? 0 : toNumber(left) % divisor;
        }
        default:
          return undefined;
      }
    }

    case 'conditional':
      return settle(evaluate(expr.test, env, scope))
        ? evaluate(expr.consequent, env, scope)
        : evaluate(expr.alternate, env, scope);

    case 'call': {
      const args = expr.args.map((arg) => settle(evaluate(arg, env, scope)));
      if (expr.receiver) args.unshift(settle(evaluate(expr.receiver, env, scope)));
      return env.call(expr.callee, args);
    }

    case 'macro': {
      const receiver = settle(evaluate(expr.receiver, env, scope));
      const bind = (value: unknown): Map<string, unknown> => new Map(scope).set(expr.variable, value);
      const body = (value: unknown): unknown => settle(evaluate(expr.body, env, bind(value)));

      if (!Array.isArray(receiver)) {
        switch (expr.name) {
          case 'map':
            // The operator `$map` mapped a lone object as one row and nothing as none; kept.
            return receiver && typeof receiver === 'object' ? body(receiver) : [];
          case 'filter':
            return [];
          case 'find':
            return undefined;
          case 'exists':
            return false;
          case 'all':
            return true;
          default:
            return undefined;
        }
      }
      switch (expr.name) {
        case 'filter':
          return receiver.filter((entry) => !!body(readValue(entry)));
        case 'map':
          return receiver.map((entry) => body(readValue(entry)));
        case 'find':
          return receiver.find((entry) => !!body(readValue(entry)));
        case 'exists':
          return receiver.some((entry) => !!body(readValue(entry)));
        case 'all':
          return receiver.every((entry) => !!body(readValue(entry)));
        default:
          return undefined;
      }
    }

    case 'list':
      return expr.elements.map((element) => settle(evaluate(element, env, scope)));

    case 'object': {
      const out: Record<string, unknown> = {};
      for (const entry of expr.entries) out[entry.key] = settle(evaluate(entry.value, env, scope));
      return out;
    }

    default:
      return undefined;
  }
}
