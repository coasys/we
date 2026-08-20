/**
 * Writing a fixture into a dataset, through the model layer the app itself writes through.
 *
 * Not raw rows. `@we/models` classes are compiled from one manifest into row-backed classes on the
 * in-memory backend and triple-backed ones on AD4M, so going through them is what makes a fixture
 * portable — and, more immediately, what stops a fixture from producing rows that no code path in
 * the app could have produced. A fixture that writes a shape the composer cannot create is a
 * fixture that photographs something users will never see.
 *
 * Everything it writes is **deterministic**: the dataset id, the space uuid and every node id are
 * derived from the fixture rather than minted. The backend is in memory, so ids are remade on every
 * load; without that property a screenshot script could not navigate to a route without first
 * loading the page to discover it, and the second load would produce different ids anyway.
 */
import { editorState, textContent } from './editorState';
import type { Fixture, FixtureNode } from './types';

/** The pieces of the host a fixture needs. Passed in rather than imported, so this stays neutral. */
export interface ApplyDeps {
  /**
   * Resolves a model class by name — `getModel` from `@we/models`.
   *
   * Typed `unknown` rather than {@link ModelClass} because the registry's own type is a
   * constructor plus an index signature (what a class satisfies is asserted where each backend
   * builds it, not in the registry), and an index signature does not satisfy a *declared* member:
   * a dep typed as `ModelClass` rejects the real `getModel` outright. Narrowed once inside
   * {@link applyFixture} instead, so no host has to cast.
   */
  getModel(name: string): unknown;
  /** The dataset to write into, as the backend's own handle. */
  dataset: unknown;
  /** That dataset's id. Use {@link datasetIdFor} to know it before the dataset exists. */
  datasetId: string;
  /**
   * The dataset's *shared* id, when it has one.
   *
   * Not decoration. `TemplateStore.resolveSpaceFromPerspective` matches a shared dataset to its
   * Space by `Space.url === dataset.sharedId`, and only falls back to `uuid === dataset.id` for a
   * personal one. A shared fixture space that sets `uuid` alone is therefore invisible to the
   * template resolver — the space appears in the sidebar, the content is all there, and the app
   * quietly renders the *default* template over it. Cost an hour; hence this comment.
   */
  sharedId?: string;
}

/** Only what this file touches — what the loose registry type above is narrowed to on the way in. */
interface ModelInstance {
  id: string;
  addChildren?(related: unknown): Promise<void>;
  addSignals?(related: unknown): Promise<void>;
}

interface ModelClass {
  create(handle: unknown, data: Record<string, unknown>): Promise<ModelInstance>;
}

export interface AppliedFixture {
  datasetId: string;
  /** Every node written, in creation order. */
  nodes: Array<{ id: string; kind: string; title?: string }>;
  /** The path this fixture's route lands on, e.g. `/channel/discord-general`. */
  path: string;
}

/** The dataset a fixture lives in. Knowable before anything is applied, and stable across loads. */
export function datasetIdFor(fixture: Pick<Fixture, 'id'>): string {
  return `preview-${fixture.id}`;
}

/**
 * The path the fixture's route lands on.
 *
 * The route as written, with no space prefix: `buildRoutes` mounts a template's routes at the
 * router *root*, so `/channel/:channelId` is exactly that. The `/space/<id>/<view>` shape
 * `navigateToSpace` builds is a different convention that only the default template's own
 * `/space/:spaceId` route satisfies — see `PreviewBootstrap` in the preview host.
 */
export function pathFor(fixture: Fixture): string {
  return fixture.route ?? '/';
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export async function applyFixture(deps: ApplyDeps, fixture: Fixture): Promise<AppliedFixture> {
  const { dataset, datasetId } = deps;
  const getModel = (name: string) => deps.getModel(name) as ModelClass;
  const created: AppliedFixture['nodes'] = [];
  /** Per-kind counter, so a node with no title still gets a stable id from its position. */
  const counters = new Map<string, number>();

  await getModel('Space').create(dataset, {
    id: `${fixture.id}-space`,
    uuid: datasetId,
    ...(deps.sharedId ? { url: deps.sharedId } : {}),
    name: fixture.space.name,
    description: fixture.space.description,
    ...(fixture.space.avatar ? { avatar: fixture.space.avatar } : {}),
    discovery: 'hidden',
    // What the space opens as. Without these the preview shows whichever template the *agent*
    // defaults to, which is `default` — so every fixture would photograph the same layout.
    defaultTemplateId: fixture.templateId,
    ...(fixture.themeId ? { defaultThemeId: fixture.themeId } : {}),
  });

  // Signal types first, and by slug: a fixture says a message was hearted, and the id that means
  // "heart" in this space does not exist until the type does. Templates resolve them the same way,
  // by slug through a hoisted query, precisely because the id is per-community.
  const signalTypeIds = new Map<string, string>();
  for (const type of fixture.signalTypes ?? []) {
    const instance = await getModel('SignalType').create(dataset, {
      id: `${fixture.id}-signal-${type.slug}`,
      name: type.name,
      slug: type.slug,
      icon: type.icon,
      ...(type.description ? { description: type.description } : {}),
      mode: type.mode ?? 'toggle',
      ...(type.semantic ? { semantic: type.semantic } : {}),
      rangeMin: 0,
      rangeMax: 1,
      step: 1,
      aggregate: 'count',
      allowChange: true,
      valueType: 'numeric',
    });
    signalTypeIds.set(type.slug, instance.id);
  }

  function idFor(node: FixtureNode): string {
    if (node.id) return node.id;
    if (node.title) return `${fixture.id}-${slug(node.title)}`;
    const n = (counters.get(node.kind) ?? 0) + 1;
    counters.set(node.kind, n);
    return `${fixture.id}-${node.kind}-${n}`;
  }

  async function write(node: FixtureNode, parent?: ModelInstance): Promise<ModelInstance> {
    const hasBody = Boolean(node.body?.length);
    const id = idFor(node);
    const instance = await getModel('CollectionBlock').create(dataset, {
      id,
      type: 'collection',
      kind: node.kind,
      mode: node.mode ?? (hasBody ? 'document' : 'feed'),
      ...(node.title ? { title: node.title } : {}),
      ...(node.description ? { description: node.description } : {}),
      ...(hasBody ? { editorState: editorState(node.body!), textContent: textContent(node.body!) } : {}),
      // Both are overrides of values the entity layer would otherwise stamp with `selfId()` and
      // `now`. Authorship is the entire reason a fixture looks like a community rather than a
      // diary, and a feed where every row was written this instant sorts arbitrarily and reads
      // "just now" all the way down.
      ...(node.author ? { author: node.author } : {}),
      ...(node.createdAt ? { createdAt: node.createdAt, timestamp: node.createdAt } : {}),
    });

    created.push({ id, kind: node.kind, ...(node.title ? { title: node.title } : {}) });

    // Containment is a link, not a field: `we://children` is what a `scope` drill-down and the
    // `$latestChild` projection both traverse.
    if (parent?.addChildren) await parent.addChildren(instance);

    for (const [index, image] of (node.images ?? []).entries()) {
      const block = await getModel('ImageBlock').create(dataset, {
        id: `${id}-image-${index + 1}`,
        src: image.src,
        ...(image.alt ? { altText: image.alt } : {}),
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
        ...(node.author ? { author: node.author } : {}),
        ...(node.createdAt ? { createdAt: node.createdAt, timestamp: node.createdAt } : {}),
      });
      await instance.addChildren?.(block);
    }

    for (const signal of node.signals ?? []) {
      const signalTypeId = signalTypeIds.get(signal.slug);
      if (!signalTypeId) {
        throw new Error(`fixture '${fixture.id}': signal slug '${signal.slug}' has no matching signalTypes entry`);
      }
      for (const did of signal.by) {
        const value = await getModel('Signal').create(dataset, {
          id: `${id}-${signal.slug}-${slug(did)}`,
          signalTypeId,
          value: 1,
          author: did,
        });
        await instance.addSignals?.(value);
      }
    }

    for (const child of node.children ?? []) await write(child, instance);
    return instance;
  }

  for (const node of fixture.content) await write(node);

  return { datasetId, nodes: created, path: pathFor(fixture) };
}
