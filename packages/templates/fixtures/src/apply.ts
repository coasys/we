/**
 * Writing a fixture into a dataset, through the model layer the app itself writes through.
 *
 * Not raw rows. `@we/entities` classes are compiled from one manifest into row-backed classes on the
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
import { editorState, textBlockId, textContent } from './editorState';
import type { Fixture, FixtureNode, FixtureShape } from './types';

/** The pieces of the host a fixture needs. Passed in rather than imported, so this stays neutral. */
export interface ApplyDeps {
  /**
   * Resolves a model class by name — `getEntity` from `@we/entities`.
   *
   * Typed `unknown` rather than {@link EntityClass} because the registry's own type is a
   * constructor plus an index signature (what a class satisfies is asserted where each backend
   * builds it, not in the registry), and an index signature does not satisfy a *declared* member:
   * a dep typed as `EntityClass` rejects the real `getEntity` outright. Narrowed once inside
   * {@link applyFixture} instead, so no host has to cast.
   */
  getEntity(name: string): unknown;
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
  /**
   * Declare a shape's entity in the dataset, so its records can be written before the app adopts it.
   * The backend's `schemas.declareInDataset`. Required only by a fixture that carries `shapes`.
   */
  declareShape?(manifest: FixtureShape['manifest'], moduleId: string): unknown;
}

/** Only what this file touches — what the loose registry type above is narrowed to on the way in. */
interface RecordInstance {
  id: string;
  addChildren?(related: unknown): Promise<void>;
  addSignals?(related: unknown): Promise<void>;
}

interface EntityClass {
  create(handle: unknown, data: Record<string, unknown>): Promise<RecordInstance>;
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
  const getEntity = (name: string) => deps.getEntity(name) as EntityClass;
  const created: AppliedFixture['nodes'] = [];
  /** Per-kind counter, so a node with no title still gets a stable id from its position. */
  const counters = new Map<string, number>();

  await getEntity('Space').create(dataset, {
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
    ...(fixture.themeId || fixture.theme ? { defaultThemeId: fixture.themeId ?? fixture.theme!.id } : {}),
    ...(fixture.space.enabledViews ? { enabledViews: JSON.stringify(fixture.space.enabledViews) } : {}),
    ...(fixture.space.enabledModules ? { enabledModules: JSON.stringify(fixture.space.enabledModules) } : {}),
  });

  await writeCarried(deps, fixture, getEntity);

  // Signal types first, and by slug: a fixture says a message was hearted, and the id that means
  // "heart" in this space does not exist until the type does. Templates resolve them the same way,
  // by slug through a hoisted query, precisely because the id is per-community.
  const signalTypeIds = new Map<string, string>();
  for (const type of fixture.signalTypes ?? []) {
    const instance = await getEntity('SignalType').create(dataset, {
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

  async function write(node: FixtureNode, parent?: RecordInstance): Promise<RecordInstance> {
    const hasBody = Boolean(node.body?.length);
    const id = idFor(node);
    const instance = await getEntity('CollectionBlock').create(dataset, {
      id,
      type: 'collection',
      kind: node.kind,
      mode: node.mode ?? (hasBody ? 'document' : 'feed'),
      ...(node.title ? { title: node.title } : {}),
      ...(node.slug ? { slug: node.slug } : {}),
      ...(node.description ? { description: node.description } : {}),
      ...(hasBody ? { editorState: editorState(node.body!, id), textContent: textContent(node.body!) } : {}),
      // Both are overrides of values the entity layer would otherwise stamp with `selfId()` and
      // `now`. Authorship is the entire reason a fixture looks like a community rather than a
      // diary, and a feed where every row was written this instant sorts arbitrarily and reads
      // "just now" all the way down.
      ...(node.author ? { author: node.author } : {}),
      ...(node.createdAt ? { createdAt: node.createdAt, timestamp: node.createdAt } : {}),
    });

    created.push({ id, kind: node.kind, ...(node.title ? { title: node.title } : {}) });

    // Containment is a link, not a field: `we://child` is what a `scope` drill-down and the
    // `$latestChild` projection both traverse.
    if (parent?.addChildren) await parent.addChildren(instance);

    // The models are the composition; the blob above is their projection. One `TextBlock` per
    // paragraph, keyed to match the blob, so a reader that walks `children` (the graph, a
    // transcript, a regeneration of the blob) finds the same content the blob carries.
    for (const [index, paragraph] of (node.body ?? []).entries()) {
      const block = await getEntity('TextBlock').create(dataset, {
        id: textBlockId(id, index),
        style: 'normal',
        text: paragraph,
        ...(node.author ? { author: node.author } : {}),
        ...(node.createdAt ? { createdAt: node.createdAt, timestamp: node.createdAt } : {}),
      });
      await instance.addChildren?.(block);
    }

    for (const [index, image] of (node.images ?? []).entries()) {
      const block = await getEntity('ImageBlock').create(dataset, {
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
        const value = await getEntity('Signal').create(dataset, {
          id: `${id}-${signal.slug}-${slug(did)}`,
          signalTypeId,
          value: 1,
          author: did,
        });
        await instance.addSignals?.(value);
      }
    }

    for (const child of node.children ?? []) await write(child, instance);
    if (node.arranges?.length) arrangements.push({ instance, ids: node.arranges });
    return instance;
  }

  // Deferred until every node exists: an arrangement names records by id, and a fixture reads
  // better with the columns first and the cards after them.
  const arrangements: { instance: RecordInstance; ids: string[] }[] = [];
  for (const node of fixture.content) await write(node);
  for (const { instance, ids } of arrangements) {
    const arranger = instance as { setArranges?: (ids: string[]) => Promise<unknown> };
    if (!arranger.setArranges) throw new Error(`fixture '${fixture.id}': the backend has no arranges relation`);
    await arranger.setArranges(ids);
  }

  return { datasetId, nodes: created, path: pathFor(fixture) };
}

/**
 * A JSON document as the file field the app reads it from.
 *
 * `Template.schema`, `Theme.overrides` and `Shape.definition` are `format: 'file'`, and the app decodes
 * them with `decodeFileAsJson` / `decodeFileAsString`, which take a `data:` URI — the form AD4M's file
 * storage hands back. The in-memory backend stores whatever it is given, so the fixture writes that
 * form itself. UTF-8 first, because `btoa` only takes Latin-1 and a template is full of em dashes.
 */
function asFile(value: unknown, mime = 'application/json'): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

const toSnake = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * What a space carries beyond its posts: its templates, its theme, its own kinds of record, and
 * records of those and of core models — written as the records the real app would hold after an
 * install, so the app reads them through its ordinary paths rather than a preview-only one.
 */
async function writeCarried(
  deps: ApplyDeps,
  fixture: Fixture,
  getEntity: (name: string) => EntityClass,
): Promise<void> {
  const { dataset } = deps;

  for (const template of fixture.templates ?? []) {
    const meta = template.meta as { name?: string; description?: string; icon?: string; role?: string };
    await getEntity('Template').create(dataset, {
      id: `${fixture.id}-template-${template.id}`,
      name: meta.name ?? template.id,
      description: meta.description ?? '',
      icon: meta.icon ?? 'layout',
      origin: 'custom',
      version: 1,
      slug: template.id,
      ...(meta.role ? { role: meta.role } : {}),
      schema: asFile(template),
    });
  }

  if (fixture.theme) {
    const { id, name, icon, overrides } = fixture.theme;
    await getEntity('Theme').create(dataset, {
      id,
      name,
      icon: icon ?? 'palette',
      origin: 'custom',
      version: 1,
      slug: id,
      overrides: asFile(JSON.stringify(overrides)),
    });
  }

  /*
    Shapes before records: a record of a shape cannot be written until its entity exists. The
    `Shape` record is what the app adopts on entry (ShapeStore reads every one in the dataset); the
    declaration here is only so this function can write the records first.
  */
  for (const shape of fixture.shapes ?? []) {
    if (!deps.declareShape) {
      throw new Error(`fixture '${fixture.id}' carries shapes, so applyFixture needs a declareShape dependency`);
    }
    const shapeId = `we://shapes/${fixture.id}-${toSnake(shape.name)}`;
    await getEntity('Shape').create(dataset, {
      id: `${fixture.id}-shape-${toSnake(shape.name)}`,
      name: shape.name,
      ...(shape.description ? { description: shape.description } : {}),
      ...(shape.icon ? { icon: shape.icon } : {}),
      shapeId,
      version: 1,
      definition: asFile(shape.manifest),
    });
    await deps.declareShape(shape.manifest, `shape/${shapeId}`);
  }

  /*
    Records in two passes. A relation names its target by id, and the in-memory backend keeps a
    to-many link as a foreign key on the target row, so the target must exist before the link does —
    the same reason `arranges` is deferred.
  */
  const instances = new Map<string, RecordInstance & Record<string, unknown>>();
  for (const record of fixture.records ?? []) {
    const instance = await getEntity(record.entity).create(dataset, {
      id: record.id,
      ...(record.fields ?? {}),
      ...(record.author ? { author: record.author } : {}),
      ...(record.createdAt ? { createdAt: record.createdAt, timestamp: record.createdAt } : {}),
    });
    instances.set(record.id, instance as RecordInstance & Record<string, unknown>);
  }
  for (const record of fixture.records ?? []) {
    const instance = instances.get(record.id)!;
    for (const [relation, targets] of Object.entries(record.relations ?? {})) {
      const add = instance[`add${relation.charAt(0).toUpperCase()}${relation.slice(1)}`];
      if (typeof add !== 'function') {
        throw new Error(
          `fixture '${fixture.id}': ${record.entity} has no relation "${relation}" (record ${record.id})`,
        );
      }
      for (const target of Array.isArray(targets) ? targets : [targets]) {
        await (add as (id: string) => Promise<void>).call(instance, target);
      }
    }
  }
}
