import { Ad4mModel, type PerspectiveProxy, type SHACLShape } from '@coasys/ad4m';
import { getModel, getModelTargetClass, getRegisteredModelNames, type ModelClass } from '@we/models';

import type { ModelManifestEntry, ModelManifestProperty } from './manifestTypes';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Map a SHACL datatype URI / nodeKind to one of the four scalar slot types
 * used in `ModelManifestProperty.type`.
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
 * Fetch SHACL shapes only for models the perspective has that WE doesn't already
 * know about natively. `getModelForPerspective` always prefers the globally
 * registered (WE-native) class over a per-perspective synthesised one, so fully
 * resolving a WE-native model's shape here — a multi-round-trip fetch via
 * `getShacl()` — would be pure wasted work: the result is never consulted.
 * `getShaclNames()` is a single cheap enumeration call, letting us skip the
 * expensive per-shape walk entirely for anything already in the global registry
 * (typically most of a perspective's shapes, for a space with no foreign apps).
 *
 * The bare `shacl://{name}` mapping ad4m-core uses is namespace-blind (e.g.
 * `we://Template` and `some-other-app://Template` both reduce to `"Template"`),
 * so a name matching the native registry isn't necessarily WE's own model — it
 * could be a different app's differently-namespaced model that happens to share
 * the same bare name. Names that don't match the native registry at all are
 * unambiguous (no shape with a different bare name could ever collide) and
 * skipped without any extra check. Only names that *do* match get the cheap
 * `getShaclTargetClass` disambiguation (two round trips, no property walk)
 * before deciding whether they're genuinely WE's own or a foreign namesake.
 *
 * Callers that need both the model classes (`buildModelClasses`) and the AI
 * manifest (`buildModelManifest`) for the same perspective should fetch here
 * once and pass the result to both — they're pure, synchronous transforms of
 * this data, not separate fetches.
 */
export async function getForeignShacl(perspective: PerspectiveProxy): Promise<ForeignShape[]> {
  const names = await perspective.getShaclNames();
  const nativeNames = new Set(getRegisteredModelNames());
  const definitelyForeign = names.filter((name) => !nativeNames.has(name));
  const ambiguous = names.filter((name) => nativeNames.has(name));

  // Both branches are independent of each other — a definitely-foreign name's full
  // fetch has no reason to wait on disambiguating the (unrelated) ambiguous names,
  // so run them concurrently rather than resolving one Promise.all before starting
  // the other.
  const [definitelyForeignResults, ambiguousResults] = await Promise.all([
    Promise.all(
      definitelyForeign.map(async (name) => {
        const shape = await perspective.getShacl(name);
        return shape ? { name, shape } : null;
      }),
    ),
    Promise.all(
      ambiguous.map(async (name) => {
        const shapeTargetClass = await perspective.getShaclTargetClass(name);
        const nativeTargetClass = getModelTargetClass(getModel(name));
        if (!shapeTargetClass || shapeTargetClass === nativeTargetClass) return null;
        // Genuinely foreign despite the bare-name collision — now pay for the full fetch.
        const shape = await perspective.getShacl(name);
        return shape ? { name, shape } : null;
      }),
    ),
  ]);

  return [...definitelyForeignResults, ...ambiguousResults].filter(
    (s): s is { name: string; shape: SHACLShape } => s !== null,
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
 * The returned record can be passed directly to `registerDynamicModels()`.
 */
export function buildModelClasses(shapes: ForeignShape[]): Record<string, ModelClass> {
  const result: Record<string, ModelClass> = {};
  // classResolver supports both "Message" and "MessageShape" keys so that
  // sh:class URIs (which use nodeShapeUri = "flux://MessageShape") resolve correctly.
  const classResolver = (localName: string) => result[localName] as typeof Ad4mModel | undefined;
  for (const { name, shape } of shapes) {
    const cls = Ad4mModel.fromSHACL(shape, name, classResolver) as unknown as ModelClass;
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
 * injection into an AI system prompt as `externalModels`.
 */
export function buildModelManifest(shapes: ForeignShape[]): ModelManifestEntry[] {
  return shapes.map(({ name, shape }) => ({
    name,
    targetClass: shape.targetClass ?? '',
    properties: shape.properties
      .filter((p) => p.hasValue === undefined && p.name !== undefined)
      .map((p): ModelManifestProperty => ({
        name: p.name!,
        predicate: p.path,
        type: normaliseShaclType(p.datatype, p.nodeKind),
        isCollection: p.maxCount === undefined || p.maxCount > 1,
        required: (p.minCount ?? 0) >= 1,
        writable: p.writable ?? true,
        ...(p.resolveLanguage !== undefined && { resolveLanguage: p.resolveLanguage }),
        ...(p.class !== undefined && { relatedModel: shaclClassToLocalName(p.class) }),
      })),
  }));
}
