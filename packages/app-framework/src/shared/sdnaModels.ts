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

function getModelTargetClass(m: typeof Ad4mModel): string | undefined {
  const anyClass = m as unknown as { generateSHACL: () => { shape: { targetClass?: string } | null } };
  return anyClass.generateSHACL().shape?.targetClass;
}

/**
 * `Ad4mModel.registerAll`'s own dedup guard is a JS-process-local cache, not a check
 * against the perspective's actual state — a fresh `PerspectiveProxy` (new app boot,
 * new tab, another peer) starts with that cache empty and will write a full duplicate
 * copy of every shape's SDNA links, even if they're already there. Diffing against
 * `getAllShacl()` first makes registration genuinely idempotent regardless of how many
 * times, or by how many independent processes/peers, it's called on the same perspective.
 *
 * The top-level `shacl://{name}` mapping ad4m-core uses is namespace-blind — it's keyed
 * on the bare `@Model({ name })` string, not the model's namespaced `targetClass` (e.g.
 * `we://Template` and `some-other-app://Template` both reduce to `"Template"`). On a
 * perspective where another app's SDNA coexists with WE's (e.g. a Flux community
 * initialized as a WE space), a name collision would mean `getAllShacl()` reports that
 * name as already registered even though the installed shape's `targetClass` belongs to
 * the other app entirely. Comparing `targetClass`, not just the bare name, means we still
 * correctly detect "this specific model isn't installed" and re-register it rather than
 * silently trusting a same-named foreign shape.
 */
async function ensureModelsRegistered(p: PerspectiveProxy, models: readonly (typeof Ad4mModel)[]): Promise<void> {
  const existingTargetClassByName = new Map((await p.getAllShacl()).map((s) => [s.name, s.shape.targetClass] as const));
  const missing = models.filter((m) => {
    const existingTargetClass = existingTargetClassByName.get(getModelClassName(m));
    if (existingTargetClass === undefined) return true;
    return existingTargetClass !== getModelTargetClass(m);
  });
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
): Promise<{ kept: LinkExpression[]; removedAuthors: string[] }> {
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
  return { kept: Array.from(seen.values()), removedAuthors: toRemove.map((l) => l.author) };
}

/**
 * One-time remediation for a space perspective that already accumulated duplicate
 * SDNA installs (from before `joinSpace` checked for existing SDNA — see AdamStore's
 * `joinSpace`). Walks the same link graph `getShacl`/`getAllShacl` read
 * (`ad4m://self -[has_shacl]-> name -[shacl_shape_uri]-> shape -[sh://property]-> prop`)
 * and collapses every duplicated triple along the way back down to one copy each.
 *
 * Safe to run repeatedly and safe to run against a space with no duplicates (no-op).
 * Returns the total number of duplicate links removed, plus the distinct DIDs that
 * authored the removed duplicates — useful for telling whether new duplication is
 * coming from a known agent (e.g. yourself, re-testing) or an unfamiliar one (e.g. a
 * peer still running a pre-fix build).
 */
export async function deduplicateSpaceSdna(p: PerspectiveProxy): Promise<{ removed: number; authors: string[] }> {
  let removed = 0;
  const authors = new Set<string>();
  const record = (removedAuthors: string[]) => {
    removed += removedAuthors.length;
    for (const author of removedAuthors) authors.add(author);
  };

  const { kept: nameLinks, removedAuthors: nameRemoved } = await dedupeLinks(p, {
    source: 'ad4m://self',
    predicate: 'ad4m://has_shacl',
  });
  record(nameRemoved);

  for (const nameLink of nameLinks) {
    const decodedName = Literal.fromUrl(nameLink.data.target).get() as string;
    const shapeName = decodedName.replace('shacl://', '');
    const nameMappingUrl = Literal.fromUrl(`literal:string:shacl://${shapeName}`).toUrl();

    const { kept: shapeUriLinks, removedAuthors: shapeUriRemoved } = await dedupeLinks(p, {
      source: nameMappingUrl,
      predicate: 'ad4m://shacl_shape_uri',
    });
    record(shapeUriRemoved);
    if (shapeUriLinks.length === 0) continue;
    const shapeUri = shapeUriLinks[0].data.target;

    const { kept: propertyLinks, removedAuthors: propertyRemoved } = await dedupeLinks(p, {
      source: shapeUri,
      predicate: 'sh://property',
    });
    record(propertyRemoved);

    const sourceUris = [shapeUri, ...propertyLinks.map((l) => l.data.target)];
    for (const uri of sourceUris) {
      const { removedAuthors } = await dedupeLinks(p, { source: uri });
      record(removedAuthors);
    }
  }

  return { removed, authors: Array.from(authors) };
}
