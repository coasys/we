/**
 * RecordStore — creating one instance of a model, whatever the model turns out to be.
 *
 * The counterpart to {@link ShapeStore}, and deliberately not part of it. That store is about
 * *defining* a model: an occasional, deliberate, admin-shaped act performed by whoever is shaping a
 * community's vocabulary. This one is about *using* one, which is an everyday act performed by
 * everybody. They share a manifest and nothing else — different audiences, different lifetimes, and
 * a wizard whose draft is a list of field declarations has nothing in common with a form whose
 * draft is a list of values.
 *
 * ## Why the draft lives in a store rather than in `$localState`
 *
 * Because the fields come from data. `$localState` names are fixed when a template is written, so a
 * form over a model chosen at runtime has no names to declare, and no `$setLocal` can address a
 * field nobody knew about. That is the same wall the shape wizard hit, and it is why `shapeDraft`
 * sits in a store too — not a preference about where state goes.
 *
 * ## Why it does not create posts
 *
 * A post is composed, not filled in: it is a `CollectionBlock` holding a tree of blocks, authored
 * through `BlockComposer`, which produces a serialized document rather than a set of field values.
 * A surface that offers both should offer the composer for that case and this for the rest — one
 * entry point, two bodies. Folding a document editor into a generated form would serve neither.
 */
import type { EntitySchema } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { getModel } from '@we/models';
import { CORE_MANIFEST } from '@we/models/manifest';
import { Accessor, batch, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import {
  emptyRecordDraft,
  type RecordDraft,
  recordDraftErrors,
  recordDraftFields,
} from '../../../shared/shapes/recordDraft';
import { useDatasetStore } from './DatasetStore';
import { BLOCK_ICONS, useShapeStore } from './ShapeStore';

/** A `we-select` row: the model's name, drawn with its icon and grouped by where it comes from. */
export interface CreatableEntity {
  label: string;
  value: string;
  icon: string;
  group: string;
}

export interface RecordStore {
  /**
   * Models a person can create an instance of here — this space's own first, then WE's own.
   *
   * Built in the store because a schema can `$map` a store array into options but cannot merge two
   * sources and group them, and because the answer changes with the space: a community that has
   * defined three models should see three more entries than one that has defined none.
   */
  creatableEntities: Accessor<CreatableEntity[]>;
  /**
   * The open form's draft, or null while closed — its non-nullness is what mounts the modal, the
   * same shape `shapeStore.shapeDraft` uses.
   */
  recordDraft: Accessor<RecordDraft | null>;
  /** Validation errors from the last save attempt. */
  recordErrors: Accessor<string[]>;
  savingRecord: Accessor<boolean>;
  /**
   * The id of the last record created, empty before the first.
   *
   * Read by a surface that wants to do something with what was just made — select the new node on a
   * graph, scroll to the new row. Kept rather than passed to a callback because `$action`'s
   * `onSuccess` can read a store and cannot hold a value.
   */
  lastCreatedId: Accessor<string>;

  /** Open the form. With an entity, on that model; without, on the picker. */
  openRecordForm: (entity?: string) => void;
  /** Switch which model is being created, discarding the values typed against the last one. */
  setRecordEntity: (entity: string) => void;
  /** Set one field's value. Takes the field name, so one action serves every control. */
  setRecordField: (name: string, value: string | number | boolean) => void;
  cancelRecordForm: () => void;
  /** Validate and create. Errors land in `recordErrors`; success closes the form. */
  saveRecord: () => Promise<void>;
}

const RecordStoreContext = createContext<RecordStore>();

export function RecordStoreProvider(props: ParentProps) {
  const datasetStore = useDatasetStore();
  const shapeStore = useShapeStore();

  const [recordDraft, setRecordDraft] = createSignal<RecordDraft | null>(null);
  const [recordErrors, setRecordErrors] = createSignal<string[]>([]);
  const [savingRecord, setSavingRecord] = createSignal(false);
  const [lastCreatedId, setLastCreatedId] = createSignal('');

  /**
   * WE's own authorable models, read straight off the core manifest.
   *
   * Derived rather than listed, so a model that gains an `authoring` declaration appears here with
   * no second edit in a different package — the failure mode a hardcoded table has is that it is
   * correct on the day it is written and silently stale afterwards.
   */
  const coreEntities = createMemo<CreatableEntity[]>(() =>
    Object.entries(CORE_MANIFEST.entities)
      .filter(([, entity]) => entity.authoring?.fields.length)
      .map(([name]) => ({ label: name, value: name, icon: BLOCK_ICONS[name] ?? 'cube', group: 'Built in' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  /** Models this community defined. Healthy ones only — a shape that failed adoption is not queryable. */
  const shapeEntities = createMemo<CreatableEntity[]>(() =>
    shapeStore
      .spaceShapes()
      .filter((shape) => shape.manifest && !shape.problems.length)
      .map((shape) => ({
        label: shape.name,
        value: shape.name,
        icon: shape.icon || 'cube',
        group: 'This space',
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  // This space's own first: a community that has modelled its vocabulary means those models, and
  // WE's built-ins are the fallback rather than the headline.
  const creatableEntities = createMemo<CreatableEntity[]>(() => [...shapeEntities(), ...coreEntities()]);

  /**
   * The schema behind a name, and whether every property of it belongs to the author.
   *
   * A community shape carries its own manifest and is authorable in full; a core entity is offered
   * only the fields it declared. Shapes are consulted first so a space that names a model after one
   * of WE's own gets its own, which is the same precedence the graph host uses in reverse and for
   * the same reason — whichever is more local should win where the two can collide.
   */
  function schemaFor(entity: string): { schema: EntitySchema; authorable: boolean; icon: string } | undefined {
    const shape = shapeStore.spaceShapes().find((row) => row.name === entity && row.manifest);
    const fromShape = shape?.manifest?.entities[entity];
    if (fromShape) return { schema: fromShape, authorable: true, icon: shape?.icon || 'cube' };

    const core = CORE_MANIFEST.entities[entity];
    if (core) return { schema: core, authorable: false, icon: BLOCK_ICONS[entity] ?? 'cube' };
    return undefined;
  }

  function openRecordForm(entity?: string): void {
    batch(() => {
      setRecordErrors([]);
      setRecordDraft(null);
    });
    // Opening on the first offered model rather than on an empty picker: in a space with one
    // vocabulary that is the only answer, and in a space with several it is still a better start
    // than a form with nothing in it.
    const target = entity || creatableEntities()[0]?.value;
    if (target) setRecordEntity(target);
  }

  function setRecordEntity(entity: string): void {
    const found = schemaFor(entity);
    if (!found) {
      // Nothing here can render a form for a model this space does not have, and a modal that opens
      // empty is worse than one that says why.
      toastService.error(`No model named "${entity}" in this space.`);
      return;
    }
    batch(() => {
      setRecordErrors([]);
      setRecordDraft(
        emptyRecordDraft({ entity, schema: found.schema, authorable: found.authorable, icon: found.icon }),
      );
    });
  }

  /**
   * Replace the whole draft on every keystroke.
   *
   * The shape wizard mutates its rows in place to keep inputs focused, and pays for it with a
   * `commitDraft` call every consumer has to remember. There is nothing derived from a value here —
   * validation runs at save — so a plain immutable update is correct, and the controls are bound to
   * their own value rather than re-created, so nothing loses focus.
   */
  function setRecordField(name: string, value: string | number | boolean): void {
    setRecordDraft((draft) =>
      draft
        ? { ...draft, fields: draft.fields.map((field) => (field.name === name ? { ...field, value } : field)) }
        : draft,
    );
  }

  function cancelRecordForm(): void {
    batch(() => {
      setRecordDraft(null);
      setRecordErrors([]);
    });
  }

  async function saveRecord(): Promise<void> {
    const draft = recordDraft();
    const dataset = datasetStore.currentDataset();
    if (!draft || !dataset) return;

    const errors = recordDraftErrors(draft);
    if (errors.length) {
      setRecordErrors(errors);
      return;
    }

    setSavingRecord(true);
    try {
      const Model = getModel(draft.entity);
      const created = (await Model.create(dataset.handle, recordDraftFields(draft))) as { id?: string };
      batch(() => {
        setLastCreatedId(created?.id ?? '');
        setRecordDraft(null);
        setRecordErrors([]);
      });
      toastService.success(`${draft.label} created.`);
    } catch (error) {
      // Reported into the form rather than only as a toast: the modal stays open holding what was
      // typed, so a failure is something to correct rather than something that loses the work.
      const message = error instanceof Error ? error.message : String(error);
      setRecordErrors([message]);
      console.error('RecordStore: creating a record failed', error);
    } finally {
      setSavingRecord(false);
    }
  }

  const store: RecordStore = {
    creatableEntities,
    recordDraft,
    recordErrors,
    savingRecord,
    lastCreatedId,
    openRecordForm,
    setRecordEntity,
    setRecordField,
    cancelRecordForm,
    saveRecord,
  };

  return <RecordStoreContext.Provider value={store}>{props.children}</RecordStoreContext.Provider>;
}

export function useRecordStore(): RecordStore {
  const ctx = useContext(RecordStoreContext);
  if (!ctx) throw new Error('useRecordStore must be used within RecordStoreProvider');
  return ctx;
}

// Re-exported so a consumer needs one import for the store and the shape of what it holds.
export type { RecordDraft, RecordField } from '../../../shared/shapes/recordDraft';
