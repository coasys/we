/**
 * Read and write the interpretation hints stored on a perspective's SHACL shapes — the mechanism
 * behind per-space hint customization.
 *
 * The executor assembles extraction prompts from the shapes stored in the perspective, not from
 * the model classes — so the space is already the override point for hints. The contract splits two
 * regimes: **structure stays code-owned** (every registration sends the model's declared structure),
 * **interpretation metadata becomes space-owned once a space customizes it** — a marker link on the
 * shape node records the customization.
 *
 * Hints are part of a shape as the executor stores it (`ad4m://interpretation_hint` on the shape and
 * property nodes), so a hint is written the way a shape is: read the stored shape with `shapes()`,
 * change its hints, and give it back to `registerShapes`, which writes only the changed hints. The
 * marker is a link of WE's own; the executor keeps it when it rewrites the shape. Registration reads
 * the marker and sends a marked shape with its stored hints (see `registerModels` in
 * `sdnaEntities.ts`), so the community's tuning outlives a release that changes the model's
 * structure. A hint on a property the new shape no longer has has nowhere to go, and is lost with the
 * property.
 */
import { Link, LinkQuery, Literal, type PerspectiveProxy, SHACLShape } from '@coasys/ad4m';
import type { EntityHintState } from '@we/backend-shared';
import { getEntityForDataset, getEntityTargetClass } from '@we/entities';

import { ensureEntityRegistered, HINTS_CUSTOMIZED_PREDICATE, storedShapeOf } from './sdnaEntities';

/** The names of the properties the entity's model declares: the contract's property names. */
function declaredNames(entity: string, p: PerspectiveProxy): Set<string> {
  const names = new Set<string>();
  const model = getEntityForDataset(entity, p) as
    { generateSHACL?: () => { shape?: { properties?: { name?: string }[] } } } | undefined;
  try {
    for (const property of model?.generateSHACL?.().shape?.properties ?? []) {
      if (property.name) names.add(property.name);
    }
  } catch {
    // A model that cannot describe itself has no names to offer; its hints read as none.
  }
  return names;
}

/** The entity's stored shape, or null when the entity is unknown or its class has no shape here. */
async function storedShape(p: PerspectiveProxy, entity: string): Promise<SHACLShape | null> {
  const model = getEntityForDataset(entity, p);
  const targetClass = model ? getEntityTargetClass(model) : undefined;
  return targetClass ? storedShapeOf(p, targetClass) : null;
}

/** Replace every link `source -[predicate]-> *` with one carrying `value`; empty value = remove only. */
async function replaceLink(p: PerspectiveProxy, source: string, predicate: string, value: string | null) {
  const existing = await p.get(new LinkQuery({ source, predicate }));
  if (existing.length) await p.removeLinks(existing);
  if (value) await p.add(new Link({ source, predicate, target: Literal.from(value).toUrl() }));
}

/** The hints currently stored on the perspective for one entity, or null when it has no shape. */
export async function readInterpretationHints(p: PerspectiveProxy, entity: string): Promise<EntityHintState | null> {
  const shape = await storedShape(p, entity);
  if (!shape) return null;
  const marker = await p.get(new LinkQuery({ source: shape.nodeShapeUri, predicate: HINTS_CUSTOMIZED_PREDICATE }));
  const names = declaredNames(entity, p);
  const propHints: Record<string, string> = {};
  for (const property of shape.properties) {
    if (property.name && names.has(property.name) && property.interpretationHint !== undefined) {
      propHints[property.name] = property.interpretationHint;
    }
  }
  return {
    ...(shape.interpretationHint !== undefined ? { classHint: shape.interpretationHint } : {}),
    propHints,
    customized: marker.length > 0,
  };
}

/**
 * Write hint customizations for one entity and mark the shape customized.
 *
 * Only the keys present are touched (a partial update); an empty-string hint removes that hint.
 * `propHints` is keyed by property name. Throws when the entity has no stored shape — customizing what
 * is not installed would succeed silently and do nothing, which is the worse failure.
 *
 * The marker goes first. If the shape write then fails, the marker only keeps the hints that were
 * already stored; the other order could leave tuned hints with no marker, and the next switch would
 * put the declared hints back over them.
 */
export async function writeInterpretationHints(
  p: PerspectiveProxy,
  entity: string,
  hints: { classHint?: string; propHints?: Record<string, string> },
): Promise<void> {
  const stored = await storedShape(p, entity);
  if (!stored) throw new Error(`writeInterpretationHints: no stored shape for "${entity}" in this dataset`);

  const shape = SHACLShape.fromJSON(stored.toJSON());
  if (hints.classHint !== undefined) {
    if (hints.classHint) shape.interpretationHint = hints.classHint;
    else delete shape.interpretationHint;
  }
  for (const [name, hint] of Object.entries(hints.propHints ?? {})) {
    const property = shape.properties.find((p) => p.name === name);
    if (!property) throw new Error(`writeInterpretationHints: "${entity}" has no stored property called ${name}`);
    if (hint) property.interpretationHint = hint;
    else delete property.interpretationHint;
  }

  await replaceLink(p, shape.nodeShapeUri, HINTS_CUSTOMIZED_PREDICATE, 'true');
  await p.registerShapes([shape]);
}

/**
 * Reset one entity's hints to what its model class declares, and clear the customized marker —
 * the "reset to default" affordance, and how a space resumes receiving hint improvements from
 * releases after having customized.
 *
 * Unmarked, the shape registers as the model declares it, hints included.
 */
export async function resetInterpretationHints(p: PerspectiveProxy, entity: string): Promise<void> {
  const model = getEntityForDataset(entity, p);
  const stored = await storedShape(p, entity);
  if (!model || !stored) return;
  await replaceLink(p, stored.nodeShapeUri, HINTS_CUSTOMIZED_PREDICATE, null);
  await ensureEntityRegistered(p, model as never);
}
