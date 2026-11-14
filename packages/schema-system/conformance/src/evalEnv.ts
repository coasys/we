/**
 * The evaluation environment a case's `env` decodes to — the renderer's own `buildEnvironment`
 * over a decoded store bag and context, so the vectors pin the real root rules, not a copy of
 * them: `local` reads `context.$local` accessors, `event`/`arg`/`result` read through
 * `callbackValue` (with `arg` falling back to `event`), `$`-prefixed context keys are skipped,
 * `$`-bag entries are host globals (functions invoked), and `call` finds built-ins then
 * `bag.$sources` — which is where the host puts the source registry, so `hostSourceBag()` goes
 * in under that key exactly as TemplateProvider installs it.
 */
import { hostSourceBag } from '../../../app-shell/src/shared/sources/index.ts';
import { buildEnvironment, type EvaluationEnv } from '../../shared/src/index.ts';
import { decodeValue, type EncodedValue } from './encode';

/** A named environment's encoded parts — what `envFor` decodes into the stores bag + context. */
export interface ExpressionEnvSpec {
  /**
   * The store bag: `spaceStore` → a store namespace (members read by the tagging rule),
   * `$me`/`$clock` → host globals — a plain object is the value itself, a `{$accessor: …}`
   * function is invoked to get it.
   */
  stores?: Record<string, EncodedValue>;
  /**
   * The render context: `$each` variables, `event`/`arg`/`result` (decoded as plain data —
   * `buildEnvironment` wraps them in `callbackValue`), `surface`, and `$`-prefixed keys,
   * which exist on the real context (`$local`, `$localMeta`, …) and must be skipped.
   */
  context?: Record<string, EncodedValue>;
  /** `$localState`/`$queries` signals — each decoded into a `() => value` accessor on `context.$local`. */
  local?: Record<string, EncodedValue>;
}

export function envFor(spec: ExpressionEnvSpec): EvaluationEnv {
  const stores: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.stores ?? {})) stores[k] = decodeValue(v);
  stores.$sources ??= hostSourceBag();
  const context: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.context ?? {})) context[k] = decodeValue(v);
  if (spec.local) {
    const local: Record<string, () => unknown> = {};
    for (const [k, v] of Object.entries(spec.local)) {
      const decoded = decodeValue(v);
      local[k] = () => decoded;
    }
    context.$local = local;
  }
  return buildEnvironment(stores, context);
}
