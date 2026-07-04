import { Ad4mModel, type LinkExpression, LinkQuery, Literal, PerspectiveProxy } from '@coasys/ad4m';
import {
  AgentSettings,
  AudioBlock,
  CalloutBlock,
  ChatMessage,
  ChatSession,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  Signal,
  SignalType,
  Space,
  SpaceTemplatePreference,
  TagBlock,
  TaskBlock,
  Template,
  TextBlock,
  Theme,
  VideoBlock,
  WeNode,
} from '@we/models';

/**
 * All SDNA models that belong to the we-root system perspective.
 * Centralised here so both AdamStore branches (create vs restore) always
 * register the same complete set.
 */
export const ROOT_MODELS = [
  AgentSettings,
  ChatMessage,
  ChatSession,
  SpaceTemplatePreference,
  Template,
  Theme,
  LocationBlock,
] as const;

function getModelClassName(m: typeof Ad4mModel): string {
  const anyClass = m as unknown as { className?: string; prototype?: { className?: string }; name: string };
  return anyClass.className || anyClass.prototype?.className || anyClass.name;
}

/**
 * `Ad4mModel.registerAll`'s own dedup guard is a JS-process-local cache, not a check
 * against the perspective's actual state — a fresh `PerspectiveProxy` (new app boot,
 * new tab, another peer) starts with that cache empty and will write a full duplicate
 * copy of every shape's SDNA links, even if they're already there. Diffing against
 * `getAllShacl()` first makes registration genuinely idempotent regardless of how many
 * times, or by how many independent processes/peers, it's called on the same perspective.
 */
async function ensureModelsRegistered(p: PerspectiveProxy, models: readonly (typeof Ad4mModel)[]): Promise<void> {
  const existingNames = new Set((await p.getAllShacl()).map((s) => s.name));
  const missing = models.filter((m) => !existingNames.has(getModelClassName(m)));
  if (missing.length > 0) {
    await Ad4mModel.registerAll(p, [...missing]);
  }
}

/**
 * Registers a single SDNA model on the given perspective, diffing against the
 * perspective's actual state first (see `ensureModelsRegistered`). Use this instead of
 * the raw `ModelClass.register(perspective)` anywhere a model might already be present —
 * the raw call has no such check and will write a duplicate copy every time it's called.
 */
export async function ensureModelRegistered(p: PerspectiveProxy, model: typeof Ad4mModel): Promise<void> {
  await ensureModelsRegistered(p, [model]);
}

/**
 * Registers all root SDNA models on the given perspective.
 * Safe to call on every boot, and safe to call from multiple independent peers/processes —
 * only models not already present on the perspective are written.
 */
export async function installRootSdna(p: PerspectiveProxy): Promise<void> {
  await ensureModelsRegistered(p, ROOT_MODELS);
}

/**
 * All SDNA models that belong to a WE space perspective.
 * Centralised here so both SpaceStore and AdamStore can reference the same
 * list without creating a circular dependency.
 */
export const SPACE_MODELS = [
  Space,
  Template,
  Theme,
  WeNode,
  AudioBlock,
  CalloutBlock,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  Signal,
  SignalType,
  TagBlock,
  TaskBlock,
  TextBlock,
  VideoBlock,
] as const;

/**
 * Registers all space SDNA models on the given perspective.
 * Safe to call unconditionally (e.g. on every join), and safe to call from multiple
 * independent peers on the same shared perspective — only models not already present
 * are written.
 */
export async function installSpaceSdna(p: PerspectiveProxy): Promise<void> {
  await ensureModelsRegistered(p, SPACE_MODELS);
}

/**
 * Removes duplicate (source, predicate, target) link triples for a given query,
 * keeping exactly one of each. Returns the surviving links plus how many were removed.
 *
 * Content is identical across duplicates (same model definition), so collapsing
 * them loses no information — it only removes redundant authored copies left behind
 * by independent `installSpaceSdna` calls (e.g. one per peer who joined before the
 * fix in `joinSpace` that checks for existing SDNA first).
 */
async function dedupeLinks(
  p: PerspectiveProxy,
  query: { source?: string; predicate?: string },
): Promise<{ kept: LinkExpression[]; removedCount: number }> {
  const links = await p.get(new LinkQuery(query));
  const seen = new Map<string, LinkExpression>();
  const toRemove: LinkExpression[] = [];
  for (const link of links) {
    const key = `${link.data.predicate}::${link.data.target}`;
    const existing = seen.get(key);
    if (existing) {
      toRemove.push(link);
    } else {
      seen.set(key, link);
    }
  }
  if (toRemove.length > 0) {
    await p.removeLinks(toRemove);
  }
  return { kept: Array.from(seen.values()), removedCount: toRemove.length };
}

/**
 * One-time remediation for a space perspective that already accumulated duplicate
 * SDNA installs (from before `joinSpace` checked for existing SDNA — see AdamStore's
 * `joinSpace`). Walks the same link graph `getShacl`/`getAllShacl` read
 * (`ad4m://self -[has_shacl]-> name -[shacl_shape_uri]-> shape -[sh://property]-> prop`)
 * and collapses every duplicated triple along the way back down to one copy each.
 *
 * Safe to run repeatedly and safe to run against a space with no duplicates (no-op).
 * Returns the total number of duplicate links removed.
 */
export async function deduplicateSpaceSdna(p: PerspectiveProxy): Promise<number> {
  let removed = 0;

  const { kept: nameLinks, removedCount: nameRemoved } = await dedupeLinks(p, {
    source: 'ad4m://self',
    predicate: 'ad4m://has_shacl',
  });
  removed += nameRemoved;

  for (const nameLink of nameLinks) {
    const decodedName = Literal.fromUrl(nameLink.data.target).get() as string;
    const shapeName = decodedName.replace('shacl://', '');
    const nameMappingUrl = Literal.fromUrl(`literal:string:shacl://${shapeName}`).toUrl();

    const { kept: shapeUriLinks, removedCount: shapeUriRemoved } = await dedupeLinks(p, {
      source: nameMappingUrl,
      predicate: 'ad4m://shacl_shape_uri',
    });
    removed += shapeUriRemoved;
    if (shapeUriLinks.length === 0) continue;
    const shapeUri = shapeUriLinks[0].data.target;

    const { kept: propertyLinks, removedCount: propertyRemoved } = await dedupeLinks(p, {
      source: shapeUri,
      predicate: 'sh://property',
    });
    removed += propertyRemoved;

    const sourceUris = [shapeUri, ...propertyLinks.map((l) => l.data.target)];
    for (const uri of sourceUris) {
      const { removedCount } = await dedupeLinks(p, { source: uri });
      removed += removedCount;
    }
  }

  return removed;
}
