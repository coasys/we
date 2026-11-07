import { Ad4mModel, type PerspectiveProxy, type SHACLShape } from '@coasys/ad4m';
import { type EntityClass, getEntity, getEntityTargetClass, getRegisteredEntityNames } from '@we/entities';

import { classNameOf } from './className';
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
 * A shape is foreign when no native model has its target class. `shapes()` returns every registered
 * class with its whole shape in one call, so the rule is applied to the shapes as the executor stores
 * them.
 *
 * **Named so that no two classes share a name in WE.** The executor addresses a class by its target
 * class IRI, so two apps may each have a class of one name: WE's `Topic` is `we://Topic`, Flux's is
 * `flux://Topic`, and one perspective holds both. WE's entity registry is keyed by name, and a native
 * class wins a name over a foreign one, so a foreign `Topic` registered as `Topic` could never be
 * reached — and a template asking for `Topic` would read WE's. A foreign class keeps its own name
 * where that name is free (no native model has it and no other foreign class does); otherwise it is
 * named by its target class IRI, which is unique by construction.
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
  const nativeTargetClasses = new Set(
    [...nativeNames].map((name) => getEntityTargetClass(getEntity(name))).filter((c): c is string => Boolean(c)),
  );
  const foreign = registered.filter(
    ({ shape }) =>
      !isExecutorClass(shape.targetClass) && !(shape.targetClass && nativeTargetClasses.has(shape.targetClass)),
  );
  const perName = new Map<string, number>();
  for (const { name } of foreign) perName.set(name, (perName.get(name) ?? 0) + 1);
  return foreign.map(({ name, shape }) => {
    const free = !nativeNames.has(name) && perName.get(name) === 1;
    return { name: free || !shape.targetClass ? name : shape.targetClass, shape };
  });
}

/**
 * Synthesise a ready-to-use `Ad4mModel` subclass for every *foreign* SHACL shape
 * given (WE-native models are already registered globally at module load and
 * never need runtime synthesis — see `getForeignShacl`, whose result this expects).
 *
 * Each class is built under its local name, the class name the executor gives it, so it keeps the
 * shape's target class (`fromSHACL` reads the namespace off the target class by that name) and the
 * executor addresses it by that IRI. It is registered under the name `getForeignShacl` chose, which is
 * the target class IRI where the local name is taken.
 *
 * A lazy class resolver is passed to `fromSHACL` so that collection relations
 * with a `sh:class` URI get a proper `target` thunk wired up.  Because the
 * resolver closes over the `byLocalName` map (which is still being populated
 * during the loop), and `target` is only evaluated at query time, this
 * correctly handles all cross-model references without ordering concerns. The resolver is given a
 * local name (`fromSHACL` strips the IRI), so it answers among these foreign classes: a foreign
 * relation to `Topic` means the foreign app's own `Topic`, not WE's.
 *
 * The returned record can be passed directly to `registerDynamicEntities()`.
 */
export function buildEntityClasses(shapes: ForeignShape[]): Record<string, EntityClass> {
  const result: Record<string, EntityClass> = {};
  // The resolver supports both "Message" and "MessageShape" keys so that
  // sh:class URIs (which use nodeShapeUri = "flux://MessageShape") resolve correctly.
  const byLocalName: Record<string, typeof Ad4mModel> = {};
  const classResolver = (localName: string) => byLocalName[localName];
  // A name two of the given shapes share is no class's own: keyed by it, the second class would
  // overwrite the first. Each such class is reached by its target class IRI instead.
  const perName = new Map<string, number>();
  for (const { name } of shapes) perName.set(name, (perName.get(name) ?? 0) + 1);
  for (const { name, shape } of shapes) {
    const local = shape.targetClass ? classNameOf(shape.targetClass) : name;
    const cls = Ad4mModel.fromSHACL(shape, local, classResolver);
    byLocalName[local] ??= cls;
    byLocalName[`${local}Shape`] ??= cls;
    const shared = perName.get(name)! > 1;
    if (!shared || !shape.targetClass) result[name] ??= cls;
    // Every class is also keyed by its target class IRI, which is unique by construction, so a class
    // is always reachable by the key the executor names it with.
    if (shape.targetClass) result[shape.targetClass] ??= cls;
    // Also register under nodeShapeUri-style name (e.g. "MessageShape") so that
    // sh:class URI local-names resolve even when they include the "Shape" suffix.
    if (!shared && name === local) result[`${name}Shape`] ??= cls;
  }
  return result;
}

/**
 * Build a normalised, AI-friendly manifest of every *foreign* shape given
 * (WE-native models are already fully documented in the AI's own system prompt,
 * so they're excluded — see `getForeignShacl`, whose result this expects). Flag
 * properties (`hasValue`) and unnamed properties are excluded. Suitable for
 * injection into an AI system prompt as `externalEntities`.
 *
 * A relation's `relatedEntity` is the name its target goes by here: a foreign class among `shapes`
 * where `sh:class` names one (by target class or by shape), so a relation to Flux's `Topic` names
 * the entity `getForeignShacl` registered it under rather than WE's `Topic`.
 */
export function buildEntityManifest(shapes: ForeignShape[]): EntityManifestEntry[] {
  const entityOf = new Map<string, string>();
  for (const { name, shape } of shapes) {
    if (shape.targetClass) entityOf.set(shape.targetClass, name);
    if (shape.nodeShapeUri) entityOf.set(shape.nodeShapeUri, name);
  }
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
        ...(p.class !== undefined && { relatedEntity: entityOf.get(p.class) ?? shaclClassToLocalName(p.class) }),
        // The shape says which end owns the link, so an entry read back from storage keeps it.
        ...(p.relationKind?.startsWith('belongsTo') && { reverse: true }),
        ...(p.interpretationHint !== undefined && { interpretationHint: p.interpretationHint }),
        ...(p.identity ? { identity: true } : {}),
      })),
  }));
}
