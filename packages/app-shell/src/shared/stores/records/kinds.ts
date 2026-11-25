/**
 * The record store's kinds: what can be made here and what can be shown, how each is laid out, and the
 * space's own layer over that layout — its key, `Space.typeStyles`.
 *
 * Every other part asks this one what a name means (`schemaFor`) and writes through the class it names
 * (`entityClass`), so it is built first.
 */
import type { LivePage as Page, LiveQuery } from '@we/backend-shared';
import { getEntity, getEntityForDataset, Space, TypeStyle } from '@we/entities';

import { followLive } from '../../followLive';
import { hostSlot } from '../../hostSlot';
import {
  coreCreatables,
  type CreatableEntity,
  displayableKinds,
  foreignDisplays,
  inlineEditorFor,
  type KindSchema,
  kindSchemaOf,
  shapeCreatables,
  titleFieldOf,
} from '../../shapes/creatableKinds';
import { WE_PLUMBING_CLASSES } from '../../shapes/interpretationCandidates';
import { presentationFields, presentationOf, type TypePresentation, withPresentation } from '../../shapes/presentation';
import { displayFor, type RecordDisplay } from '../../shapes/recordDisplay';
import { fieldsFor, type RelationTargetAbilities } from '../../shapes/recordDraft';
import type { RecordStore } from '../RecordStore';
import type { ShapeStore } from '../ShapeStore';
import type { AnyEntity, RecordContext } from './context';

export interface RecordKindsDeps extends RecordContext {
  /** The space's own models, which it offers forms and displays for beside WE's. */
  shapeStore: Pick<ShapeStore, 'spaceShapes'>;
}

/** The members templates read, and what the other parts ask of the kinds. */
export interface RecordKinds extends Pick<
  RecordStore,
  | 'creatableEntities'
  | 'displays'
  | 'kinds'
  | 'plumbingClasses'
  | 'provideVocabularies'
  | 'setSpaceTypeColor'
  | 'setSpaceTypePresentation'
> {
  /** The schema behind a model's name here — see `kindSchemaOf`. */
  schemaFor: (entity: string) => KindSchema | undefined;
  /**
   * The class a record of `entity` is written through, in the dataset on screen.
   *
   * `getEntity` alone reads the global registry, which holds WE's own models and the modules'. A
   * model a community defined is registered *per dataset* on some backends — that is how two spaces
   * can each have a `Sighting` — so saving one through the form failed with "Model "UfoSighting" not
   * found in registry" while the model sat listed in the space's settings. The per-dataset lookup
   * prefers the global class and falls back to the space's own, so every caller goes through it.
   */
  entityClass: (entity: string, handle: unknown) => AnyEntity;
  /**
   * What a relation field pointing at `target` may do.
   *
   * Make one when the target has a form of its own. Pick an existing one when the target is not a
   * block: an image in a sighting belongs to that sighting, where the species it names is a record
   * many sightings share.
   */
  relationTarget: (target: string) => RelationTargetAbilities | undefined;
  /** The property an extraction prompt names a record of `entity` by, or '' for a model this space lacks. */
  titleField: (entity: string) => string;
}

/** A row of the space's key, as read: what it styles, its colour, and how it lays the type out. */
type KeyRow = {
  id: string;
  nodeType?: string;
  color?: string;
  display?: string;
  controls?: string;
  authoring?: string;
};

/** The space's own `TypeStyle` records, as a parent scope. */
const spaceTypeStyles = (spaceId: string) => ({ id: spaceId, relation: 'typeStyles', entity: 'Space' });

export function createRecordKinds(deps: RecordKindsDeps): RecordKinds {
  const { reactivity, toasts, datasetStore, shapeStore, runOp } = deps;

  // A constant: the core manifest does not change while the app runs.
  const coreEntities = coreCreatables();
  const shapeEntities = reactivity.memo(() => shapeCreatables(shapeStore.spaceShapes()));

  // This space's own first: a community that has modelled its vocabulary means those models, and
  // WE's built-ins are the fallback rather than the headline.
  const creatableEntities = reactivity.memo<CreatableEntity[]>(() => [...shapeEntities(), ...coreEntities]);

  const schemaFor = (entity: string) => kindSchemaOf(shapeStore.spaceShapes(), entity);

  function entityClass(entity: string, handle: unknown): AnyEntity {
    // The same reading of the registry's loose entries as `entityNamed`.
    return (getEntityForDataset(entity, handle) ?? getEntity(entity)) as unknown as AnyEntity;
  }

  function relationTarget(target: string): RelationTargetAbilities | undefined {
    const found = schemaFor(target);
    if (!found) return undefined;
    return {
      canCreate: fieldsFor(found.schema, found.authorable).length > 0,
      canPick: !found.schema.blockable,
      label: found.label,
      inline: inlineEditorFor(target, found.schema),
    };
  }

  const displayableEntities = reactivity.memo(() => displayableKinds(creatableEntities()));

  const vocabularies = hostSlot<(vocabulary: string) => string[] | undefined>();

  /** The space's layer of each type's presentation, by type — filled by `reloadSpacePresentation`. */
  const [spacePresentation, setSpacePresentation] = reactivity.signal<Record<string, TypePresentation>>({});

  /*
    One display per creatable model, from the same declarations the forms come from.

    A map rather than a lookup action because a template reads it in a value position — a feed
    indexes it by each row's type — and `$invoke` cannot return a value. Recomputed when the
    space's shapes change, so a model defined a moment ago has a display a moment later.
  */
  const displays = reactivity.memo<Record<string, RecordDisplay>>(() => {
    const out: Record<string, RecordDisplay> = {};
    for (const entity of displayableEntities()) {
      const found = schemaFor(entity.value);
      if (!found) continue;
      out[entity.value] = displayFor({
        entity: entity.value,
        label: entity.label,
        icon: found.icon,
        // The model's own presentation, with the space's laid over it.
        schema: withPresentation(found.schema, spacePresentation()[entity.value]),
        authorable: found.authorable,
        vocabularyFor: (vocabulary) => vocabularies.get()?.(vocabulary),
      });
    }
    // Then a class the space already had, which no WE model says how to show — see `foreignDisplays`.
    return { ...out, ...foreignDisplays(datasetStore.currentDatasetEntities(), out) };
  });

  function titleField(entity: string): string {
    const schema = schemaFor(entity)?.schema;
    return schema ? titleFieldOf(schema) : '';
  }

  /*
    The space's layer of a type's presentation — see `shared/shapes/presentation.ts`. Read live, as
    the space's key is drawn: a change somebody else makes reaches every card here.
  */
  /** Reads the space's layer. Answers with the space's record id, or '' when there is no space record. */
  async function reloadSpacePresentation(): Promise<string> {
    const dataset = datasetStore.currentDataset();
    if (!dataset) {
      setSpacePresentation({});
      return '';
    }
    try {
      const space = (await Space.findOne(dataset.handle)) as { id?: string } | null;
      if (!space?.id || datasetStore.currentDataset()?.id !== dataset.id) return '';
      const rows = (await TypeStyle.findAll(dataset.handle, {
        parent: spaceTypeStyles(space.id),
      })) as KeyRow[];
      if (datasetStore.currentDataset()?.id !== dataset.id) return space.id;
      applySpacePresentation(rows);
      return space.id;
    } catch (error) {
      console.warn("RecordStore: could not read the space's presentation of its types", error);
      return '';
    }
  }
  /** The space's layer, from its `TypeStyle` rows — read, or pushed by the watch below. */
  function applySpacePresentation(rows: readonly KeyRow[]): void {
    const out: Record<string, TypePresentation> = {};
    for (const row of rows) {
      const layer = presentationOf(row);
      if (row.nodeType && Object.keys(layer).length) out[row.nodeType] = layer;
    }
    setSpacePresentation(out);
  }
  reactivity.effect(() => {
    const dataset = datasetStore.currentDataset();
    setSpacePresentation({});
    if (!dataset) return;
    const query = (TypeStyle as unknown as { query?: (dataset: unknown, q: object) => LiveQuery<Page<KeyRow>> }).query;
    // A backend whose records cannot be followed is read once, on entering.
    if (typeof query !== 'function') {
      void reactivity.untrack(reloadSpacePresentation);
      return;
    }
    let spaceId: string | undefined;
    followLive(
      reactivity,
      async (current) => {
        const space = (await reactivity.untrack(() => Space.findOne(dataset.handle))) as { id?: string } | null;
        if (!current()) return undefined;
        spaceId = datasetStore.currentDataset()?.id === dataset.id ? space?.id : undefined;
        /*
          The watch asks what the layer is — the space's own styles, not every canvas's — and its first
          result is the layer as it stands, so nothing is read separately before it.

          With no space record to scope to yet — a dataset that becomes a space later — any style
          written is the cue to look for the space again, so that watch only signals, and asks for ids
          alone.
        */
        return spaceId
          ? query.call(TypeStyle, dataset.handle, { parent: spaceTypeStyles(spaceId) })
          : query.call(TypeStyle, dataset.handle, { properties: ['id'] });
      },
      {
        store: 'RecordStore',
        what: "the space's types",
        apply: (rows, opened) => {
          if (spaceId) applySpacePresentation(rows);
          else if (!opened) void reloadSpacePresentation();
        },
      },
    );
  });

  async function setSpaceTypePresentation(
    spaceId: string,
    nodeType: string,
    presentation: TypePresentation | null,
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !spaceId || !nodeType) return;
    try {
      const existing = (await TypeStyle.findAll(dataset.handle, { parent: spaceTypeStyles(spaceId) })) as KeyRow[];
      const rows = existing.filter((row) => row.nodeType === nodeType);
      const color = rows.find((row) => row.color)?.color ?? '';
      const fields = presentationFields(presentation ?? {});
      // Written whole: a field cannot be emptied in place (the model layer skips `''`), so the row is
      // made again with exactly what it should say — the colour it had, and the presentation given.
      const keep = Object.fromEntries(Object.entries({ color, ...fields }).filter(([, v]) => v));
      await runOp('core.restyleSpaceType', { space: spaceId, nodeType, fields: keep }, dataset.handle);
      await reloadSpacePresentation();
    } catch (error) {
      console.error('RecordStore: saving how the space presents a type failed', error);
      toasts.error('Could not save how that type is shown.');
    }
  }

  async function setSpaceTypeColor(spaceId: string, nodeType: string, color: unknown): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !spaceId || !nodeType) return;
    const raw = color !== null && typeof color === 'object' && 'detail' in color ? color.detail : color;
    const value = typeof raw === 'string' ? raw : '';
    // The relation's own predicate, not `children`: a space is not a container and a key is not one
    // of its contents. It is what `Space.typeStyles` reads through.
    const parent = spaceTypeStyles(spaceId);

    try {
      const existing = (await TypeStyle.findAll(dataset.handle, { parent })) as KeyRow[];
      const rows = existing.filter((row) => row.nodeType === nodeType);
      if (!value) {
        // Clearing deletes. `''` cannot be stored — the model layer's update skips it — and the canvas
        // sentinel would leave a row every reader has to know to ignore. A row that also says how
        // the type is laid out is written again with that alone.
        const kept = rows.map(presentationOf).find((p) => Object.keys(p).length);
        await runOp(
          'core.restyleSpaceType',
          { space: spaceId, nodeType, fields: kept ? presentationFields(kept) : {} },
          dataset.handle,
        );
        return;
      }
      // Two people colouring the same kind at once can leave two rows; the write settles it.
      await runOp('core.colorSpaceType', { space: spaceId, nodeType, color: value }, dataset.handle);
    } catch (error) {
      console.error("RecordStore: colouring a type in the space's key failed", error);
      toasts.error('Could not save that colour.');
    }
  }

  return {
    creatableEntities,
    displays,
    kinds: displayableEntities,
    plumbingClasses: () => WE_PLUMBING_CLASSES,
    provideVocabularies: vocabularies.provide,
    setSpaceTypeColor,
    setSpaceTypePresentation,
    schemaFor,
    entityClass,
    relationTarget,
    titleField,
  };
}
