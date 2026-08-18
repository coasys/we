/**
 * ShapeStore — the models a space carries, and their editing surfaces.
 *
 * Owns three things:
 *
 * 1. **The adoption rail.** On every switch into a WE space, Shape records are read from the
 *    space, their manifest documents validated through the same gate module manifests pass
 *    (`validateManifest`, against core vocabulary + sibling shapes + foreign entities), compiled
 *    and registered *for that dataset only*, and their SHACL ensured into the space — after which
 *    `$query { entity: "<ShapeName>" }`, derived forms and extraction all work through machinery
 *    that already existed. The manifest document is the source of truth; the SHACL is its
 *    projection (the relationship the decorated classes have with theirs).
 *
 * 2. **The shape wizard's draft.** Form state lives here rather than in `$localState` because the
 *    rows are structured, interdependent and validated as a whole (the `runtimeStore.aiForm`
 *    precedent). Both authoring frontends — the structured editor and the LLM flow — fill this
 *    same draft; everything from the draft down is one code path.
 *
 * 3. **The hint editor.** Per-space tuning of interpretation hints, for core vocabulary (TaskBlock,
 *    EventBlock) and space shapes alike, through `SchemaPort.interpretationHints` — with the
 *    customized/reset lifecycle that decides whether release improvements still flow.
 */
import { manifestEntries, type ModelManifest, validateManifest } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { asFileField, decodeFileAsJson, encodeJsonFileData, Shape } from '@we/models';
import { CORE_MANIFEST } from '@we/models/generated/coreManifest';
import { Accessor, createContext, createEffect, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { generateShapeDraft as runShapeGeneration } from '../../../shared/ai/shapeGeneration';
import {
  additiveViolations,
  draftToManifest,
  emptyDraftProperty,
  emptyShapeDraft,
  manifestToDraft,
  type ShapeDraft,
  type ShapeDraftProperty,
} from '../../../shared/shapes/shapeDraft';
import { useDatasetStore } from './DatasetStore';
import { useSessionStore } from './SessionStore';

export interface SpaceShapeView {
  /** The Shape record's id. */
  id: string;
  /** Entity name — what `$query` resolves. */
  name: string;
  description: string;
  icon: string;
  shapeId: string;
  version: number;
  forkedFrom: string;
  propertyCount: number;
  /** Why this shape could not be adopted, empty for a healthy one. */
  problems: string[];
  manifest: ModelManifest | null;
}

export interface HintEntityView {
  entity: string;
  /** 'core' = ships with WE (structure immutable, hints tunable); 'shape' = this space's own. */
  source: 'core' | 'shape';
}

export interface HintEditorRow {
  name: string;
  predicate: string;
  hint: string;
  /** What the declaration ships — the value reset returns to. */
  defaultHint: string;
}

export interface HintEditorState {
  entity: string;
  classHint: string;
  defaultClassHint: string;
  rows: HintEditorRow[];
  customized: boolean;
}

export interface ShapeStore {
  // State
  /** The models this space carries, adoption problems included. */
  spaceShapes: Accessor<SpaceShapeView[]>;
  /** The backend has answered for the current space — empty means "none", not "not asked yet". */
  shapesLoaded: Accessor<boolean>;
  /** The wizard's draft, null while the wizard is closed. */
  shapeDraft: Accessor<ShapeDraft | null>;
  /** The Shape record being edited, null when the draft is a new model. */
  editingShapeId: Accessor<string | null>;
  /** Wizard-facing validation errors from the last save attempt. */
  draftErrors: Accessor<string[]>;
  /** A save is in flight. */
  savingShape: Accessor<boolean>;
  /** AI generation is available — the agent has a Claude API key configured. */
  aiAvailable: Accessor<boolean>;
  /** A generation is in flight. */
  generating: Accessor<boolean>;
  /** Entities offering hint tuning here: core interpretable vocabulary plus this space's shapes. */
  hintEntities: Accessor<HintEntityView[]>;
  /** Entity names a reference property may target here, sorted — the wizard's target picker. */
  referenceTargets: Accessor<string[]>;
  /** The hint editor's state, null while closed. */
  hintEditor: Accessor<HintEditorState | null>;
  /** The hint editor is loading or saving. */
  hintBusy: Accessor<boolean>;

  // Actions — wizard
  /** Open the wizard: empty for a new model, or pre-filled from a stored shape's definition. */
  openShapeWizard: (shapeRecordId?: string) => void;
  cancelShapeWizard: () => void;
  /** Set a top-level draft field: 'name' | 'description' | 'icon' | 'classHint'. */
  setShapeField: (field: 'name' | 'description' | 'icon' | 'classHint', value: string) => void;
  addDraftProperty: () => void;
  removeDraftProperty: (index: number) => void;
  /** Set one field of one property row; `options` accepts a comma-separated string. */
  setDraftProperty: (index: number, field: keyof ShapeDraftProperty, value: string | boolean) => void;
  /** Replace the whole draft — the LLM flow's entry point into the shared review path. */
  replaceDraft: (draft: ShapeDraft) => void;
  /**
   * Generate a draft from a plain-language description and land it in the open wizard for review.
   * Never adopts anything itself: generation proposes, the human saves.
   */
  generateShapeDraft: (description: string) => Promise<void>;
  /** Validate, store and adopt the draft. Errors land in `draftErrors`; success closes the wizard. */
  saveShapeDraft: () => Promise<void>;
  /** Delete a shape record. Its SDNA and data remain in the space (uninstall semantics are deliberate). */
  deleteShape: (shapeRecordId: string) => Promise<void>;

  // Actions — hints
  openHintEditor: (entity: string) => Promise<void>;
  closeHintEditor: () => void;
  /** key is 'class' for the class hint, or a property predicate. */
  setHintDraft: (key: string, value: string) => void;
  saveHintEditor: () => Promise<void>;
  /** Back to the declaration's hints; release improvements flow again. */
  resetHintEditor: () => Promise<void>;
}

const ShapeStoreContext = createContext<ShapeStore>();

export function ShapeStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();

  const [spaceShapes, setSpaceShapes] = createSignal<SpaceShapeView[]>([]);
  const [shapesLoaded, setShapesLoaded] = createSignal(false);
  const [shapeDraft, setShapeDraft] = createSignal<ShapeDraft | null>(null);
  const [editingShapeId, setEditingShapeId] = createSignal<string | null>(null);
  const [draftErrors, setDraftErrors] = createSignal<string[]>([]);
  const [savingShape, setSavingShape] = createSignal(false);
  const [hintEditor, setHintEditor] = createSignal<HintEditorState | null>(null);
  const [hintBusy, setHintBusy] = createSignal(false);
  const [generating, setGenerating] = createSignal(false);

  const aiAvailable = createMemo(() => Boolean(datasetStore.agentSettings()?.claudeApiKey));

  const schemas = () => session.backendPorts()?.schemas;
  const handle = () => datasetStore.currentDataset()?.handle;

  /** Core entities worth offering the hint editor: the ones whose declaration carries any hint. */
  const coreHintEntities = Object.entries(CORE_MANIFEST.entities)
    .filter(
      ([, entity]) => entity.interpretationHint || Object.values(entity.properties).some((p) => p.interpretationHint),
    )
    .map(([name]) => name);

  const hintEntities = createMemo<HintEntityView[]>(() => [
    ...coreHintEntities.map((entity) => ({ entity, source: 'core' as const })),
    ...spaceShapes()
      .filter((s) => s.manifest)
      .map((s) => ({ entity: s.name, source: 'shape' as const })),
  ]);

  /** What a reference property may point at here — concrete entities only, sorted for the picker. */
  const referenceTargets = createMemo<string[]>(() =>
    [
      ...Object.entries(CORE_MANIFEST.entities)
        .filter(([, entity]) => !entity.abstract)
        .map(([name]) => name),
      ...datasetStore.currentDatasetModels().map((m) => m.name),
      ...spaceShapes()
        .filter((s) => s.manifest)
        .map((s) => s.name),
    ].sort(),
  );

  /** Entity names a shape may legitimately reference: core + foreign + this space's other shapes. */
  const knownEntityNames = (excludeShapeRecordId?: string) => [
    ...Object.keys(CORE_MANIFEST.entities),
    ...datasetStore.currentDatasetModels().map((m) => m.name),
    ...spaceShapes()
      .filter((s) => s.id !== excludeShapeRecordId)
      .map((s) => s.name),
  ];

  // ── The adoption rail ─────────────────────────────────────────────────────────

  async function adoptShape(view: { name: string; shapeId: string }, manifest: ModelManifest): Promise<void> {
    const ports = schemas();
    const dataset = handle();
    if (!ports || !dataset) return;
    const classes = ports.declareInDataset(dataset, manifest, { moduleId: `shape/${view.shapeId}` });
    for (const cls of Object.values(classes)) await ports.ensure(dataset, cls);
  }

  async function loadShapes(): Promise<void> {
    const ports = schemas();
    const dataset = handle();
    const uuid = datasetStore.currentDataset()?.id;
    if (!ports || !dataset || !datasetStore.isWeSpace()) {
      setSpaceShapes([]);
      setShapesLoaded(true);
      return;
    }
    setShapesLoaded(false);
    try {
      // Spaces created before the Shape entity existed never ran installSpace again — ensure is
      // the diff-first idempotent path, a read in the common case.
      await ports.ensure(dataset, Shape);
      const records = await Shape.findAll(dataset);
      if (datasetStore.currentDataset()?.id !== uuid) return; // navigated away while loading

      const views: SpaceShapeView[] = [];
      const adopted = new Set<string>();
      for (const record of records) {
        const view: SpaceShapeView = {
          id: record.id,
          name: record.name,
          description: record.description,
          icon: record.icon,
          shapeId: record.shapeId,
          version: record.version,
          forkedFrom: record.forkedFrom,
          propertyCount: 0,
          problems: [],
          manifest: null,
        };
        const decoded = record.definition ? decodeFileAsJson(record.definition) : {};
        const manifest = Object.keys(decoded).length ? (decoded as unknown as ModelManifest) : null;
        if (!manifest) {
          view.problems = ['definition document missing or unreadable'];
          views.push(view);
          continue;
        }
        // Validated against everything nameable here except itself — including shapes loaded
        // earlier in this same pass, so sibling references resolve whatever the record order.
        const external = [
          ...Object.keys(CORE_MANIFEST.entities),
          ...datasetStore.currentDatasetModels().map((m) => m.name),
          ...records.map((r) => r.name).filter((n) => n !== record.name),
        ];
        const gate = validateManifest(manifest, { externalEntities: external });
        if (!gate.valid) {
          view.problems = gate.errors.map((e) => `${e.path}: ${e.message}`);
          views.push(view);
          continue;
        }
        view.manifest = gate.manifest;
        const entity = gate.manifest.entities[record.name];
        view.propertyCount = entity ? Object.keys(entity.properties).length + Object.keys(entity.relations).length : 0;
        if (!entity) view.problems = [`definition does not declare an entity named "${record.name}"`];
        views.push(view);
      }

      for (const view of views) {
        if (!view.manifest || view.problems.length || adopted.has(view.name)) continue;
        adopted.add(view.name);
        try {
          await adoptShape(view, view.manifest);
        } catch (err) {
          view.problems = [`adoption failed: ${err instanceof Error ? err.message : String(err)}`];
        }
      }
      if (datasetStore.currentDataset()?.id === uuid) setSpaceShapes(views);
    } catch (err) {
      console.error('ShapeStore: loading space shapes failed', err);
      if (datasetStore.currentDataset()?.id === uuid) setSpaceShapes([]);
    } finally {
      if (datasetStore.currentDataset()?.id === uuid) setShapesLoaded(true);
    }
  }

  createEffect(() => {
    // Re-runs on every dataset switch and when the space's WE-ness settles.
    void datasetStore.currentDataset();
    void datasetStore.isWeSpace();
    void loadShapes();
  });

  // ── Wizard actions ────────────────────────────────────────────────────────────

  function openShapeWizard(shapeRecordId?: string): void {
    setDraftErrors([]);
    if (!shapeRecordId) {
      setEditingShapeId(null);
      setShapeDraft(emptyShapeDraft());
      return;
    }
    const view = spaceShapes().find((s) => s.id === shapeRecordId);
    if (!view?.manifest) {
      toastService.error('This model has no readable definition to edit.');
      return;
    }
    setEditingShapeId(shapeRecordId);
    setShapeDraft(manifestToDraft(view.name, view.manifest, { description: view.description, icon: view.icon }));
  }

  function cancelShapeWizard(): void {
    setShapeDraft(null);
    setEditingShapeId(null);
    setDraftErrors([]);
  }

  function setShapeField(field: 'name' | 'description' | 'icon' | 'classHint', value: string): void {
    const draft = shapeDraft();
    if (draft) setShapeDraft({ ...draft, [field]: value });
  }

  function addDraftProperty(): void {
    const draft = shapeDraft();
    if (draft) setShapeDraft({ ...draft, properties: [...draft.properties, emptyDraftProperty()] });
  }

  function removeDraftProperty(index: number): void {
    const draft = shapeDraft();
    if (draft) setShapeDraft({ ...draft, properties: draft.properties.filter((_, i) => i !== index) });
  }

  function setDraftProperty(index: number, field: keyof ShapeDraftProperty, value: string | boolean): void {
    const draft = shapeDraft();
    if (!draft) return;
    const properties = draft.properties.map((row, i) => (i === index ? { ...row, [field]: value } : row));
    setShapeDraft({ ...draft, properties });
  }

  function replaceDraft(draft: ShapeDraft): void {
    setShapeDraft(draft);
    setDraftErrors([]);
  }

  async function generateShapeDraft(description: string): Promise<void> {
    const apiKey = datasetStore.agentSettings()?.claudeApiKey;
    if (!apiKey || !description.trim()) return;
    setGenerating(true);
    setDraftErrors([]);
    try {
      const existing = knownEntityNames(editingShapeId() ?? undefined);
      const { draft, remainingProblems } = await runShapeGeneration(description, {
        apiKey,
        existingEntities: existing,
        referenceTargets: referenceTargets(),
      });
      // Editing keeps the record's name and predicates — generation only replaces a NEW draft
      // wholesale; on an edit it would orphan storage keys, so it is offered only for new models.
      replaceDraft(draft);
      if (remainingProblems.length) setDraftErrors(remainingProblems);
    } catch (err) {
      console.error('ShapeStore: shape generation failed', err);
      setDraftErrors([`Generation failed: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setGenerating(false);
    }
  }

  async function saveShapeDraft(): Promise<void> {
    const draft = shapeDraft();
    const dataset = handle();
    if (!draft || !dataset) return;
    const editingId = editingShapeId();
    const existing = editingId ? spaceShapes().find((s) => s.id === editingId) : undefined;

    setSavingShape(true);
    setDraftErrors([]);
    try {
      const shapeUuid = existing?.shapeId.replace('we://shapes/', '') || crypto.randomUUID();
      const lowered = draftToManifest(draft, shapeUuid);
      if (!lowered.ok) {
        setDraftErrors(lowered.errors);
        return;
      }
      const entityName = Object.keys(lowered.manifest.entities)[0];
      const nameTaken = knownEntityNames(editingId ?? undefined).includes(entityName);
      if (!existing && nameTaken) {
        setDraftErrors([`"${entityName}" already names a model here — pick another name.`]);
        return;
      }
      if (existing && entityName !== existing.name) {
        setDraftErrors(['Renaming a model is not supported yet — its name is how existing data is found.']);
        return;
      }
      const gate = validateManifest(lowered.manifest, { externalEntities: knownEntityNames(editingId ?? undefined) });
      if (!gate.valid) {
        setDraftErrors(gate.errors.map((e) => `${e.path}: ${e.message}`));
        return;
      }
      if (existing?.manifest) {
        const violations = additiveViolations(existing.manifest, gate.manifest);
        if (violations.length) {
          setDraftErrors(violations);
          return;
        }
      }

      const definition = asFileField(encodeJsonFileData(gate.manifest, 'shape-definition.json'));
      if (existing) {
        const record = (await Shape.findAll(dataset)).find((r) => r.id === existing.id);
        if (!record) throw new Error('shape record disappeared while editing');
        record.description = draft.description;
        record.icon = draft.icon;
        record.version = existing.version + 1;
        record.definition = definition;
        await record.save();
      } else {
        await Shape.create(dataset, {
          name: entityName,
          description: draft.description,
          icon: draft.icon,
          shapeId: `we://shapes/${shapeUuid}`,
          version: 1,
          definition,
        });
      }
      await adoptShape({ name: entityName, shapeId: shapeUuid }, gate.manifest);
      cancelShapeWizard();
      toastService.success(existing ? `Model "${entityName}" updated` : `Model "${entityName}" created`);
      await loadShapes();
    } catch (err) {
      console.error('ShapeStore: saving shape failed', err);
      setDraftErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSavingShape(false);
    }
  }

  async function deleteShape(shapeRecordId: string): Promise<void> {
    const dataset = handle();
    if (!dataset) return;
    try {
      const record = (await Shape.findAll(dataset)).find((r) => r.id === shapeRecordId);
      if (record) await record.delete();
      toastService.success('Model removed. Existing entries keep their data.');
      await loadShapes();
    } catch (err) {
      console.error('ShapeStore: deleting shape failed', err);
      toastService.error('Removing the model failed.');
    }
  }

  // ── Hint editor actions ───────────────────────────────────────────────────────

  /** The declared (shipped) hints for an entity, from whichever manifest declares it. */
  function declaredHintSource(entity: string): {
    classHint: string;
    rows: { name: string; predicate: string; hint: string }[];
  } {
    const shape = spaceShapes().find((s) => s.name === entity && s.manifest);
    const manifest = shape?.manifest ?? CORE_MANIFEST;
    const entry = manifestEntries(manifest).find((e) => e.name === entity);
    return {
      classHint: entry?.interpretationHint ?? '',
      rows: (entry?.properties ?? [])
        .filter((p) => p.type !== 'uri')
        .map((p) => ({ name: p.name, predicate: p.predicate, hint: p.interpretationHint ?? '' })),
    };
  }

  async function openHintEditor(entity: string): Promise<void> {
    const ports = schemas();
    const dataset = handle();
    if (!ports || !dataset) return;
    setHintBusy(true);
    try {
      const declared = declaredHintSource(entity);
      const stored = await ports.interpretationHints(dataset, entity);
      setHintEditor({
        entity,
        classHint: stored?.classHint ?? declared.classHint,
        defaultClassHint: declared.classHint,
        rows: declared.rows.map((row) => ({
          name: row.name,
          predicate: row.predicate,
          hint: stored ? (stored.propHints[row.predicate] ?? '') : row.hint,
          defaultHint: row.hint,
        })),
        customized: stored?.customized ?? false,
      });
    } catch (err) {
      console.error('ShapeStore: reading hints failed', err);
      toastService.error('Could not read this model’s hints.');
    } finally {
      setHintBusy(false);
    }
  }

  function closeHintEditor(): void {
    setHintEditor(null);
  }

  function setHintDraft(key: string, value: string): void {
    const editor = hintEditor();
    if (!editor) return;
    if (key === 'class') {
      setHintEditor({ ...editor, classHint: value });
    } else {
      setHintEditor({
        ...editor,
        rows: editor.rows.map((row) => (row.predicate === key ? { ...row, hint: value } : row)),
      });
    }
  }

  async function saveHintEditor(): Promise<void> {
    const ports = schemas();
    const dataset = handle();
    const editor = hintEditor();
    if (!ports || !dataset || !editor) return;
    setHintBusy(true);
    try {
      await ports.setInterpretationHints(dataset, editor.entity, {
        classHint: editor.classHint,
        propHints: Object.fromEntries(editor.rows.map((row) => [row.predicate, row.hint])),
      });
      setHintEditor(null);
      toastService.success(`Hints for ${editor.entity} saved for this space`);
    } catch (err) {
      console.error('ShapeStore: saving hints failed', err);
      toastService.error('Saving hints failed.');
    } finally {
      setHintBusy(false);
    }
  }

  async function resetHintEditor(): Promise<void> {
    const ports = schemas();
    const dataset = handle();
    const editor = hintEditor();
    if (!ports || !dataset || !editor) return;
    setHintBusy(true);
    try {
      await ports.resetInterpretationHints(dataset, editor.entity);
      toastService.success(`Hints for ${editor.entity} reset to defaults`);
      await openHintEditor(editor.entity);
    } catch (err) {
      console.error('ShapeStore: resetting hints failed', err);
      toastService.error('Resetting hints failed.');
    } finally {
      setHintBusy(false);
    }
  }

  const store: ShapeStore = {
    spaceShapes,
    shapesLoaded,
    shapeDraft,
    editingShapeId,
    draftErrors,
    savingShape,
    aiAvailable,
    generating,
    hintEntities,
    referenceTargets,
    hintEditor,
    hintBusy,
    openShapeWizard,
    cancelShapeWizard,
    setShapeField,
    addDraftProperty,
    removeDraftProperty,
    setDraftProperty,
    replaceDraft,
    generateShapeDraft,
    saveShapeDraft,
    deleteShape,
    openHintEditor,
    closeHintEditor,
    setHintDraft,
    saveHintEditor,
    resetHintEditor,
  };

  return <ShapeStoreContext.Provider value={store}>{props.children}</ShapeStoreContext.Provider>;
}

export function useShapeStore(): ShapeStore {
  const ctx = useContext(ShapeStoreContext);
  if (!ctx) throw new Error('useShapeStore must be used within ShapeStoreProvider');
  return ctx;
}
