/**
 * The step between a template's query and the backend that answers it.
 *
 * A `$query` is written in WE's own flat dialect. `compileQuery` turns that into the neutral
 * {@link QueryIR}, the adapter says what its backend can do with it, and `lower` produces the options
 * that backend actually consumes. This function is those three steps and the decision between them:
 * run it, refuse it, or run it and say what was lost.
 *
 * ## Why it is here rather than in the renderer
 *
 * It knows about `compileQuery`, `QueryAdapter` and `CapabilityGap`, and about nothing else — no
 * framework, no store bag, no DOM. It lived in the Solid renderer only because that is where the one
 * caller was, and the cost was that the single decision every query in the app passes through had no
 * tests at all: reaching it meant mounting a component. Here it is an ordinary function with
 * ordinary tests, beside the three things it composes.
 *
 * ## Why it answers rather than reports
 *
 * The renderer needs to raise a toast on a refusal, warn once per `entity:feature` on a degradation,
 * and warn only in development about an empty id. Those are three different reporting policies over
 * one decision, and a function that took three callbacks would have the policies baked into its
 * signature. So it returns what it found and the caller decides what that is worth — which is also
 * what makes every branch below assertable without spying on a console.
 *
 * ## Fail loud
 *
 * When the IR cannot express the query, or the adapter reports a blocking gap, this refuses. The
 * caller renders nothing and says why. There is deliberately no fallback to handing the backend the
 * raw dialect: that only ever worked because AD4M happens to be *both* the dialect and the backend,
 * and against any other backend it hands over something the adapter never agreed to read — so it hid
 * real gaps rather than surfacing them.
 *
 * The one exception is a **`degraded`** gap, which is a backend *defect* rather than a capability
 * gap: the rows come back correct, one named feature is silently ignored. Refusing there would block
 * a working screen over a bug elsewhere, so it proceeds and hands back a diagnostic instead.
 */
import type { QueryAdapter, QueryOptions } from './dataSource';
import type { CapabilityGap } from './queryCapabilities';
import { compileQuery, type FlatQuery } from './queryCompiler';

/**
 * Something worth saying about a query that still ran.
 *
 * `key` is stable and carries no entity name, so a caller can dedupe per entity however it likes —
 * a query re-runs on every reactive change, and a warning per frame is a warning nobody reads.
 */
export interface QueryDiagnostic {
  /** `emptyId`, or `degraded:<feature>`. */
  key: string;
  /** Already user-facing: the caller prints it, it does not assemble one. */
  message: string;
}

export type QueryRouting =
  | { ok: true; options: QueryOptions; diagnostics: QueryDiagnostic[] }
  | { ok: false; error: string; diagnostics: QueryDiagnostic[] };

/**
 * Say so when a query asks for the record with no id.
 *
 * `pruneUnresolvedWhere` drops an operand that is `undefined`; an empty string is a value and stays,
 * which is right — `''` is a real value for plenty of fields. For `id` it is not: no record has it,
 * and it is what a `$localState` field or a store accessor answers when nothing has been chosen yet
 * (`modules.call.callRecordId` returns `''` by design, so every surface reading it gets a string).
 *
 * What reaches the screen without this is a SPARQL parse error. The AD4M executor builds a `VALUES`
 * clause, drops the id for not being an IRI, and refuses the now-empty data block — "expected UNDEF"
 * — naming neither the template, the entity nor the field.
 *
 * Reported rather than repaired, because no repair here is right. Pruning `''` would mean "do not
 * narrow by id", which answers with an arbitrary record and draws somebody else's data with nothing
 * on screen saying so; refusing the query outright needs a "matches nothing" the IR cannot express.
 * The fix is always the same and belongs to the author: gate the query on having an id.
 */
function emptyIdDiagnostic(entity: string, where: unknown): QueryDiagnostic | null {
  if (!where || typeof where !== 'object') return null;
  if ((where as Record<string, unknown>).id !== '') return null;
  return {
    key: 'emptyId',
    message:
      `"${entity}" asks for id "" — no record has it, and the backend will refuse the query. ` +
      'Gate the query on having an id: an empty one cannot be pruned, because "do not narrow by id" ' +
      'would answer with an arbitrary record.',
  };
}

const degradedDiagnostic = (entity: string, gap: CapabilityGap): QueryDiagnostic => ({
  key: `degraded:${gap.feature}`,
  message: `"${entity}" runs with a degraded feature — ${gap.feature}: ${gap.note}`,
});

/**
 * Compile, plan and lower one query for one backend.
 *
 * `query` is the already-token-resolved flat descriptor — every `{ $: … }` in it has become a value
 * before it arrives, so this sees literals and nothing reactive.
 */
export function routeQuery(query: FlatQuery, adapter: QueryAdapter): QueryRouting {
  const entity = query.entity;
  const emptyId = emptyIdDiagnostic(entity, query.where);
  const diagnostics: QueryDiagnostic[] = emptyId ? [emptyId] : [];

  try {
    const { ir, unsupported } = compileQuery(query);
    if (unsupported.length > 0) {
      return {
        ok: false,
        error: `Query on "${entity}" uses features the query IR cannot express: ${unsupported.join(', ')}`,
        diagnostics,
      };
    }

    const plan = adapter.plan(ir);
    const blocking = plan.gaps.filter((gap) => gap.disposition !== 'degraded');
    if (blocking.length > 0) {
      return {
        ok: false,
        error:
          `Query on "${entity}" needs capabilities this backend does not support: ` +
          blocking.map((gap) => gap.feature).join(', '),
        diagnostics,
      };
    }

    for (const gap of plan.gaps) diagnostics.push(degradedDiagnostic(entity, gap));
    return { ok: true, options: adapter.lower(ir), diagnostics };
  } catch (error) {
    return {
      ok: false,
      error: `Query on "${entity}" could not be compiled: ${error instanceof Error ? error.message : String(error)}`,
      diagnostics,
    };
  }
}
