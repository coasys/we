/**
 * `{ $: '…' }` — an expression, resolved.
 *
 * The one dispatcher branch the expression layer adds. Everything the value operators did
 * individually — resolve each operand, unwrap accessors, memoise — happens once here: the source is
 * parsed (cached), the environment is built from the same bag and context every other resolver
 * sees, and the whole expression evaluates inside one framework memo, so every tagged read it makes
 * is a tracked dependency.
 *
 * ## Render time and call time
 *
 * An expression that names `event`, `arg` or `result` is about a callback that has not fired yet.
 * Resolved at render time — an `$action`'s `args`, say — it returns a **deferred** function that the
 * action dispatcher calls with the callback's argument, exactly as a bare `'$event.detail'` string
 * is substituted there. Inside a handler array or a lifecycle array the context already carries
 * `event`/`result`, so the same expression simply evaluates.
 */
import type { EvaluationEnv } from '../expressions';
import {
  CALL_TIME_ROOTS,
  callbackValue,
  evaluateExpression,
  ExpressionSyntaxError,
  getFunction,
  namespace,
  parseCached,
  readValue,
  referencedRoots,
} from '../expressions';
import { markReactive } from './reactive';
import { type Memo, noMemo, type Props } from './types';

/** Tags a function the action dispatcher must call with the callback argument to get the value. */
export const DEFERRED_ARG = Symbol('schema-deferred-arg');

export type DeferredArg = ((callArg: unknown) => unknown) & { [DEFERRED_ARG]: true };

export function isDeferredArg(value: unknown): value is DeferredArg {
  return typeof value === 'function' && DEFERRED_ARG in value;
}

/**
 * Authoring diagnostics — a parse error, an unknown function — go to the console and to whatever
 * sink the host installs for template warnings, the same route `$local` mistakes take.
 */
let warningSink: ((message: string) => void) | null = null;
export function setExpressionWarningSink(sink: ((message: string) => void) | null): void {
  warningSink = sink;
}
function warn(message: string): void {
  warningSink?.(message);
  console.warn(message);
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  warn(message);
}

/**
 * The environment an expression evaluates in, from a render context and a store bag.
 *
 * Root resolution, in order — the same order the dispatcher gave context-reference strings:
 * 1. `local` — a namespace over `context.$local`, the signals `$localState` and `$queries` made.
 * 2. A context key — a `$each` variable, `event`, `result`, `surface`.
 * 3. `arg` — the callback argument, an older spelling of `event`.
 * 4. A host global — `me` for `$me`, `currentDataset` for `$currentDataset`.
 * 5. A store — a namespace over the bag's copy of it, read by the tagging rule.
 */
export function buildEnvironment(stores: Props, context: Props): EvaluationEnv {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  const bag = stores as Record<string, unknown>;

  const localNamespace = namespace((field) => {
    const accessor = localState?.[field];
    if (!accessor) {
      warnOnce(`local:${field}`, `Expression: local.${field} is not declared in $localState or $queries`);
      return undefined;
    }
    return markReactive(accessor);
  });

  const storeNamespace = (store: Record<string, unknown>) =>
    namespace((member) => (member in store ? store[member] : undefined));

  return {
    root(name) {
      if (name === 'local') return { bound: true, value: localNamespace };
      // A callback's argument may hand over functions — a composer's `save()` — on purpose.
      if (CALL_TIME_ROOTS.has(name)) {
        if (name in context) return { bound: true, value: callbackValue(context[name]) };
        if (name === 'arg' && 'event' in context) return { bound: true, value: callbackValue(context.event) };
      }
      if (name in context && !name.startsWith('$')) return { bound: true, value: context[name] };
      const global = bag[`$${name}`];
      if (global !== undefined) {
        return { bound: true, value: typeof global === 'function' ? (global as () => unknown)() : global };
      }
      const store = bag[name];
      if (store && typeof store === 'object')
        return { bound: true, value: storeNamespace(store as Record<string, unknown>) };
      return { bound: false, value: undefined };
    },
    call(name, args) {
      const builtin = getFunction(name);
      if (builtin) {
        try {
          return builtin.impl(args, { context, stores: bag });
        } catch (error) {
          warn(`Expression: ${name}() failed: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        }
      }
      // Host-registered computation, the same registry `$source` reaches.
      const sources = bag.$sources as Record<string, (options: unknown) => unknown> | undefined;
      const source = sources?.[name];
      if (source) {
        try {
          return source(args[0]);
        } catch (error) {
          warn(`Expression: ${name}() failed: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        }
      }
      warnOnce(`fn:${name}`, `Expression: "${name}" is not a function this host provides`);
      return undefined;
    },
  };
}

/**
 * Resolve `{ $: '…' }`.
 *
 * A parse error resolves to `undefined` and warns once per source: the validator has already said
 * where the mistake is, and a template that renders a hole is recoverable where one that throws
 * during paint is not.
 */
export function resolveExpressionProp(token: { $: string }, stores: Props, context: Props, memo: Memo): unknown {
  let ast;
  try {
    ast = parseCached(token.$);
  } catch (error) {
    if (error instanceof ExpressionSyntaxError) {
      warnOnce(`parse:${token.$}`, `Expression "${token.$}": ${error.message} at ${error.span[0]}`);
    }
    return undefined;
  }

  const roots = referencedRoots(ast);
  const unboundCallTime = [...roots].some(
    (root) => CALL_TIME_ROOTS.has(root) && !(root in context) && !(root === 'arg' && 'event' in context),
  );

  if (unboundCallTime) {
    const deferred = ((callArg: unknown) =>
      evaluateExpression(
        ast,
        buildEnvironment(stores, { ...context, event: callArg, result: callArg }),
      )) as DeferredArg;
    (deferred as { [DEFERRED_ARG]?: true })[DEFERRED_ARG] = true;
    return deferred;
  }

  const env = buildEnvironment(stores, context);
  const computed = memo(() => {
    /*
      Re-read the source inside the memo. The schema is reactive in the visual editor, so an
      expression edited in place must be picked up on the next evaluation — the same lesson
      `$if` learned when destructuring its spec once made edited branches invisible until the
      subtree remounted. The parse is cached, so this costs a map lookup.
    */
    let current = ast;
    try {
      current = parseCached(token.$);
    } catch {
      return undefined;
    }
    return readValue(evaluateExpression(current, env));
  });
  /*
    A real memo hands back an accessor, which is tagged so the renderer reads it. `noMemo` hands
    back the value itself — and tagging a *value* that happens to be a function (a callback's
    `save()`, on its way into a function-typed local) would make it read as an accessor and be
    called instead of kept.
  */
  return memo === noMemo ? computed : markReactive(computed);
}
