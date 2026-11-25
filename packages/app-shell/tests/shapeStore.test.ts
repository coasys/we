/**
 * shapeStore: the space's models read and adopted on a switch, the wizard's draft and its guards,
 * a save, and the hint editor.
 *
 * Plain store tests, run once under each reactivity port: Solid's, and the test port that runs a new
 * effect at once where Solid defers it. The backend is a stand-in schema port that keeps models in a
 * map and records what it installs.
 */
import type { EntityHintState, EntityManifest, StoredShape } from '@we/backend-shared';
import type { ReactivityPort, Setter } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { draftMember, draftToManifest, emptyShapeDraft } from '../src/shared/shapes/shapeDraft';
import type { AppDataset } from '../src/shared/stores/DatasetStore';
import { createShapeStore, type ShapeStore } from '../src/shared/stores/ShapeStore';

const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', createTestReactivity],
];

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function manifestOf(name: string, extractable = false): EntityManifest {
  const lowered = draftToManifest(
    { ...emptyShapeDraft(), name, extractable, members: [draftMember({ name: 'title', required: true })] },
    `${name.toLowerCase()}-uuid`,
  );
  if (!lowered.ok) throw new Error(lowered.errors.join('; '));
  return lowered.manifest;
}

const space = (id: string): AppDataset => ({ id, name: id, handle: { id } }) as never;

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  let reactivity: ReactivityPort;
  const disposers: (() => void)[] = [];
  let toasts: string[];
  let installed: string[];
  let models: Map<string, StoredShape[]>;
  let hints: Map<string, EntityHintState>;
  let llm: boolean;
  /** Held lists: a list read waits on its space's gate while one is set. */
  let gates: Map<string, Promise<void>>;
  let setDataset: Setter<AppDataset | null>;
  let setWeSpace: Setter<boolean>;

  const schemas = {
    shapes: {
      async list(dataset: { id: string }) {
        await gates.get(dataset.id);
        return [...(models.get(dataset.id) ?? [])];
      },
      async save(dataset: { id: string }, shape: Omit<StoredShape, 'id' | 'editable'>, id?: string) {
        const list = models.get(dataset.id) ?? [];
        const recordId = id ?? `record-${shape.name}`;
        models.set(dataset.id, [...list.filter((s) => s.id !== recordId), { ...shape, id: recordId, editable: true }]);
        return recordId;
      },
      async remove(dataset: { id: string }, id: string) {
        models.set(
          dataset.id,
          (models.get(dataset.id) ?? []).filter((s) => s.id !== id),
        );
      },
    },
    declareInDataset: (_dataset: unknown, manifest: EntityManifest) =>
      Object.fromEntries(Object.keys(manifest.entities).map((name) => [name, { name }])),
    async installModules(_dataset: unknown, classes: { name: string }[]) {
      installed.push(...classes.map((c) => c.name));
    },
    hasCoreSchema: async () => true,
    foreignEntries: async () => [],
    async interpretationHints(_dataset: unknown, entity: string) {
      return hints.get(entity) ?? null;
    },
    async setInterpretationHints(_dataset: unknown, entity: string, set: Omit<EntityHintState, 'customized'>) {
      hints.set(entity, { ...set, customized: true });
    },
    async resetInterpretationHints(_dataset: unknown, entity: string) {
      hints.delete(entity);
    },
  };

  function mount(): ShapeStore {
    let store!: ShapeStore;
    const [dataset, writeDataset] = reactivity.signal<AppDataset | null>(space('garden'));
    const [weSpace, writeWeSpace] = reactivity.signal(true);
    const [ports] = reactivity.signal({
      schemas,
      languageModel: { available: async () => llm },
    });
    setDataset = writeDataset;
    setWeSpace = writeWeSpace;
    disposers.push(
      reactivity.root(() => {
        store = createShapeStore({
          reactivity,
          toasts: { success: (m) => toasts.push(m), error: (m) => toasts.push(`error: ${m}`) },
          sessionStore: { backendPorts: ports as never },
          datasetStore: {
            currentDataset: dataset,
            isWeSpace: weSpace,
            currentDatasetEntities: () => [],
            currentDatasetEntitiesLoaded: () => true,
            datasets: () => [space('garden'), space('orchard')],
          },
        });
      }),
    );
    return store;
  }

  beforeEach(() => {
    reactivity = makePort();
    toasts = [];
    installed = [];
    hints = new Map();
    llm = false;
    gates = new Map();
    models = new Map([
      [
        'garden',
        [
          {
            id: 'record-Sighting',
            name: 'Sighting',
            description: 'A bird seen',
            icon: 'bird',
            shapeId: 'we://shapes/sighting-uuid',
            version: 1,
            forkedFrom: '',
            manifest: manifestOf('Sighting', true),
            editable: true,
          },
          {
            id: 'record-Lost',
            name: 'Lost',
            description: '',
            icon: '',
            shapeId: 'we://shapes/lost',
            version: 1,
            forkedFrom: '',
            manifest: null,
            editable: true,
          },
        ],
      ],
    ]);
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it('reads and adopts the space’s models, and says why one does not stand', async () => {
    const store = mount();
    await flush();
    expect(store.shapesLoaded()).toBe(true);
    expect(store.spaceShapes().map((s) => [s.name, s.problems])).toEqual([
      ['Sighting', []],
      ['Lost', ['definition document missing or unreadable']],
    ]);
    expect(installed).toEqual(['Sighting']);
    expect(store.interpretationCandidates()).toContain('Sighting');
    expect(store.interpretationCandidatesLoaded()).toBe(true);
    expect(store.relationshipTargets().find((t) => t.value === 'Sighting')?.icon).toBe('bird');
    expect(store.hintEntities().filter((e) => e.source === 'shape')).toEqual([{ entity: 'Sighting', source: 'shape' }]);
  });

  it('lists nothing, and is loaded, in a space that is not a WE space', async () => {
    const store = mount();
    await flush();
    setWeSpace(false);
    await flush();
    expect(store.spaceShapes()).toEqual([]);
    expect(store.shapesLoaded()).toBe(true);
  });

  it('publishes only the newest space’s models when a switch overtakes a read', async () => {
    let release!: () => void;
    gates.set('garden', new Promise((r) => (release = r)));
    models.set('orchard', []);
    const store = mount();
    await flush();
    expect(store.shapesLoaded()).toBe(false);
    setDataset(space('orchard'));
    await flush();
    release();
    await flush();
    expect(store.spaceShapes()).toEqual([]);
    expect(store.shapesLoaded()).toBe(true);
  });

  it('closes a pristine new draft at once, and asks once something is written', async () => {
    const store = mount();
    await flush();
    store.openShapeWizard();
    expect(store.shapeDraft()).not.toBeNull();
    store.requestCloseWizard();
    expect(store.shapeDraft()).toBeNull();

    store.openShapeWizard();
    store.setShapeField('name', 'Recipe');
    expect(store.generateIntent()).toBe('generate');
    store.requestCloseWizard();
    expect(store.confirmDiscard()).toBe(true);
    store.cancelDiscard();
    expect(store.shapeDraft()?.name).toBe('Recipe');
  });

  it('opens a stored model collapsed, and asks about closing only once it changed', async () => {
    const store = mount();
    await flush();
    store.openShapeWizard('record-Sighting');
    expect(store.editingShapeId()).toBe('record-Sighting');
    expect(store.expandedMembers()).toEqual([]);
    store.requestCloseWizard();
    expect(store.shapeDraft()).toBeNull();

    store.openShapeWizard('record-Lost');
    expect(store.shapeDraft()).toBeNull();
    expect(toasts).toEqual(['error: This model has no readable definition to edit.']);

    store.openShapeWizard('record-Sighting');
    const row = store.shapeDraft()!.members[0];
    // Typed in place, as an input does — the guard reads the draft on the click.
    store.setMemberField(row.rowId, 'hint', 'The species seen');
    store.requestCloseWizard();
    expect(store.confirmDiscard()).toBe(true);
  });

  it('keeps the name pickers and the expanded rows in step with the draft', async () => {
    const store = mount();
    await flush();
    store.openShapeWizard();
    store.addProperty();
    const [row] = store.shapeDraft()!.members;
    expect(store.expandedMembers()).toEqual([row.rowId]);
    store.setMemberField(row.rowId, 'name', 'title');
    store.commitDraft();
    expect(store.identityOptions()).toEqual([
      { label: 'None', value: 'none' },
      { label: 'title', value: row.rowId },
    ]);
    store.setShapeField('name', 'Book');
    expect(store.draftNameMember()).toBe(row.rowId);
    expect(store.nameOptions()[0].label).toBe('Work it out (title)');
    store.setInterpretable(true);
    expect(store.interpretationNeedsIdentity()).toBe(true);
    store.setIdentityMember(row.rowId);
    expect(store.interpretationNeedsIdentity()).toBe(false);
    store.removeMember(row.rowId);
    expect(store.shapeDraft()?.identityMember).toBe('');
    expect(store.expandedMembers()).toEqual([]);
  });

  it('saves a new model: installs it, stores it, enrols it, and reads the list again', async () => {
    const enrolled: string[] = [];
    const store = mount();
    store.provideInterpretationEnroller(async (entity) => void enrolled.push(entity));
    await flush();
    store.openShapeWizard();
    store.setShapeField('name', 'Recipe');
    store.addProperty();
    store.setMemberField(store.shapeDraft()!.members[0].rowId, 'name', 'title');
    store.setInterpretable(true);
    await store.saveShapeDraft();
    await flush();
    expect(installed).toContain('Recipe');
    expect(enrolled).toEqual(['Recipe']);
    expect(toasts).toContain('Model "Recipe" created');
    expect(store.shapeDraft()).toBeNull();
    expect(store.spaceShapes().map((s) => s.name)).toContain('Recipe');
  });

  it('refuses a name the space already uses, and says so', async () => {
    const store = mount();
    await flush();
    store.openShapeWizard();
    store.setShapeField('name', 'Sighting');
    store.addProperty();
    store.setMemberField(store.shapeDraft()!.members[0].rowId, 'name', 'title');
    await store.saveShapeDraft();
    expect(store.draftErrors()).toEqual(['"Sighting" already names a model here — pick another name.']);
    expect(store.savingShape()).toBe(false);
  });

  it('adds a bundle’s record types once, and names a clash with a model it did not bring', async () => {
    const store = mount();
    await flush();
    const problems = await store.addRecordTypes('garden-app', [
      { name: 'Seed', manifest: manifestOf('Seed') },
      { name: 'Sighting', manifest: manifestOf('Sighting') },
    ] as never);
    expect(problems).toEqual(['it already has a kind of record called "Sighting" that this app did not bring']);
    expect(models.get('garden')!.find((s) => s.name === 'Seed')?.shapeId).toBe('we://shapes/bundle/garden-app/Seed');
    expect(await store.addRecordTypes('garden-app', [{ name: 'Seed', manifest: manifestOf('Seed') }] as never)).toEqual(
      [],
    );
    expect(models.get('garden')!.filter((s) => s.name === 'Seed')).toHaveLength(1);
  });

  it('opens the hint editor on the declaration, tells an edit from a read, and saves', async () => {
    const store = mount();
    await flush();
    await store.openHintEditor('Sighting');
    expect(store.hintEditor()?.entity).toBe('Sighting');
    expect(store.hintEditorDirty()).toBe(false);
    store.setHintDraft('class', 'Birds people saw');
    expect(store.hintEditorDirty()).toBe(true);
    await store.saveHintEditor();
    expect(store.hintEditor()).toBeNull();
    expect(hints.get('Sighting')?.classHint).toBe('Birds people saw');
    await store.openHintEditor('Sighting');
    expect(store.hintEditor()?.customized).toBe(true);
    await store.resetHintEditor();
    expect(store.hintEditor()?.customized).toBe(false);
    expect(toasts).toContain('Hints for Sighting reset to defaults');
  });

  it('offers generation only while the backend has a model', async () => {
    const store = mount();
    await flush();
    expect(store.aiAvailable()).toBe(false);
    llm = true;
    const second = mount();
    await flush();
    expect(second.aiAvailable()).toBe(true);
  });
});
