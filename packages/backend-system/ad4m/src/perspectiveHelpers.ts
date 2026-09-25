import { Ad4mModel, Literal, type PerspectiveProxy, type SHACLShape } from '@coasys/ad4m';
import { type EntityClass, getEntity, getEntityTargetClass, getRegisteredEntityNames } from '@we/entities';

import type { EntityManifestEntry, EntityManifestProperty } from './manifestTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Map a SHACL datatype URI / nodeKind to one of the four scalar slot types
 * used in `EntityManifestProperty.type`.
 */
function normaliseShaclType(datatype?: string, nodeKind?: string): 'string' | 'number' | 'boolean' | 'uri' {
  if (nodeKind === 'IRI') return 'uri';
  if (!datatype) return 'string';
  const dt = datatype.toLowerCase();
  if (
    dt.includes('integer') ||
    dt.includes('int') ||
    dt.includes('decimal') ||
    dt.includes('float') ||
    dt.includes('double')
  )
    return 'number';
  if (dt.includes('boolean')) return 'boolean';
  return 'string';
}

/** Strip a URI down to its local name: "flux://Message" → "Message" */
function shaclClassToLocalName(classUri: string): string {
  const hash = classUri.lastIndexOf('#');
  const slash = classUri.lastIndexOf('/');
  const sep = Math.max(hash, slash);
  return sep >= 0 ? classUri.slice(sep + 1) : classUri;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export type ForeignShape = { name: string; shape: SHACLShape };

/*
  Why the shape registry is read with SPARQL rather than `getAllShacl()`.

  The client the app runs comes from `@coasys/ad4m-connect`, which bundles its own copy of
  `@coasys/ad4m` — not the one this package depends on. In that copy `getAllShacl()` is not one
  call: it lists the names, then reads every shape with `getShacl()`, at three round trips plus one
  per property. A space with ~40 shapes paid ~650 `queryLinks` on every load to keep the handful
  that are foreign, and a remote executor queued them for seconds.

  What a caller here needs to know about most shapes is a few links each — name → shape → target
  class, shape → property → path — so one SPARQL query answers it for every shape at once, and a
  shape is read in full only when it has to be.
*/

/** Every installed shape's name node, shape and target class. */
const SHAPE_INDEX = `SELECT ?name ?shape ?targetClass WHERE {
  ?name <ad4m://shacl_shape_uri> ?shape .
  OPTIONAL { ?shape <sh://targetClass> ?targetClass }
}`;

/** Every installed shape's property shapes and their paths. */
const SHAPE_PROPERTIES = `SELECT ?name ?prop ?path WHERE {
  ?name <ad4m://shacl_shape_uri> ?shape .
  ?shape <sh://property> ?prop .
  ?prop <sh://path> ?path .
}`;

type Row = Record<string, string | undefined>;

async function select(perspective: PerspectiveProxy, query: string): Promise<Row[]> {
  const rows = await perspective.querySparql(query);
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/** `literal:string:shacl://TaskBlock` → `TaskBlock`, decoded as `getShaclNames()` decodes it. */
function shapeName(nameNode: string | undefined): string | undefined {
  if (!nameNode) return undefined;
  try {
    const value = Literal.fromUrl(nameNode).get();
    return typeof value === 'string' ? value.replace('shacl://', '') : undefined;
  } catch {
    return undefined;
  }
}

/** A property's name as `SHACLShape.fromLinks` derives it: what follows the last `.` of its shape. */
function propertyName(propShape: string): string | undefined {
  if (propShape.startsWith('_:')) return undefined;
  const dot = propShape.lastIndexOf('.');
  return dot === -1 ? undefined : propShape.slice(dot + 1);
}

/**
 * Every installed shape's properties — path, and name where the shape gives one — in the order
 * `getShaclNames()` lists the shapes. Two round trips however many shapes there are.
 */
export async function readShapeProperties(
  perspective: PerspectiveProxy,
): Promise<{ name: string; properties: { path: string; name?: string }[] }[]> {
  const [names, rows] = await Promise.all([perspective.getShaclNames(), select(perspective, SHAPE_PROPERTIES)]);
  const byShape = new Map<string, { path: string; name?: string }[]>();
  for (const row of rows) {
    const shape = shapeName(row.name);
    if (!shape || !row.prop || !row.path) continue;
    byShape.set(shape, [...(byShape.get(shape) ?? []), { path: row.path, name: propertyName(row.prop) }]);
  }
  return names.flatMap((name) => (byShape.has(name) ? [{ name, properties: byShape.get(name)! }] : []));
}

/**
 * Fetch SHACL shapes that the perspective has but WE does not know about natively.
 *
 * A shape is foreign when no native model has its name, or when it takes a native name over a
 * different target class. The index answers that for every shape in one query, so only foreign
 * shapes are read in full, and a native name is read only when the index says it might be one.
 *
 * Callers that need both the entity classes (`buildEntityClasses`) and the AI
 * manifest (`buildEntityManifest`) for the same perspective should fetch here
 * once and pass the result to both — they are pure, synchronous transforms of
 * this data, not separate fetches.
 */
export async function getForeignShacl(perspective: PerspectiveProxy): Promise<ForeignShape[]> {
  const [names, rows] = await Promise.all([perspective.getShaclNames(), select(perspective, SHAPE_INDEX)]);
  const nativeNames = new Set(getRegisteredEntityNames());
  const nativeTargetClass = (name: string) => getEntityTargetClass(getEntity(name));

  const storedClasses = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = shapeName(row.name);
    if (name && row.targetClass) storedClasses.set(name, (storedClasses.get(name) ?? new Set()).add(row.targetClass));
  }
  const worthReading = (name: string) =>
    !nativeNames.has(name) || [...(storedClasses.get(name) ?? [])].some((c) => c !== nativeTargetClass(name));

  const read = await Promise.all(
    names.filter(worthReading).map(async (name) => {
      try {
        return { name, shape: await perspective.getShacl(name) };
      } catch (error) {
        // A shape this SDK cannot parse — a property transform a newer SDK encoded, say — costs
        // its own model, not every foreign model in the dataset.
        console.warn(`ad4m: shape "${name}" could not be read; no model is built for it`, error);
        return { name, shape: null };
      }
    }),
  );
  // The rule itself, on the shape as read: a native name counts only over a different target class.
  return read.filter(
    (s): s is ForeignShape =>
      !!s.shape &&
      (!nativeNames.has(s.name) || (s.shape.targetClass != null && s.shape.targetClass !== nativeTargetClass(s.name))),
  );
}

/**
 * Synthesise a ready-to-use `Ad4mModel` subclass for every *foreign* SHACL shape
 * given (WE-native models are already registered globally at module load and
 * never need runtime synthesis — see `getForeignShacl`, whose result this expects).
 *
 * A lazy class resolver is passed to `fromSHACL` so that collection relations
 * with a `sh:class` URI get a proper `target` thunk wired up.  Because the
 * resolver closes over the `result` object (which is still being populated
 * during the loop), and `target` is only evaluated at query time, this
 * correctly handles all cross-model references without ordering concerns.
 *
 * The returned record can be passed directly to `registerDynamicEntities()`.
 */
export function buildEntityClasses(shapes: ForeignShape[]): Record<string, EntityClass> {
  const result: Record<string, EntityClass> = {};
  // classResolver supports both "Message" and "MessageShape" keys so that
  // sh:class URIs (which use nodeShapeUri = "flux://MessageShape") resolve correctly.
  const classResolver = (localName: string) => result[localName] as typeof Ad4mModel | undefined;
  for (const { name, shape } of shapes) {
    const cls = Ad4mModel.fromSHACL(shape, name, classResolver) as unknown as EntityClass;
    result[name] = cls;
    // Also register under nodeShapeUri-style name (e.g. "MessageShape") so that
    // sh:class URI local-names resolve even when they include the "Shape" suffix.
    result[`${name}Shape`] = cls;
  }
  return result;
}

/**
 * Build a normalised, AI-friendly manifest of every *foreign* shape given
 * (WE-native models are already fully documented in the AI's own system prompt,
 * so they're excluded — see `getForeignShacl`, whose result this expects). Flag
 * properties (`hasValue`) and unnamed properties are excluded. Suitable for
 * injection into an AI system prompt as `externalEntities`.
 */
export function buildEntityManifest(shapes: ForeignShape[]): EntityManifestEntry[] {
  return shapes.map(({ name, shape }) => ({
    name,
    targetClass: shape.targetClass ?? '',
    ...(shape.interpretationHint !== undefined && { interpretationHint: shape.interpretationHint }),
    properties: shape.properties
      .filter((p) => p.hasValue === undefined && p.name !== undefined)
      .map((p): EntityManifestProperty => ({
        name: p.name!,
        predicate: p.path,
        type: normaliseShaclType(p.datatype, p.nodeKind),
        isCollection: p.maxCount === undefined || p.maxCount > 1,
        required: (p.minCount ?? 0) >= 1,
        writable: p.writable ?? true,
        ...(p.resolveLanguage !== undefined && { resolveLanguage: p.resolveLanguage }),
        ...(p.class !== undefined && { relatedEntity: shaclClassToLocalName(p.class) }),
        ...(p.interpretationHint !== undefined && { interpretationHint: p.interpretationHint }),
        ...(p.identity ? { identity: true } : {}),
      })),
  }));
}
