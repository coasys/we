import { Ad4mModel, type PerspectiveProxy } from '@coasys/ad4m';
import type { ModelClass } from '@shared/registries/modelRegistry';

import type { ModelManifestEntry, ModelManifestProperty } from './AdamStore';

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

/**
 * Synthesise a ready-to-use `Ad4mModel` subclass for every SHACL shape stored
 * in the given perspective.  Calls `getAllShacl()` then `Ad4mModel.fromSHACL()`
 * for each entry.
 *
 * A lazy class resolver is passed to `fromSHACL` so that collection relations
 * with a `sh:class` URI get a proper `target` thunk wired up.  Because the
 * resolver closes over the `result` object (which is still being populated
 * during the loop), and `target` is only evaluated at query time, this
 * correctly handles all cross-model references without ordering concerns.
 *
 * The returned record can be passed directly to `registerDynamicModels()`.
 */
export async function getModelClasses(perspective: PerspectiveProxy): Promise<Record<string, ModelClass>> {
  const shapes = await perspective.getAllShacl();
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
 * Build a normalised, AI-friendly manifest of every model class in the given
 * perspective.  Flag properties (`hasValue`) and unnamed properties are
 * excluded.  Suitable for injection into an AI system prompt.
 */
export async function getModelManifest(perspective: PerspectiveProxy): Promise<ModelManifestEntry[]> {
  const shapes = await perspective.getAllShacl();
  return shapes.map(({ name, shape }) => ({
    name,
    targetClass: shape.targetClass ?? '',
    properties: shape.properties
      .filter((p) => p.hasValue === undefined && p.name !== undefined)
      .map(
        (p): ModelManifestProperty => ({
          name: p.name!,
          predicate: p.path,
          type: normaliseShaclType(p.datatype, p.nodeKind),
          isCollection: p.maxCount === undefined || p.maxCount > 1,
          required: (p.minCount ?? 0) >= 1,
          writable: p.writable ?? true,
          ...(p.resolveLiteral !== undefined && { resolveLiteral: p.resolveLiteral }),
          ...(p.class !== undefined && { relatedModel: shaclClassToLocalName(p.class) }),
        }),
      ),
  }));
}
