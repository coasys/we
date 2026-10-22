/**
 * Which view draws one record — the page at `/record/:entity?id=…`.
 *
 * A record used to have one page, drawn the same way whatever it was: the generic `RecordPage`, from
 * the model's own declaration. Some records deserve a page of their own — a call is its tiles and
 * transcript, a discussion its steps — and a template, a module or an app's bundle can now bring
 * one. The page a record gets is decided in rungs, most specific first, the same shape panel
 * placement already has (the reader's arrangement, then the template's, then the module's bid):
 *
 * 1. **The template's own map** (`meta.recordViews`): the app's opinion of how its records look.
 * 2. **Any view available here that says it draws the type** (`meta.draws`): one a module, a bundle
 *    or the space brings.
 * 3. **The generic page.**
 *
 * A community choosing a view per type is a rung that would sit between 1 and 2; not yet.
 *
 * ## Why the view says what it draws, and the model does not
 *
 * A model is data read by everything that reads the space — bots, other apps — and UI inside it would
 * travel with it into all of them. Naming a view from the model would only work for views the host
 * already has. So the reference runs the other way, as the polls module's does (its card draws `Poll`;
 * `Poll` names nothing), and a model nothing claims falls back to the generic page.
 *
 * ## Kinds
 *
 * Some entities are several things told apart by a field — a `CollectionBlock` is a channel, a call, a
 * post. A view can draw one kind (`{ entity: 'CollectionBlock', kind: 'call' }`), and a link to such a
 * record carries the kind in the address (`?kind=call`), since a route cannot read a field of the
 * record it has not loaded yet. A view for the kind wins over one for the whole entity.
 */
import type { RecordViewDraws, SchemaNode, TemplateSchema } from './types';
import type { ResolvedView } from './viewRoutes';

/** A view that can draw a type, with the type it draws. */
export interface RecordViewCandidate {
  entity: string;
  kind?: string;
  node: SchemaNode;
}

/** `'Entity'` or `'Entity:kind'` — how `meta.recordViews` names a type. */
export function parseRecordViewKey(key: string): RecordViewDraws | null {
  const [entity, kind, ...rest] = key.split(':');
  if (!entity || rest.length || !/^[A-Z][A-Za-z0-9]*$/.test(entity)) return null;
  return kind ? { entity, kind } : { entity };
}

const TEMPLATE_ONLY = ['id', 'meta', 'author', 'templateVersion', 'schemaVersion', '_fromSpace'] as const;

/** A view template as the body of a route: its own root, without the template's bookkeeping. */
function asBody(view: TemplateSchema): SchemaNode {
  const body = { ...view } as Record<string, unknown>;
  for (const key of TEMPLATE_ONLY) delete body[key];
  return body as SchemaNode;
}

/**
 * Every view that can draw a record here, the more specific first and each type once: the template's
 * map, then the views that say they draw a type. A map entry naming a view by id that is not here is
 * skipped rather than drawn as nothing.
 */
export function recordViewCandidates(
  template: Pick<TemplateSchema, 'meta'> | undefined,
  views: readonly ResolvedView[],
): RecordViewCandidate[] {
  const found: RecordViewCandidate[] = [];
  const taken = new Set<string>();
  const add = (draws: RecordViewDraws, node: SchemaNode) => {
    const key = `${draws.entity}:${draws.kind ?? ''}`;
    if (taken.has(key)) return;
    taken.add(key);
    found.push({ entity: draws.entity, ...(draws.kind ? { kind: draws.kind } : {}), node });
  };

  for (const [key, value] of Object.entries(template?.meta?.recordViews ?? {})) {
    const draws = parseRecordViewKey(key);
    if (!draws) continue;
    if (typeof value === 'string') {
      const view = views.find((candidate) => candidate.id === value);
      if (view) add(draws, asBody(view.schema));
    } else if (value && typeof value === 'object') {
      add(draws, value);
    }
  }
  for (const view of views) {
    const draws = view.schema.meta?.draws;
    if (draws?.entity) add(draws, asBody(view.schema));
  }
  // A view for a kind is more specific than one for the whole entity, so it is asked first.
  return [...found.filter((c) => c.kind), ...found.filter((c) => !c.kind)];
}

/** The expression a candidate is chosen by: the entity in the path, and the kind in the address. */
function condition(candidate: RecordViewCandidate): string {
  const entity = `last(routeStore.segments) == '${candidate.entity}'`;
  return candidate.kind ? `${entity} && routeStore.params.kind == '${candidate.kind}'` : entity;
}

/**
 * The record page's body: each candidate in turn, and the generic page when none matches. Nothing to
 * choose between is the generic page itself, with no `$if` around it.
 */
export function recordRouteBody(generic: SchemaNode, candidates: readonly RecordViewCandidate[]): SchemaNode {
  return candidates.reduceRight<SchemaNode>(
    (otherwise, candidate) => ({
      type: '$if',
      props: { condition: { $: condition(candidate) }, then: candidate.node, else: otherwise },
    }),
    generic,
  );
}
