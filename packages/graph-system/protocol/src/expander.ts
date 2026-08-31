/**
 * The expander contract — the graph system's primary extension point.
 *
 * "Show the whole perspective", "map these query results", "open this collection's children", "zoom a
 * model out into its properties", "explore spaces and neighbourhoods" are not five features. They are
 * one: a lazily-explored frontier, where each *kind* of node knows what is adjacent to it. An
 * expander answers that question for the kinds it claims, and the core does the rest — dedup,
 * expansion state, collapse, layout, rendering.
 *
 * A module adding a new source of nodes writes an expander and (optionally) a renderer. Nothing in
 * the core changes. That is the whole design.
 *
 * ## Why expansion is paged
 *
 * A hub node with four thousand neighbours must not be able to kill the frame on one click. The core
 * needs `total` back to offer "expanding adds 4,231 — top 50 / all", which is only possible if paging
 * is in the contract from the first version. Retrofitting it means every expander written before the
 * change is a lie about its own cost.
 *
 * ## Why this is not graph-specific
 *
 * `expand(id) -> neighbours` is what a tree view, a nested picker and a breadcrumb trail also want.
 * It lives here for now because there is one consumer; when a second appears it should move to a
 * package of its own rather than have that consumer depend on the graph.
 */
import type { GraphFragment } from './graph';

/** Which way an expansion walks. */
export type ExpandDirection =
  /** Follow this node's own relations — what it points at. */
  | 'out'
  /** Follow relations that point *at* this node. Half of what makes a map explorable rather than a
   *  one-directional tree, and cheap on a link-shaped backend. */
  | 'in'
  /** Both, merged. */
  | 'both';

export interface ExpandRequest {
  /** Address of the node being expanded. */
  id: string;
  direction: ExpandDirection;
  /** Page size. An expander that cannot page should return everything and set `total`. */
  limit?: number;
  /** Opaque continuation from a previous {@link ExpandResult}. */
  cursor?: string;
  /**
   * Restrict to these edge types (relation names / predicates). Absent means all.
   * Filtering here rather than after the fact keeps the wire cost proportional to what is shown.
   */
  edgeTypes?: string[];
  /** Cancellation — expansion is user-driven, and users navigate away mid-flight. */
  signal?: AbortSignal;
}

export interface ExpandResult extends GraphFragment {
  /**
   * How many neighbours exist in total, if the expander can say cheaply.
   *
   * `undefined` means unknown, which the core must render as "unknown" rather than as `nodes.length`.
   * A count that is silently the page size is the failure this field exists to prevent.
   */
  total?: number;
  /** Present iff more remain. */
  cursor?: string;
}

/**
 * What an expander needs from the host to do its job.
 *
 * Ports only — never a host object, and never a backend SDK. An expander that reaches AD4M directly
 * is a coupled expander, which is allowed (declare it on the module) but must be a deliberate act
 * rather than something that happens because the context handed it the means.
 */
export interface ExpanderContext {
  /**
   * Run a read against the data layer. The neutral query shape the renderer already speaks, so an
   * expander needs no backend knowledge to fetch entities.
   */
  query(request: ExpanderQuery): Promise<Record<string, unknown>[]>;
  /** The dataset id to use when none is named — normally the space currently open. */
  defaultDataset(): string | null;
  /** Entity shapes available in a dataset, for expanders that work off the schema rather than a fixed model. */
  models(dataset?: string): EntityShape[];
  /**
   * Ask to be told when a read's answer changes, and get back a function that stops the watch.
   *
   * **The whole read, not just the type.** This was coarse — entity and dataset only — on the
   * reasoning that the signal is "look again" and the engine's answer is to re-run its seeds, which
   * is idempotent. The reasoning was sound and the premise was not: a host implements this over
   * whatever change notification its backend has, and a backend that reports "this query's answer
   * changed" cannot report anything about a query nobody asked. WE's does exactly that — its model
   * subscriptions fire only when the rows of *their own* query change — so a coarse watch was
   * subscribed to a one-row probe over the whole type, and a record created behind an existing one
   * left that probe's answer identical. The board that read it never heard, and stayed as loaded
   * while the panel beside it, subscribed to its own narrower query, updated.
   *
   * So a watch carries the read it came from, and a host subscribes to *that*. The cost the coarse
   * form was avoiding — one subscription per distinct read — is what makes the answer trustworthy,
   * and it is bounded by what the seeds actually asked for: a board makes four.
   *
   * Optional because it is a *capability*, not a requirement: a host with no change notification
   * (a fixture, a static export) simply omits it and the graph stays as loaded. Nothing calls this
   * directly — the engine derives what to watch from the reads its seeds performed.
   */
  watch?(request: WatchQuery, onChange: () => void): () => void;
  /** Structured, non-fatal reporting. An expander that cannot answer says so; it does not throw. */
  warn(message: string): void;
}

/** A read an expander asks for, in neutral terms. */
export interface ExpanderQuery {
  entity: string;
  dataset?: string;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
  /** Drill down from an anchor instance through one of its relations. */
  scope?: { anchor: string; via: string; anchorId: string; direction?: 'in' | 'out' };
  signal?: AbortSignal;
}

/**
 * A read to be watched: the query as it was asked, less the abort signal.
 *
 * The signal belongs to the load that made the read and is already spent by the time anything
 * subscribes; carrying it would tie a standing watch to a cancelled fetch.
 */
export type WatchQuery = Omit<ExpanderQuery, 'signal'>;

/**
 * An entity type as the engine sees it — the neutral projection of whatever the backend calls a
 * schema. Enough to build a generic node from an instance nobody wrote code for.
 */
export interface EntityShape {
  name: string;
  /** Scalar fields, in declaration order. */
  properties: { name: string; type: 'string' | 'number' | 'boolean' | 'uri'; required?: boolean }[];
  /** Typed relations — the edges of a schema-derived graph. */
  relations: { name: string; target: string; cardinality: 'one' | 'many' }[];
  /**
   * The property that best names an instance, where the backend declares one.
   * Used as the default label; falls back to a heuristic when absent.
   */
  identityProperty?: string;
  /** Human description of the type, where the backend has one. Shown in legends and tooltips. */
  description?: string;
}

/**
 * A registered expander.
 *
 * `id` is what a template names to enable it. `kinds` and `types` decide dispatch: an expander claims
 * the structural kinds it handles, and optionally narrows to specific semantic types.
 */
export interface Expander {
  id: string;
  /** Structural node kinds this expands. */
  kinds: string[];
  /** Semantic types to narrow to. Absent means every type of the claimed kinds. */
  types?: string[];
  /**
   * Ordering when several expanders claim the same node. Higher wins the *primary* slot; all matching
   * expanders still run, and their results merge by address.
   */
  priority?: number;
  description?: string;
  expand(request: ExpandRequest, context: ExpanderContext): Promise<ExpandResult>;
}

/** Factory form, so a template can configure an expander with options. */
export type ExpanderFactory<TOptions = unknown> = (options?: TOptions) => Expander;

/**
 * A seed source: where a graph starts, before anything is expanded.
 *
 * Same shape as an expansion minus the anchor. A static diagram is this and nothing else — which is
 * why authoring a flowchart does not require thinking about exploration at all.
 */
export interface SeedSource {
  id: string;
  description?: string;
  seed(options: unknown, context: ExpanderContext, signal?: AbortSignal): Promise<ExpandResult>;
}
