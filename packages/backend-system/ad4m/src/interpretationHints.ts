/**
 * Read and write the interpretation hints stored on a perspective's SHACL shapes — the mechanism
 * behind per-space hint customization.
 *
 * The executor assembles extraction prompts from the shapes stored in the perspective, not from
 * the model classes — so the space is already the override point for hints. What stood in the way
 * was `shapeIsStale`, which rewrites a stored shape whenever it differs from the class declaration
 * and would revert any community-tuned hint on the next space switch. The contract here splits the
 * two regimes: **structure stays code-owned** (paths and the identity key are still stale-checked),
 * **interpretation metadata becomes space-owned once a space customizes it** — a marker link on the
 * shape node records the customization, and the staleness check yields to it.
 *
 * Known v1 edge, deliberate: a *structural* refresh (the model gained a property) rewrites the
 * whole shape graph, dropping both the customized hints and the marker. Structure changes ship in
 * releases and are rare; the settings surface re-offers customization afterwards. Preserving
 * customizations across structural rewrites needs the merge story the shape-versioning design note
 * owns, not a quick fix here.
 */
import { Link, LinkQuery, Literal, type PerspectiveProxy } from '@coasys/ad4m';
import type { EntityHintState } from '@we/backend-shared';
import { getEntitiesForPerspective, getEntityTargetClass } from '@we/entities';

import { declaredShape } from './sdnaEntities';

/** Marker on the shape node: this shape's hints were tuned by the space and must not be reverted. */
export const HINTS_CUSTOMIZED_PREDICATE = 'we://interpretation_customized';
const HINT_PREDICATE = 'ad4m://interpretation_hint';

/** Hints are stored literal-encoded; a raw target is returned as-is. */
function decodeLiteral(value: string): string {
  if (!value.startsWith('literal:')) return value;
  try {
    return String(Literal.fromUrl(value).get());
  } catch {
    return value;
  }
}

/** The shape node and its property nodes (keyed by path) for one entity, or null when absent. */
async function locateShape(
  p: PerspectiveProxy,
  entity: string,
): Promise<{ shapeUri: string; propNodes: Map<string, string> } | null> {
  const model = getEntitiesForPerspective(entity, p);
  const targetClass = model ? getEntityTargetClass(model) : undefined;
  if (!targetClass) return null;

  const shapeLinks = await p.get(new LinkQuery({ source: targetClass, predicate: 'ad4m://shape' }));
  const shapeUri = shapeLinks[0]?.data.target;
  if (!shapeUri) return null;

  const propNodes = new Map<string, string>();
  const propLinks = await p.get(new LinkQuery({ source: shapeUri, predicate: 'sh://property' }));
  await Promise.all(
    propLinks.map(async (link) => {
      const pathLinks = await p.get(new LinkQuery({ source: link.data.target, predicate: 'sh://path' }));
      const path = pathLinks[0]?.data.target;
      if (path) propNodes.set(path, link.data.target);
    }),
  );
  return { shapeUri, propNodes };
}

/** Replace every link `source -[predicate]-> *` with one carrying `value`; empty value = remove only. */
async function replaceLink(p: PerspectiveProxy, source: string, predicate: string, value: string | null) {
  const existing = await p.get(new LinkQuery({ source, predicate }));
  if (existing.length) await p.removeLinks(existing);
  if (value) await p.add(new Link({ source, predicate, target: Literal.from(value).toUrl() }));
}

/** The hints currently stored on the perspective for one entity, or null when it has no shape. */
export async function readInterpretationHints(p: PerspectiveProxy, entity: string): Promise<EntityHintState | null> {
  const located = await locateShape(p, entity);
  if (!located) return null;
  const { shapeUri, propNodes } = located;

  const [classLinks, marker] = await Promise.all([
    p.get(new LinkQuery({ source: shapeUri, predicate: HINT_PREDICATE })),
    p.get(new LinkQuery({ source: shapeUri, predicate: HINTS_CUSTOMIZED_PREDICATE })),
  ]);
  const propHints: Record<string, string> = {};
  await Promise.all(
    [...propNodes.entries()].map(async ([path, node]) => {
      const links = await p.get(new LinkQuery({ source: node, predicate: HINT_PREDICATE }));
      if (links[0]) propHints[path] = decodeLiteral(links[0].data.target);
    }),
  );
  return {
    ...(classLinks[0] ? { classHint: decodeLiteral(classLinks[0].data.target) } : {}),
    propHints,
    customized: marker.length > 0,
  };
}

/**
 * Write hint customizations for one entity and mark the shape customized.
 *
 * Only the keys present are touched (a partial update); an empty-string hint removes that hint.
 * `propHints` is keyed by predicate. Throws when the entity has no stored shape — customizing what
 * is not installed would succeed silently and do nothing, which is the worse failure.
 */
export async function writeInterpretationHints(
  p: PerspectiveProxy,
  entity: string,
  hints: { classHint?: string; propHints?: Record<string, string> },
): Promise<void> {
  const located = await locateShape(p, entity);
  if (!located) throw new Error(`writeInterpretationHints: no stored shape for "${entity}" in this dataset`);
  const { shapeUri, propNodes } = located;

  if (hints.classHint !== undefined) await replaceLink(p, shapeUri, HINT_PREDICATE, hints.classHint || null);
  for (const [predicate, hint] of Object.entries(hints.propHints ?? {})) {
    const node = propNodes.get(predicate);
    if (!node) throw new Error(`writeInterpretationHints: "${entity}" has no property stored under ${predicate}`);
    await replaceLink(p, node, HINT_PREDICATE, hint || null);
  }
  await replaceLink(p, shapeUri, HINTS_CUSTOMIZED_PREDICATE, 'true');
}

/**
 * Reset one entity's hints to what its model class declares, and clear the customized marker —
 * the "reset to default" affordance, and how a space resumes receiving hint improvements from
 * releases after having customized.
 */
export async function resetInterpretationHints(p: PerspectiveProxy, entity: string): Promise<void> {
  const located = await locateShape(p, entity);
  if (!located) return;
  const model = getEntitiesForPerspective(entity, p);
  if (!model) return;
  const declared = declaredShape(model);
  const { shapeUri, propNodes } = located;

  await replaceLink(p, shapeUri, HINT_PREDICATE, declared.classHint ?? null);
  await Promise.all(
    [...propNodes.entries()].map(([path, node]) =>
      replaceLink(p, node, HINT_PREDICATE, declared.propHints.get(path) ?? null),
    ),
  );
  await replaceLink(p, shapeUri, HINTS_CUSTOMIZED_PREDICATE, null);
}
