import { datasetIdOf, HERE, parseRef } from '@we/backend-shared';
import { RECORD_ROUTE_PATH } from '@we/template-views';

/**
 * Where a record reference sends you, as a pure function over the reference and the route.
 *
 * Pure and separate for the reason `dockGeometry.ts` is: every previous failure of the record route
 * was two literals disagreeing, and none of them failed anything — an unmatched route lands on the
 * template's catch-all, which is a working page that says nothing about why. A decision worth
 * testing has to be reachable without a store, a router or a browser.
 *
 * Three callers share it — `spaceStore.openRecordRef`, a feature module through
 * `ModuleDatasetAccess.openRef`, and a composition's embed through `BlockHostValue.openRef` — and
 * they are all asking one question. Answering it three times is how the route and the link came to
 * disagree before `RECORD_ROUTE_PATH` became one literal.
 */
export interface RecordDestination {
  /** The space to go to — a neighbourhood CID or a dataset id, whichever the reference carried. */
  datasetId: string;
  /**
   * The part after `/space/<id>/`, or `undefined` to leave the section alone.
   *
   * Undefined means "the space itself", which is what a reference naming only a dataset is: a
   * gathered space's identity *is* its dataset, so there is no record to open.
   */
  view?: string;
}

/**
 * Resolve a reference against the route it is being followed from.
 *
 * `currentSegment` is the space segment of the URL — the second path segment, empty outside a
 * space. Taken from the route rather than from the current dataset on purpose: a shared space is
 * addressed by CID in the URL and by a local id in the store, so resolving a relative reference
 * against the dataset would silently rewrite the address bar from one form to the other and remount
 * the route on the way.
 *
 * `null` where there is nowhere to go:
 *
 * - **A person.** An agent has no page yet. A profile route is a real feature and not this one, and
 *   navigating somewhere arbitrary is worse than staying put.
 * - **A relative reference with no space open.** `we:./…` means "the dataset this is read in", so
 *   read outside a space it names nothing.
 * - **Anything unparseable**, which is ordinary: these come out of stored data, and a record written
 *   by an older version must degrade to "cannot follow this".
 */
export function resolveRecordRef(ref: string, currentSegment: string): RecordDestination | null {
  const parsed = parseRef(ref);
  if (!parsed || parsed.datasetKey === 'agent') return null;

  const datasetId = parsed.datasetKey === HERE ? currentSegment : datasetIdOf(parsed.datasetKey);
  if (!datasetId) return null;

  if (!parsed.entity || !parsed.id) return { datasetId };
  return { datasetId, view: recordView(parsed.entity, parsed.id) };
}

/**
 * The route a record's page sits at, below the space segment.
 *
 * Built from `RECORD_ROUTE_PATH` rather than restated, and with the leading slash stripped because
 * `navigateToSpace` joins the segment itself. The id is a query value because a record id is a URI
 * (`ad4m://obj/<x>`) and so several path segments — the route that expected one is why this shipped
 * broken twice.
 */
export function recordView(entity: string, id: string): string {
  return `${RECORD_ROUTE_PATH.replace(':entity', entity).replace(/^\//, '')}?id=${id}`;
}
