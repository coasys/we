/**
 * Node addressing — the one decision the rest of the graph system cannot recover from getting wrong.
 *
 * Every node the engine can hold needs a single stable identifier: an entity instance, one of its
 * properties, a literal value, a whole dataset, a synthetic cluster, a raw link target. They come
 * from different expanders that never meet, and they must still dedupe against each other, persist
 * positions against each other, and survive a graph that spans two datasets.
 *
 * So an address is a **string**, minted here and parsed here, and nowhere else. `@we/graph-core`
 * treats it as opaque — it compares addresses and reads {@link NodeAddress.kind}, never the rest.
 * That is what keeps the core free of any backend's notion of identity: the day a node comes from
 * NextGraph rather than AD4M, only the expander that mints it changes.
 *
 * ## Why a URI-shaped string rather than a struct
 *
 * A struct would be a nicer type and a worse key. Addresses are used as `Map` keys, `Set` members,
 * DOM ids, and persisted values on a board's nodes; every one of those wants a primitive. A struct
 * would mean a canonical-serialisation function that has to agree with itself everywhere, which is
 * the same string with extra steps and a new class of bug when two call sites serialise differently.
 *
 * ## Datasets in addresses
 *
 * `dataset` is present on entity-ish kinds because the holonic explorer expands *across* spaces, and
 * an address that assumed one dataset would make that a rewrite rather than a feature. It is the
 * dataset's **shared** id where there is one and the local id otherwise — see the note on
 * {@link entityAddress}.
 */

/**
 * What *sort of thing* a node is, structurally — as distinct from what it *means*
 * ({@link GraphNode.type}, which holds an entity class name, a property name, and so on).
 *
 * Renderers and style rules key on either. Keying only on the semantic type would leave property and
 * literal nodes unstyleable, since they have no entity class to name.
 */
export type NodeKind =
  /** An instance of an entity type, in some dataset. The common case. */
  | 'entity'
  /** One property of one instance, promoted to a node — the "zoom into a model" resolution level. */
  | 'property'
  /** A scalar value. Shared by every property node holding that value, which is what makes literals
   *  cluster: two beliefs with the same author converge on one author node. */
  | 'literal'
  /** A whole dataset — a space, a neighbourhood. The holonic explorer's node. */
  | 'dataset'
  /** A synthetic grouping the engine minted: a collapsed subtree, a community, a bucket. */
  | 'cluster'
  /** A raw graph node with no model behind it — a bare URI from the link level. */
  | 'resource';

/** A parsed address. Produced by {@link parseAddress}; never constructed by hand. */
export interface NodeAddress {
  kind: NodeKind;
  /** Dataset this node belongs to, where the kind has one. */
  dataset?: string;
  /** Entity type name (`entity`, `property`), or the cluster's generator (`cluster`). */
  type?: string;
  /** Instance id (`entity`, `property`), dataset id (`dataset`), URI (`resource`), hash (`literal`). */
  id?: string;
  /** Property name — `property` kind only. */
  property?: string;
}

const SCHEME = 'we-graph://';

/** Percent-encode the delimiters, so an id containing `/` cannot forge a longer address. */
function enc(segment: string): string {
  return encodeURIComponent(segment);
}

function dec(segment: string): string {
  return decodeURIComponent(segment);
}

/**
 * Address an entity instance.
 *
 * `dataset` should be the id that is **the same on every agent** when one exists — a shared/global
 * dataset id rather than a local uuid. Two peers looking at one shared space must produce identical
 * addresses, or a board's saved positions land on nodes only their author can see. Where a dataset is
 * purely local the local id is correct and the question does not arise.
 */
export function entityAddress(dataset: string, type: string, id: string): string {
  return `${SCHEME}entity/${enc(dataset)}/${enc(type)}/${enc(id)}`;
}

/** Address one property of one instance. */
export function propertyAddress(dataset: string, type: string, id: string, property: string): string {
  return `${SCHEME}property/${enc(dataset)}/${enc(type)}/${enc(id)}/${enc(property)}`;
}

/**
 * Address a scalar value.
 *
 * Deliberately *not* dataset-scoped: the point of a literal node is that everything holding that
 * value converges on it. Scoping it per dataset would give you one "2026-08-10" per space and lose
 * the only interesting thing a literal node does.
 */
export function literalAddress(value: string | number | boolean): string {
  return `${SCHEME}literal/${enc(String(value))}`;
}

/** Address a dataset itself — a space or neighbourhood as a node. */
export function datasetAddress(dataset: string): string {
  return `${SCHEME}dataset/${enc(dataset)}`;
}

/** Address a synthetic group. `generator` names what produced it (`collapse`, `louvain`, …). */
export function clusterAddress(generator: string, key: string): string {
  return `${SCHEME}cluster/${enc(generator)}/${enc(key)}`;
}

/** Address a bare URI from the link level, with no model behind it. */
export function resourceAddress(uri: string): string {
  return `${SCHEME}resource/${enc(uri)}`;
}

/**
 * Parse an address, or `null` if it is not one.
 *
 * Returns `null` rather than throwing because addresses arrive from persisted board data and from
 * expanders written by other people: an unreadable one should drop a node, not take down a render.
 */
export function parseAddress(address: string): NodeAddress | null {
  if (!address.startsWith(SCHEME)) return null;
  const [kind, ...rest] = address.slice(SCHEME.length).split('/');
  switch (kind) {
    case 'entity':
      return rest.length === 3 ? { kind, dataset: dec(rest[0]), type: dec(rest[1]), id: dec(rest[2]) } : null;
    case 'property':
      return rest.length === 4
        ? { kind, dataset: dec(rest[0]), type: dec(rest[1]), id: dec(rest[2]), property: dec(rest[3]) }
        : null;
    case 'literal':
      return rest.length === 1 ? { kind, id: dec(rest[0]) } : null;
    case 'dataset':
      return rest.length === 1 ? { kind, dataset: dec(rest[0]), id: dec(rest[0]) } : null;
    case 'cluster':
      return rest.length === 2 ? { kind, type: dec(rest[0]), id: dec(rest[1]) } : null;
    case 'resource':
      return rest.length === 1 ? { kind, id: dec(rest[0]) } : null;
    default:
      return null;
  }
}

/**
 * The structural kind of an address, without allocating a parse.
 *
 * The core reads this on every node on every frame-ish operation (styling, renderer dispatch), so it
 * avoids the split/decode that {@link parseAddress} does.
 */
export function addressKind(address: string): NodeKind | null {
  if (!address.startsWith(SCHEME)) return null;
  const end = address.indexOf('/', SCHEME.length);
  const kind = end === -1 ? address.slice(SCHEME.length) : address.slice(SCHEME.length, end);
  switch (kind) {
    case 'entity':
    case 'property':
    case 'literal':
    case 'dataset':
    case 'cluster':
    case 'resource':
      return kind;
    default:
      return null;
  }
}
