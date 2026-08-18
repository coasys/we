import { Ad4mModel, type LinkExpression, LinkQuery, Literal, PerspectiveProxy } from '@coasys/ad4m';
import { getModelPredicates, getModelTargetClass } from '@we/models';
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
  MutedAgent,
  ReadMarker,
  Shape,
  Signal,
  SignalType,
  Space,
  SpacePreference,
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
  SpacePreference,
  SpaceTemplatePreference,
  Template,
  Theme,
  LocationBlock,
  // Per-agent private state. Root-dataset models by definition — written into a space they would
  // sync one agent's read positions, and their mute list, to every member of that community.
  ReadMarker,
  MutedAgent,
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
 * Everything about a stored shape that a *reader* of it can act on.
 *
 * Read as one bundle, and compared as one bundle, because the alternative has now failed three
 * times. Staleness started as "does it have every predicate", which missed a hint being added;
 * then gained "does it have a hint", which missed a hint being *reworded*; then compared hint
 * values, which still missed `identity` being set on a property, because that changes no predicate
 * and no class hint. Each fix was correct and each was one aspect behind.
 *
 * The rule that replaces the whack-a-mole: **this must carry whatever the executor reads off a
 * shape.** The executor resolves shapes from the perspective, not from the model classes, so
 * anything it consumes and this ignores is a change that silently never arrives — and the symptom
 * is always somewhere else entirely ("the model extracted nothing", "the model duplicated
 * everything"), never "your schema is out of date".
 */
export interface StoredShape {
  /** `sh://path` of every property the stored shape declares. */
  paths: Set<string>;
  /** Class-level interpretation hint, decoded. */
  classHint?: string;
  /** `sh://path` of the property marked `ad4m://identity`, if any. */
  identityPath?: string;
  /** Property-level interpretation hints, decoded, keyed by `sh://path`. */
  propHints: Map<string, string>;
  /**
   * The space customized this shape's hints (`we://interpretation_customized` marker present —
   * see `interpretationHints.ts`). Hints are then space-owned: the staleness comparison yields on
   * them rather than reverting the community's tuning on every space switch. Structure (paths,
   * identity) stays code-owned and compared regardless.
   */
  hintsCustomized?: boolean;
}

/**
 * Read the stored shapes of a whole perspective in a fixed number of queries.
 *
 * Four flat conjunctive queries rather than one with `OPTIONAL`/`UNION`: the facts hang off
 * different subjects (the class hint off the shape node, paths and property hints off each property
 * shape), so a single join either multiplies rows — a class with six properties and one class hint
 * returns six identical hint rows — or drops classes that lack one leg entirely. Four cheap queries
 * for the whole space still beats `getClassShape()` per model, which costs two round trips each and
 * runs on every space switch over ~20 models.
 */
async function storedShapes(p: PerspectiveProxy): Promise<Map<string, StoredShape>> {
  const shapes = new Map<string, StoredShape>();
  const entry = (targetClass: string): StoredShape => {
    const existing = shapes.get(targetClass);
    if (existing) return existing;
    const created: StoredShape = { paths: new Set(), propHints: new Map() };
    shapes.set(targetClass, created);
    return created;
  };
  const select = async (query: string) => {
    const rows = await p.querySparql(query);
    return Array.isArray(rows) ? (rows as Record<string, string | undefined>[]) : [];
  };

  const CHAIN = `?targetClass <rdf://type> <ad4m://SubjectClass> .
      ?targetClass <ad4m://shape> ?shapeUri .
      ?shapeUri <sh://property> ?prop .
      ?prop <sh://path> ?path .`;

  for (const row of await select(`SELECT ?targetClass ?path WHERE { ${CHAIN} }`)) {
    if (row.targetClass && row.path) entry(row.targetClass).paths.add(row.path);
  }
  for (const row of await select(
    `SELECT ?targetClass ?hint WHERE {
      ?targetClass <rdf://type> <ad4m://SubjectClass> .
      ?targetClass <ad4m://shape> ?shapeUri .
      ?shapeUri <ad4m://interpretation_hint> ?hint .
    }`,
  )) {
    if (row.targetClass && row.hint !== undefined) entry(row.targetClass).classHint = decodeHint(row.hint);
  }
  for (const row of await select(`SELECT ?targetClass ?path WHERE { ${CHAIN} ?prop <ad4m://identity> ?flag . }`)) {
    if (row.targetClass && row.path) entry(row.targetClass).identityPath = row.path;
  }
  for (const row of await select(
    `SELECT ?targetClass ?path ?hint WHERE { ${CHAIN} ?prop <ad4m://interpretation_hint> ?hint . }`,
  )) {
    if (row.targetClass && row.path && row.hint !== undefined) {
      entry(row.targetClass).propHints.set(row.path, decodeHint(row.hint));
    }
  }
  for (const row of await select(
    `SELECT ?targetClass ?flag WHERE {
      ?targetClass <rdf://type> <ad4m://SubjectClass> .
      ?targetClass <ad4m://shape> ?shapeUri .
      ?shapeUri <we://interpretation_customized> ?flag .
    }`,
  )) {
    if (row.targetClass) entry(row.targetClass).hintsCustomized = true;
  }

  return shapes;
}

/**
 * The same bundle, read off a model class — the other side of the staleness comparison.
 *
 * Exported, with {@link shapeIsStale} and {@link StoredShape}, so the comparison can be tested
 * without a perspective. Ordinarily internals would stay internal; this one has now been wrong
 * three times in three different ways, each shipping as a silent failure somewhere else, which is
 * worth more than the tidiness of a narrow export surface.
 */
export function declaredShape(model: typeof Ad4mModel): StoredShape {
  const out: StoredShape = { paths: new Set(getModelPredicates(model)), propHints: new Map() };
  const generate = (
    model as unknown as {
      generateSHACL?: () => {
        shape?: {
          interpretationHint?: string;
          properties?: { path?: string; identity?: boolean; interpretationHint?: string }[];
        };
      };
    }
  ).generateSHACL;
  if (typeof generate !== 'function') return out;
  try {
    const shape = generate.call(model).shape;
    out.classHint = shape?.interpretationHint || undefined;
    for (const property of shape?.properties ?? []) {
      if (!property.path) continue;
      if (property.identity) out.identityPath = property.path;
      if (property.interpretationHint) out.propHints.set(property.path, property.interpretationHint);
    }
  } catch {
    // A model whose SHACL cannot be generated is not a model we can judge stale.
  }
  return out;
}

/** Hints are stored literal-encoded; compare decoded so an encoding change is not a content change. */
function decodeHint(value: string): string {
  if (!value.startsWith('literal:')) return value;
  try {
    return String(Literal.fromUrl(value).get());
  } catch {
    return value;
  }
}

/**
 * Whether a perspective's stored shape for a model is behind what the model now declares.
 *
 * Adding a property to an existing model used to be a silent one-way break: shapes were written only
 * for a class absent *entirely*, so every space created before the property existed kept the old
 * shape, and writes to the new field were dropped by a perspective that looked perfectly healthy.
 * `Space.enabledModules` shipped straight into that hole.
 *
 * The executor handles the write half: `add_sdna` purges the prior SHACL graph and rewrites it
 * whenever a SubjectClass is registered *with* a shape, so re-registering is a genuine refresh
 * rather than a second competing copy. Only the guard here stood in the way.
 *
 * Compares the whole {@link StoredShape} bundle rather than one aspect at a time — see the note
 * there for why, and for the rule about keeping it in step with what the executor reads.
 *
 * **A shape with no stored properties is treated as fresh, not stale.** On a freshly-joined
 * neighbourhood the shape triples can replicate after the SubjectClass marker (the lag
 * `hasSubjectClassLink` documents), and reading that gap as "missing everything" would rewrite every
 * shape in the space on the strength of data that had simply not arrived yet. A genuinely stale
 * shape always carries its old properties, so it is still caught.
 */
export function shapeIsStale(model: typeof Ad4mModel, stored: ReadonlyMap<string, StoredShape>): boolean {
  const targetClass = getModelTargetClass(model);
  if (!targetClass) return false;
  const current = stored.get(targetClass);
  if (!current?.paths.size) return false;

  const declared = declaredShape(model);
  if ([...declared.paths].some((predicate) => !current.paths.has(predicate))) return true;
  if (declared.identityPath !== current.identityPath) return true;
  // Hints are space-owned once customized (see StoredShape.hintsCustomized): a stored hint that
  // differs from the declaration is then the community's tuning, not staleness, and rewriting it
  // would silently revert their work on every space switch.
  if (current.hintsCustomized) return false;
  if (declared.classHint !== current.classHint) return true;
  for (const [path, hint] of declared.propHints) {
    if (current.propHints.get(path) !== hint) return true;
  }
  return false;
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
 *
 * A model already present is re-registered when its stored shape is out of date — see
 * {@link shapeIsStale}. Without that, adding a property to a model reaches new spaces only.
 */
async function ensureModelsRegistered(p: PerspectiveProxy, models: readonly (typeof Ad4mModel)[]): Promise<void> {
  const [present, stored] = await Promise.all([
    Promise.all(models.map((m) => hasSubjectClassLink(p, getModelTargetClass(m)))),
    // A failed read must not make everything look stale and rewrite the space's SDNA, so it falls
    // back to an empty map — and `shapeIsStale` treats a class with no stored paths as fresh.
    storedShapes(p).catch(() => new Map<string, StoredShape>()),
  ]);
  const missing = models.filter((_, i) => !present[i]);
  const stale = models.filter((m, i) => present[i] && shapeIsStale(m, stored));
  await registerModels(p, missing, stale);
}

/**
 * Shapes already refreshed in this process, keyed `<perspective uuid>::<target class>`.
 *
 * A backstop against churn, not an optimisation. The staleness diff compares the predicates this
 * build declares against the ones stored, and both are written from the same JSON — so a refreshed
 * shape compares equal immediately afterwards and this would run once regardless. But a refresh sits
 * on the space-switch path and it *writes*, on a neighbourhood that syncs to every peer. If the two
 * sides ever stop lining up exactly, the cost of being wrong should be one redundant write per shape
 * per app run, not one per switch, forever, for everybody.
 */
const refreshedThisSession = new Set<string>();

/**
 * Write shapes for `missing` (absent entirely) and `stale` (present in an older form).
 *
 * Returns the target classes actually refreshed — which excludes any already refreshed this session.
 */
async function registerModels(
  p: PerspectiveProxy,
  missing: readonly (typeof Ad4mModel)[],
  stale: readonly (typeof Ad4mModel)[],
): Promise<string[]> {
  const refreshKey = (m: typeof Ad4mModel) => `${p.uuid}::${getModelTargetClass(m)}`;
  const toRefresh = stale.filter((m) => !refreshedThisSession.has(refreshKey(m)));
  const toWrite = [...missing, ...toRefresh];
  if (toWrite.length === 0) return [];

  const refreshed = toRefresh.map((m) => getModelTargetClass(m)).filter((c): c is string => Boolean(c));
  if (toRefresh.length > 0) {
    console.info(
      `refreshing out-of-date SDNA shapes (${refreshed.join(', ')}) — ` +
        `the stored shape predates a property the model now declares`,
    );
    // `registerAll` skips any class this *process* already registered on this proxy, and a refresh
    // is always such a case: the class is present, so something registered it. The diff against the
    // perspective — not that cache — is the authority on what needs writing.
    p.clearEnsuredSubjectClasses();
    for (const m of toRefresh) refreshedThisSession.add(refreshKey(m));
  }

  await Ad4mModel.registerAll(p, toWrite);
  // registerAll resolves before the written SDNA is actually queryable — settle before callers
  // run reactive queries against the fresh shapes. This wait is a property of THIS backend's
  // write path (the shell used to carry five copies of it as a "HACK" sleep); living here, it
  // also runs only when something was actually written.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return refreshed;
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
  // The shape *catalogue* — Shape records are how a space carries its own content models, so the
  // entity that holds them installs into every space alongside Space itself.
  Shape,
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
 * Bring an existing WE space's stored core shapes up to date with the models this build declares.
 *
 * Needed because `installSpaceSdna` deliberately does not run on a space that already has WE's SDNA
 * — that skip is what stops a foreign dataset being silently converted into a WE space. The cost is
 * that a property added to an existing model reaches newly created spaces only, and writes to it are
 * dropped everywhere else; `Space.enabledModules` is the case that surfaced it, where a community
 * could toggle a module and nothing persisted.
 *
 * Deliberately narrower than calling `installSpaceSdna` here instead: this is one SPARQL query in
 * the common case, against ~20 `hasSubjectClassLink` round trips per space switch. Only shapes that
 * are genuinely out of date are written — see {@link shapeIsStale}, including why a shape with no
 * stored properties is left alone.
 *
 * Returns the target classes it refreshed, for logging.
 */
export async function refreshSpaceSdna(p: PerspectiveProxy): Promise<string[]> {
  const stored = await storedShapes(p).catch(() => new Map<string, StoredShape>());
  return registerModels(
    p,
    [],
    SPACE_MODELS.filter((m) => shapeIsStale(m, stored)),
  );
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
