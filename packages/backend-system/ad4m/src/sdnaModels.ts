import { Ad4mModel, type LinkExpression, LinkQuery, Literal, PerspectiveProxy } from '@coasys/ad4m';
import { getModelTargetClass } from '@we/models/classes';
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
} from '@we/models/classes';

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

/**
 * Checks for the exact `targetClass —rdf://type→ ad4m://SubjectClass` link that ad4m-core's
 * query engine (`load_shape`) requires to run a model query — not `getAllShacl()`'s
 * `has_shacl`/`shacl_shape_uri` chain, which is a separate set of triples written by the same
 * `add_sdna` call but not read by `load_shape`. On a freshly-joined, not-yet-fully-synced
 * neighbourhood those two triple sets can replicate at different times, so `getAllShacl()`
 * can report a model as absent while `load_shape` (and therefore every model query) already
 * finds it fine. Checking the marker `load_shape` actually reads closes that gap — and since
 * it's keyed on the full namespaced `targetClass` rather than the bare `@Model({ name })`
 * string, it's also immune to cross-app name collisions (e.g. `we://Template` vs. some other
 * app's own differently-namespaced same-named class). Mirrors Flux's
 * `packages/api/src/sdnaHelpers.ts`, which hit this same race first.
 */
async function hasSubjectClassLink(p: PerspectiveProxy, targetClass: string | undefined): Promise<boolean> {
  if (!targetClass) return false;
  const links = await p.get(
    new LinkQuery({ source: targetClass, predicate: 'rdf://type', target: 'ad4m://SubjectClass' }),
  );
  return links.length > 0;
}

/**
 * `Ad4mModel.registerAll`'s own dedup guard is a JS-process-local cache, not a check
 * against the perspective's actual state — a fresh `PerspectiveProxy` (new app boot,
 * new tab, another peer) starts with that cache empty and will write a full duplicate
 * copy of every shape's SDNA links, even if they're already there. Diffing against the
 * perspective's actual state first (via `hasSubjectClassLink`, not `getAllShacl()` — see
 * its doc comment) makes registration genuinely idempotent regardless of how many times,
 * or by how many independent processes/peers, it's called on the same perspective, and
 * regardless of `getAllShacl()`'s own replication lag on a not-yet-fully-synced perspective.
 */
async function ensureModelsRegistered(p: PerspectiveProxy, models: readonly (typeof Ad4mModel)[]): Promise<void> {
  const present = await Promise.all(models.map((m) => hasSubjectClassLink(p, getModelTargetClass(m))));
  const missing = models.filter((_, i) => !present[i]);
  if (missing.length > 0) {
    await Ad4mModel.registerAll(p, [...missing]);
    // registerAll resolves before the written SDNA is actually queryable — settle before callers
    // run reactive queries against the fresh shapes. This wait is a property of THIS backend's
    // write path (the shell used to carry five copies of it as a "HACK" sleep); living here, it
    // also runs only when something was actually written.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Read-only check for whether a specific model's SDNA is already installed on a
 * perspective — does not write anything. Use this instead of `getModelClasses(...).length`
 * to decide whether SDNA install is needed: `getAllShacl()` (which `getModelClasses` is
 * built on) can lag behind on a freshly-switched-to remote/not-yet-fully-synced perspective
 * (see `hasSubjectClassLink`'s doc comment), so treating its emptiness as "nothing installed"
 * can trigger a full, spurious re-registration of every space model — a write-and-validate
 * cycle per model, far slower than the read it's standing in for, and one that also risks
 * creating duplicate SDNA links (see `deduplicateSpaceSdna` below).
 */
export async function isModelRegistered(p: PerspectiveProxy, model: typeof Ad4mModel): Promise<boolean> {
  return hasSubjectClassLink(p, getModelTargetClass(model));
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
export async function installSpaceSdna(p: PerspectiveProxy, moduleModels: readonly unknown[] = []): Promise<void> {
  await ensureModelsRegistered(p, SPACE_MODELS);
  await installModuleSdna(p, moduleModels);
}

/**
 * Install the shapes of every registered feature module into a perspective.
 *
 * Separate from `installSpaceSdna` because the two have genuinely different lifetimes. WE's own
 * models are installed once, when a space is created or first joined — after which
 * `switchPerspective` deliberately skips reinstalling them (it only installs into a perspective with
 * *no* SDNA at all, so a foreign perspective is never silently converted into a WE space).
 *
 * A module's shapes cannot follow that rule, because a module can be enabled **after** a space
 * already exists — which is the normal case the moment modules are installable rather than bundled.
 * So this runs on every switch into a WE space, relying on `ensureModelsRegistered` to diff before
 * writing. Without it, enabling a module leaves every existing space unable to query its entities:
 * "No SHACL shape stored for class X", from a perspective that looks perfectly healthy.
 *
 * Idempotency lives in one shared path rather than per module deliberately — `cleanupSpaceSdna`
 * exists because shapes once got installed twice by different agents, and N modules each rolling
 * their own install would be that bug with more instances.
 *
 * The models arrive as an argument rather than being read from the module registry. The registry is
 * the host's, and a backend adapter reaching up into it would be the one edge that inverts this
 * package's dependency direction — everything else here is imported *by* the shell, not from it.
 * The caller already holds the registry, so passing `moduleRegistry.models()` costs nothing.
 */
export async function installModuleSdna(p: PerspectiveProxy, moduleModels: readonly unknown[] = []): Promise<void> {
  if (moduleModels.length) await ensureModelsRegistered(p, moduleModels as (typeof Ad4mModel)[]);
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

  // Each shape's triples are independent of every other shape's — dedupe them
  // concurrently rather than one shape at a time. This walk is structurally identical
  // to getAllShacl()/getShacl() (one RPC round trip per triple), which over a remote
  // connection turns a linear-looking loop into the dominant cost of the whole operation;
  // see the doc comment on hasSubjectClassLink above for the same round-trip-count issue.
  await Promise.all(
    nameLinks.map(async (nameLink) => {
      const decodedName = Literal.fromUrl(nameLink.data.target).get() as string;
      const shapeName = decodedName.replace('shacl://', '');
      const nameMappingUrl = Literal.fromUrl(`literal:string:shacl://${shapeName}`).toUrl();

      const { kept: shapeUriLinks, removedAuthors: shapeUriRemoved } = await dedupeLinks(p, {
        source: nameMappingUrl,
        predicate: 'ad4m://shacl_shape_uri',
      });
      record(shapeUriRemoved);
      if (shapeUriLinks.length === 0) return;
      const shapeUri = shapeUriLinks[0].data.target;

      const { kept: propertyLinks, removedAuthors: propertyRemoved } = await dedupeLinks(p, {
        source: shapeUri,
        predicate: 'sh://property',
      });
      record(propertyRemoved);

      const sourceUris = [shapeUri, ...propertyLinks.map((l) => l.data.target)];
      await Promise.all(
        sourceUris.map(async (uri) => {
          const { removedAuthors } = await dedupeLinks(p, { source: uri });
          record(removedAuthors);
        }),
      );
    }),
  );

  return { removed, authors: Array.from(authors) };
}
