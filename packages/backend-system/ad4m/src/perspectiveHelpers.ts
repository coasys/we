import { Ad4mModel, type PerspectiveProxy, type SHACLShape } from '@coasys/ad4m';
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

/**
 * Every registered shape's properties — path, and name where the shape gives one — in the order
 * `shapes()` lists the classes (by name). One round trip however many shapes there are.
 *
 * A class with no properties is left out: it has nothing to offer a caller that maps predicates.
 */
export async function readShapeProperties(
  perspective: PerspectiveProxy,
): Promise<{ name: string; properties: { path: string; name?: string }[] }[]> {
  const registered = await perspective.shapes();
  return registered
    .filter(({ shape }) => shape.properties.length > 0)
    .map(({ name, shape }) => ({
      name,
      properties: shape.properties.map((p) => ({ path: p.path, ...(p.name !== undefined ? { name: p.name } : {}) })),
    }));
}

/**
 * Whether a target class is one the executor registers for its own bookkeeping — a flow's runs and
 * proposals, an extraction run, the auto-processor's claim. Every one is minted under `ad4m://`, and no
 * app's model is. They are the executor's state rather than anybody's data, so they are not another
 * app's models: listed as such, a space's vocabulary offered `FlowInstance` and `AutoProcessor` as
 * things to look at, and every AI turn described them as part of the space.
 */
const isExecutorClass = (targetClass: string | null | undefined): boolean =>
  typeof targetClass === 'string' && targetClass.startsWith('ad4m://');

/**
 * Fetch SHACL shapes that the perspective has but WE does not know about natively.
 *
 * A shape is foreign when no native model has its name, or when it takes a native name over a
 * different target class. `shapes()` returns every registered class with its whole shape in one
 * call, so the rule is applied to the shapes as the executor stores them.
 *
 * The executor's own classes are left out — see {@link isExecutorClass}.
 *
 * Callers that need both the entity classes (`buildEntityClasses`) and the AI
 * manifest (`buildEntityManifest`) for the same perspective should fetch here
 * once and pass the result to both — they are pure, synchronous transforms of
 * this data, not separate fetches.
 */
export async function getForeignShacl(perspective: PerspectiveProxy): Promise<ForeignShape[]> {
  const registered = await perspective.shapes();
  const nativeNames = new Set(getRegisteredEntityNames());
  const nativeTargetClass = (name: string) => getEntityTargetClass(getEntity(name));
  return registered
    .filter(
      ({ name, shape }) =>
        !isExecutorClass(shape.targetClass) &&
        (!nativeNames.has(name) || (shape.targetClass != null && shape.targetClass !== nativeTargetClass(name))),
    )
    .map(({ name, shape }) => ({ name, shape }));
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
        // The shape says which end owns the link, so an entry read back from storage keeps it.
        ...(p.relationKind?.startsWith('belongsTo') && { reverse: true }),
        ...(p.interpretationHint !== undefined && { interpretationHint: p.interpretationHint }),
        ...(p.identity ? { identity: true } : {}),
      })),
  }));
}
