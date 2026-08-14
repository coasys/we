/**
 * `$source` — rows a schema iterates that were *computed* rather than stored.
 *
 * ## Why this exists
 *
 * The operator set has no arithmetic, no date maths, and no way to generate a sequence. So a month
 * of days cannot be written as data, and neither can a set of time slots, a recurring series, or a
 * page range. Without a way to reach computation from JSON, every sequence-shaped view has to be a
 * bespoke component — and everything inside it stops being template-owned, which is the one property
 * the whole system exists to preserve.
 *
 * This is the same bargain the graph system already makes and documents: the authoring surface is
 * JSON, so anything genuinely computational is reachable *from* JSON by name.
 *
 * ## Why it is not `$query`
 *
 * `$query` carries `entity`/`where`/`order`/`scope` and compiles through the query IR, capability
 * planning and a backend adapter. A source has none of that. Folding them together would make every
 * consumer that reasons about `$query` — the IR compiler, the validator, the planner — branch on
 * "is this actually a query", which costs more than a second token.
 *
 * ## Why it is a memo and not a subscription
 *
 * A source is a **synchronous, pure function of its options**, and that constraint is what keeps it
 * from growing into a second data layer: anything that fetches is a `$query`, anything that holds
 * state is a store. Being pure, it needs no lifecycle and creates no effect — so unlike `$query` it
 * needs no hoisting to component setup, and works in props, conditions **and** children alike.
 *
 * A missing source resolves to `[]` and reports through `$onError`, rather than throwing: a template
 * naming a source this deployment did not register should degrade to an empty list, the same way a
 * query against an unreachable backend does.
 */
import type { resolveProp } from './dispatcher';
import { markReactive } from './reactive';
import type { Memo, Props } from './types';

export interface SourceProp {
  /** Registered name, e.g. `'calendarMonth'`. */
  name: string;
  /** Arguments, resolved before the source sees them, so they may contain `$local`/`$store`. */
  options?: Record<string, unknown>;
}

type SourceFn = (options: Record<string, unknown>) => unknown[];

export function resolveSourceProp(
  token: SourceProp,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  return markReactive(
    memo(() => {
      const registry = stores.$sources as Record<string, SourceFn> | undefined;
      const source = registry?.[token.name];
      if (!source) {
        const report = stores.$onError as ((message: string) => void) | undefined;
        const message = `Source "${token.name}" is not registered on this host.`;
        if (report) report(message);
        else console.error('[source]', message);
        return [];
      }

      // Options resolved through the dispatcher, so a month can come from `$local` and the memo
      // re-runs when it changes — which is what makes "next month" a `$setLocal` rather than a
      // component's private state.
      const resolved = (resolvePropFn(token.options ?? {}, stores, context, memo) ?? {}) as Record<string, unknown>;
      const unwrapped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(resolved)) {
        unwrapped[key] = typeof value === 'function' ? (value as () => unknown)() : value;
      }

      try {
        const rows = source(unwrapped);
        return Array.isArray(rows) ? rows : [];
      } catch (error) {
        const report = stores.$onError as ((message: string) => void) | undefined;
        const message = `Source "${token.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
        if (report) report(message);
        else console.error('[source]', message);
        return [];
      }
    }),
  );
}
