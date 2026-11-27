/**
 * ShapeStore — the models a space carries, and their editing surfaces.
 *
 * Owns three things:
 *
 * 1. **The adoption rail.** On every switch into a WE space, the space's models are read through its
 *    backend's `SchemaPort.shapes` (a `Shape` record per model by default), validated through the
 *    same gate module manifests pass (`validateManifest`, against core vocabulary + sibling shapes
 *    + foreign entities — `shapeViewsOf`), compiled and registered *for that dataset only*, and
 *    their schema installed into the space — after which
 *    `$query { entity: "<ShapeName>" }`, derived forms and extraction all work through machinery
 *    that already existed. Where each model is kept — a manifest document, or the backend's own
 *    schema read back as one — is the store's; everything here speaks in manifests.
 *
 * 2. **The shape wizard's draft.** Form state lives here rather than in `$localState` because the
 *    rows are structured, interdependent and validated as a whole (the `runtimeStore.aiForm`
 *    precedent). Both authoring frontends — the structured editor and the LLM flow — fill this
 *    same draft; everything from the draft down is one code path.
 *
 * 3. **The hint editor.** Per-space tuning of interpretation hints, for core vocabulary (TaskBlock,
 *    EventBlock) and space shapes alike, through `SchemaPort.interpretationHints` — with the
 *    customized/reset lifecycle that decides whether release improvements still flow.
 *
 * Written against the reactivity port. The rules each job applies — which models stand, what may
 * be interpreted, what the generate button would do, what a hint editor opens on — are plain
 * functions beside it in `shared/shapes/`; this file decides when they are asked.
 */
import {
  type DatasetHandle,
  ModuleSchemasRefused,
  type ShapeInput,
  type ShapeStore as ShapeStorage,
  trace,
  validateManifest,
} from '@we/backend-shared';
import { createJsonShapeStore, getRegisteredEntityNames, Shape } from '@we/entities';
import { latest } from '@we/module-shared';
import type { Accessor, ReactivityPort } from '@we/reactivity';
import type { BundleRecordType } from '@we/schema-shared';

import { generateShapeDraft as runShapeGeneration, type ShapeGenerationTransport } from '../ai/shapeGeneration';
import { distinctSignal } from '../distinctSignal';
import { hostSlot } from '../hostSlot';
import {
  declaredHintsOf,
  type HintEditorState,
  hintEditorStateOf,
  hintEntitiesOf,
  type HintEntityView,
} from '../shapes/hintEditor';
import {
  additiveViolations,
  authoredFields,
  draftToManifest,
  emptyDraftProperty,
  emptyDraftRelationship,
  emptyShapeDraft,
  type GeneratedOutput,
  manifestToDraft,
  type ShapeDraft,
  type ShapeDraftMember,
  syncDerived,
} from '../shapes/shapeDraft';
import {
  draftHasWork,
  draftNameMemberOf,
  generatedOutputOf,
  type GenerateIntent,
  generateIntentOf,
  generationPrompt,
  landGeneratedFields,
  namedPropertyOptions,
  nameOptionsOf,
} from '../shapes/shapeWizard';
import {
  interpretationCandidatesOf,
  knownEntityNames as knownEntityNamesOf,
  type RelationshipTargetOption,
  relationshipTargetOptions,
  shapeViewsOf,
  type SpaceShapeView,
} from '../shapes/spaceShapes';
import type { Toasts } from '../toasts';
import type { DatasetStore } from './DatasetStore';
import type { SessionStore } from './SessionStore';

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
  /**
   * Entity names an interpretation pass *could* write here — core vocabulary that declares itself
   * extractable, plus every adopted shape that does.
   *
   * Candidacy, not a decision. Which of these a call actually looks for is two layers down: the
   * space names its defaults (`spaceStore.interpretationTargets`) and a call may add or remove for
   * itself. Read this to offer a choice, and to *display* findings — a card should show a record
   * somebody interpreted an hour ago even if the target has since been switched off.
   */
  interpretationCandidates: Accessor<string[]>;
  /**
   * `interpretationCandidates` is the whole list. Core vocabulary is in it at once; this space's models
   * and the classes it already had arrive a few round trips later, so until this is true the list
   * may be missing members that are coming.
   */
  interpretationCandidatesLoaded: Accessor<boolean>;
  /**
   * The same candidacy, answered for a dataset that may not be the one on screen: its shapes and
   * its foreign classes read through the handle, so a call asking about its own space while
   * another is up narrows by the rule the live list does. Async — both are a read.
   *
   * `installed` names the foreign classes the dataset holds: present whether or not this session
   * has registered them, which the read deliberately does not.
   */
  interpretationCandidatesFor(dataset: DatasetHandle): Promise<{ candidates: string[]; installed: string[] }>;
  /** Options for the relationship target picker — `{ label, value }`, grouped and labelled. */
  relationshipTargets: Accessor<RelationshipTargetOption[]>;
  /**
   * Options for the identity picker: "None" plus every named property of the open draft.
   *
   * Built here rather than `$map`-ped in the schema for the same reason as
   * `appearance.templateOverrideOptions` — a schema can map a store array into options but cannot
   * prepend one, and without the "None" entry the choice would be one-way.
   */
  identityOptions: Accessor<{ label: string; value: string }[]>;
  /**
   * Options for the name picker: "Work it out" plus every named property of the open draft.
   *
   * The same shape as {@link identityOptions} and a different first entry, because the two
   * defaults mean different things: no identity means *no dedup key*, where no name means the
   * property is *derived* — from what the fields are called, then from the model's shape. Saying
   * "None" for that would claim a record has no name, which is never true.
   */
  nameOptions: Accessor<{ label: string; value: string }[]>;
  /**
   * The row id of the field that will name a record of the open draft — the one chosen, or, while
   * the picker is on "Work it out", the one worked out. Empty when no field qualifies.
   */
  draftNameMember: Accessor<string>;
  /** The hint editor's state, null while closed. */
  hintEditor: Accessor<HintEditorState | null>;
  /** The hint editor is loading or saving. */
  hintBusy: Accessor<boolean>;
  /**
   * SpaceStore supplies "add this model to the space's default interpretation targets".
   *
   * Lent rather than read, because SpaceStore owns the `Space` record and is built *after* this
   * store.
   *
   * Used on save and nowhere else, which is what makes the imported case behave: a shape that
   * arrives already marked extractable — copied, forked, synced from a peer — becomes a *candidate*
   * this space can switch on, not a target that starts writing into it unasked.
   */
  provideInterpretationEnroller: (enrol: (entity: string) => Promise<void>) => () => void;

  // Actions — wizard
  /** Open the wizard: empty for a new model, or pre-filled from a stored shape's definition. */
  openShapeWizard: (shapeRecordId?: string) => void;
  cancelShapeWizard: () => void;
  /** Set a top-level draft field: 'name' | 'description' | 'icon' | 'classHint'. */
  setShapeField: (field: 'name' | 'description' | 'icon' | 'classHint', value: string) => void;
  /** Choose which member is the interpretation dedup key; 'none' (or '') clears it. */
  setIdentityMember: (rowId: string) => void;
  /**
   * Choose which member names an instance; 'none' (or '') returns it to being worked out.
   *
   * Deliberately a second picker rather than a reuse of the identity one: a dedup key may be a
   * composite nobody would recognise (an event's is its title and day glued together), and a name
   * is what a card, a graph caption and a drag chip all show.
   */
  setNameMember: (rowId: string) => void;
  /**
   * Whether an AI extraction pass may write instances of the open draft — its own action rather
   * than a `setShapeField` case because the value is a boolean and the field takes strings.
   */
  setInterpretable: (on: boolean) => void;
  /**
   * The open draft would be extracted into, and has no field to recognise what it already wrote.
   *
   * Worth saying rather than refusing: a model with no identity property still extracts, it just
   * duplicates everything on every pass — so this is a warning beside the switch, and the wizard
   * saves either way.
   */
  interpretationNeedsIdentity: Accessor<boolean>;
  addProperty: () => void;
  addRelationship: () => void;
  removeMember: (rowId: string) => void;
  /** Set one field of one member row; `options` accepts a comma-separated string. */
  setMemberField: (rowId: string, field: keyof ShapeDraftMember, value: string | boolean) => void;
  /** Apply a drag-reorder from the row ids in their new order. */
  reorderMembers: (rowIds: string[]) => void;
  /**
   * Each member's default-value picker entries, keyed by row.
   *
   * Read with `$find` on `rowId` rather than off `$member` itself: the row object is deliberately
   * mutated in place while typing (so the input keeps focus), which means anything hanging off it
   * cannot be reactive. Reading through the store is, so the picker follows the values as they are
   * committed without the row having to re-render.
   */
  memberOptions: Accessor<{ rowId: string; options: { label: string; value: string }[] }[]>;
  /** Row ids whose detail panel is open — hints, defaults and options live behind it. */
  expandedMembers: Accessor<string[]>;
  /** Open or close one member's detail panel. */
  toggleMemberExpanded: (rowId: string) => void;
  /**
   * Publish in-place edits to the draft signal.
   *
   * Typed fields are mutated without touching the signal so the input keeps focus, which leaves
   * anything *derived* from them stale — the default picker for a `select` reads the options being
   * typed a field away. Call this where an edit is finished (a blur) rather than on every keystroke.
   */
  commitDraft: () => void;
  /** Replace the whole draft — the LLM flow's entry point into the shared review path. */
  replaceDraft: (draft: ShapeDraft) => void;
  /**
   * Generate a draft from a plain-language description and land it in the open wizard for review.
   * Never adopts anything itself: generation proposes, the human saves.
   */
  /**
   * Generate a whole draft from free prose — every field, name and hints included. No wizard
   * control is wired to this any more (the typed route is {@link generateShapeFields}); it stays
   * because it is the engine a spoken route needs: transcription in, the same review form out.
   */
  generateShapeDraft: (description: string) => Promise<void>;
  /**
   * Generate the draft's members from what its author already wrote — name, description, AI hint.
   * The complement of {@link generateShapeDraft}: that flow starts from prose and replaces the
   * whole draft; this one respects the fields the author typed and fills in the structure.
   */
  generateShapeFields: () => Promise<void>;
  /**
   * What the generate button would do right now — label it from this, and disable it on 'none'.
   *
   * 'generate' and 'regenerate' run immediately; 'replace' would discard hand-written rows, so it
   * raises {@link confirmReplaceFields} instead. Route the button through
   * {@link requestGenerateFields}, which makes that choice itself.
   */
  generateIntent: Accessor<GenerateIntent>;
  /** Generate, or ask first when the click would discard work. The button's own entry point. */
  requestGenerateFields: () => void;
  /** Whether the "replace the fields below?" confirmation is showing. */
  confirmReplaceFields: Accessor<boolean>;
  /** Dismiss that confirmation, keeping the fields as they are. */
  cancelReplaceFields: () => void;
  /**
   * Close the wizard, asking first when there is work to lose.
   *
   * Wired to the modal's own `close`, so a click on the backdrop goes through it too — that being
   * the way a half-written model actually got thrown away.
   */
  requestCloseWizard: () => void;
  /** Whether the "discard this?" confirmation is showing. */
  confirmDiscard: Accessor<boolean>;
  /** Keep editing — dismiss the confirmation without closing. */
  cancelDiscard: () => void;
  /** Validate, store and adopt the draft. Errors land in `draftErrors`; success closes the wizard. */
  saveShapeDraft: () => Promise<void>;
  /**
   * Write record types a bundle brings into a space — the one on screen, or the joined dataset
   * `datasetId` names — and adopt them, skipping any the space already has from the same bundle.
   * Resolves with why each could not be added (empty when all were). The caller decides who may: this
   * is wiring, not template API.
   */
  addRecordTypes: (bundleId: string, types: readonly BundleRecordType[], datasetId?: string) => Promise<string[]>;
  /** Delete a shape record. Its installed shape and data remain in the space (uninstall semantics are deliberate). */
  deleteShape: (shapeRecordId: string) => Promise<void>;

  // Actions — hints
  openHintEditor: (entity: string) => Promise<void>;
  closeHintEditor: () => void;
  /**
   * Whether the open hint editor holds unsaved edits — what a discard guard reads.
   *
   * A store rather than a `$localState` expression, because the rows come from the model's
   * declaration: a schema has no set of local names it could test. Same reason
   * `recordStore.recordDraftDirty` exists.
   */
  hintEditorDirty: () => boolean;
  /** key is 'class' for the class hint, or a property's name. */
  setHintDraft: (key: string, value: string) => void;
  saveHintEditor: () => Promise<void>;
  /** Back to the declaration's hints; release improvements flow again. */
  resetHintEditor: () => Promise<void>;
}

/** What the shape store reads of the dataset store: the space on screen, and the classes it already had. */
export type ShapeDatasets = Pick<
  DatasetStore,
  'currentDataset' | 'isWeSpace' | 'currentDatasetEntities' | 'currentDatasetEntitiesLoaded' | 'datasets'
>;

export interface ShapeStoreDeps {
  reactivity: ReactivityPort;
  toasts: Pick<Toasts, 'success' | 'error'>;
  sessionStore: Pick<SessionStore, 'backendPorts'>;
  datasetStore: ShapeDatasets;
}

export function createShapeStore(deps: ShapeStoreDeps): ShapeStore {
  const { reactivity, toasts } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const session = deps.sessionStore;
  const datasetStore = deps.datasetStore;
  // Every write skips a value the signal already holds, so a reader wakes only for a change.
  const signal = <T>(initial: T) => distinctSignal(reactivity, initial);

  const [spaceShapes, setSpaceShapes] = signal<SpaceShapeView[]>([]);
  const [shapesLoaded, setShapesLoaded] = signal(false);
  const [shapeDraft, setShapeDraft] = signal<ShapeDraft | null>(null);

  /**
   * The draft as it was when the wizard opened, serialised — for the discard guard on an *edit*.
   *
   * A plain variable rather than a signal: nothing renders from it, and it is read once, at the
   * moment somebody tries to close. Null for a new model, which has no "before" to compare with.
   */
  let openedDraft: string | null = null;
  const [editingShapeId, setEditingShapeId] = signal<string | null>(null);
  const [draftErrors, setDraftErrors] = signal<string[]>([]);
  const [savingShape, setSavingShape] = signal(false);
  const [hintEditor, setHintEditor] = signal<HintEditorState | null>(null);

  /** The hint editor as it was when it opened, serialised — see `hintEditorDirty`. */
  let openedHints: string | null = null;
  const [hintBusy, setHintBusy] = signal(false);
  const [generating, setGenerating] = signal(false);
  const [expandedMembers, setExpandedMembers] = signal<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = signal(false);
  const [confirmReplaceFields, setConfirmReplaceFields] = signal(false);
  /**
   * What generation last put into the draft, or null if it never has: its own words for each
   * top-level field it answered (empty where the author's own survived), and a signature of the rows.
   *
   * This is what separates the author's intent from the machine's output, and both halves of the
   * generate flow turn on it. The rows decide whether a re-run is "try again" or "throw away what I
   * wrote". The words decide what a re-run is even *about*: prompting with a description generation
   * wrote itself feeds the last answer back in as though it were a request, which is how renaming a
   * model and pressing Regenerate returned something half about the old subject.
   */
  const [lastGenerated, setLastGenerated] = signal<GeneratedOutput | null>(null);

  const memberOptions = memo(() =>
    (shapeDraft()?.members ?? []).map((m) => ({ rowId: m.rowId, options: m.defaultOptions })),
  );

  /*
    The backend's own model — the node the community runs on, same as transcription, extraction and
    the template editor. There was a fallback to an Anthropic key the agent had pasted into the
    editor; nothing has set that key since the editor moved onto the backend's model.
  */
  const [aiAvailable, setBackendLlm] = signal(false);
  effect(() => {
    const port = session.backendPorts()?.languageModel;
    if (!port) {
      setBackendLlm(false);
      return;
    }
    // Only the backend still connected answers: a slow answer from the one before it would say
    // whether a model is there on a node this session has left.
    let asking = true;
    onCleanup(() => (asking = false));
    void port
      .available()
      .then((available) => asking && setBackendLlm(available))
      .catch(() => asking && setBackendLlm(false));
  });

  /** The transport a generation should run on right now, or null while the backend has no model. */
  function generationTransport(): ShapeGenerationTransport | null {
    const port = session.backendPorts()?.languageModel;
    return aiAvailable() && port ? { kind: 'backend', port } : null;
  }

  /*
    Filled in by SpaceStore, which owns the `Space` record and is built after this store — see
    `provideInterpretationEnroller`. Unset until it does, and a save before then simply does not enrol.
  */
  const interpretationEnroller = hostSlot<(entity: string) => Promise<void>>();

  const schemas = () => session.backendPorts()?.schemas;
  const handle = () => datasetStore.currentDataset()?.handle;
  /** Where this backend keeps the space's models: its own store, or a `Shape` record each. */
  const jsonShapes = createJsonShapeStore(async (dataset) => {
    await schemas()?.ensure(dataset, Shape);
  });
  const storage = (): ShapeStorage => schemas()?.shapes ?? jsonShapes;

  const hintEntities = memo<HintEntityView[]>(() => hintEntitiesOf(spaceShapes()));

  // What could be interpreted in this space — see `interpretationCandidatesOf`.
  const candidatesRead = memo(() =>
    interpretationCandidatesOf(spaceShapes(), datasetStore.currentDatasetEntities(), getRegisteredEntityNames()),
  );
  effect(() => {
    const { shadowed } = candidatesRead();
    if (shadowed.length)
      console.warn(
        `extraction: not offering ${shadowed.map((n) => `"${n}"`).join(', ')} from this space's own classes — ` +
          `WE has a class of the same name, which the name would extract into instead`,
      );
  });

  const interpretationCandidates = memo<string[]>(() => candidatesRead().candidates);

  /*
    The same rule read through a handle rather than the signals a switch fills — SpaceStore's
    off-screen collection reads ask about the collection's own dataset, which may not be the one
    on screen. Its shapes are listed and validated as `loadShapes` validates them — a manifest
    that could not stand is no candidate — and `foreignEntries` answers the classes it already
    had. The read is the pure one: `foreignSchemas` *registers* what it finds, which on some
    backends replaces the dataset's registry of synthesised classes — adopted shapes' compiled
    classes included — and an ask about a dataset nobody is adopting into must not take its classes
    apart as the price of asking.
  */
  async function interpretationCandidatesFor(
    dataset: DatasetHandle,
  ): Promise<{ candidates: string[]; installed: string[] }> {
    // `loadShapes` publishes no adopted shapes for a dataset that is not a WE space, so neither
    // does this: a stored shape document there is no candidate on screen and none off it. The
    // foreign read still answers a stored shape's class, though, so its name is kept out of the
    // foreign candidates instead of being offered as though the space had brought it.
    const weSpace = (await schemas()?.hasCoreSchema(dataset)) === true;
    const [stored, allForeign] = await Promise.all([
      storage().list(dataset),
      schemas()?.foreignEntries(dataset) ?? Promise.resolve([]),
    ]);
    const records = weSpace ? stored : [];
    const storedNames = new Set(stored.map((record) => record.name));
    const foreign = weSpace ? allForeign : allForeign.filter((m) => !storedNames.has(m.name));
    const shapes = shapeViewsOf(
      records,
      foreign.map((m) => m.name),
    );
    return {
      candidates: interpretationCandidatesOf(shapes, foreign, getRegisteredEntityNames()).candidates,
      installed: allForeign.map((m) => m.name),
    };
  }

  /*
    Whether the candidates are whole. A picker shows the core classes at once; a standing watch
    waits for the rest, because a watch registered from part of the list is removed and registered
    again when the rest arrives — writes to the shared graph from every member, ending where they
    started.
  */
  const interpretationCandidatesLoaded = memo(() => shapesLoaded() && datasetStore.currentDatasetEntitiesLoaded());

  const relationshipTargets = memo<RelationshipTargetOption[]>(() =>
    relationshipTargetOptions(spaceShapes(), datasetStore.currentDatasetEntities()),
  );

  /** Every named property of the open draft — what both member pickers choose from. */
  const namedProperties = memo(() => namedPropertyOptions(shapeDraft()));

  const identityOptions = memo<{ label: string; value: string }[]>(() => [
    { label: 'None', value: 'none' },
    ...namedProperties(),
  ]);

  const draftNameMember = memo<string>(() => draftNameMemberOf(shapeDraft()));

  const nameOptions = memo<{ label: string; value: string }[]>(() => nameOptionsOf(shapeDraft(), draftNameMember()));

  /** Entity names a shape may legitimately reference: core + foreign + this space's other shapes. */
  const knownEntityNames = (excludeShapeRecordId?: string) =>
    knownEntityNamesOf(spaceShapes(), datasetStore.currentDatasetEntities(), excludeShapeRecordId);

  // ── The adoption rail ─────────────────────────────────────────────────────────

  /**
   * Compile a stored model and install its schema into the space.
   *
   * Every class the model declares goes in one install, which the backend takes or refuses whole: a
   * refused model leaves none of its classes behind. Rejects with the backend's reason.
   *
   * `install: false` declares the runtime classes only, for a model whose stored schema says more
   * than its manifest can (`StoredShape.editable` false): the stored shape is already registered —
   * it is where the manifest was read from — and installing the compiled one would write the
   * reduced schema over it.
   */
  async function adoptShape(shape: ShapeInput, dataset = handle(), install = true): Promise<void> {
    const ports = schemas();
    if (!ports || !dataset) return;
    const view = { name: shape.name, shapeId: shape.shapeId.replace('we://shapes/', '') };
    const manifest = shape.manifest;
    const started = performance.now();
    const classes = ports.declareInDataset(dataset, manifest, { moduleId: `shape/${view.shapeId}` });
    const declared = performance.now();
    try {
      if (install) await ports.installModules(dataset, Object.values(classes));
    } catch (err) {
      // The model is the only module in the call, so the refusal's reason is the model's.
      if (err instanceof ModuleSchemasRefused) throw new Error(err.refused.map((r) => r.reason).join('; '));
      throw err;
    }
    trace('shapes', 'adopt', {
      name: view.name,
      classes: Object.keys(classes).length,
      declareMs: Math.round(declared - started),
      ensureMs: Math.round(performance.now() - declared),
    });
  }

  /** The newest `loadShapes` — see `current` inside it. */
  const shapesLoad = latest();

  async function loadShapes(): Promise<void> {
    const ports = schemas();
    const dataset = handle();
    const uuid = datasetStore.currentDataset()?.id;
    // Only the newest load publishes. Saving a model reloads while an earlier load can still be
    // adopting, and that one finishing first showed the older list and called it whole.
    const loadIsLatest = shapesLoad.begin();
    const current = () => loadIsLatest() && untrack(datasetStore.currentDataset)?.id === uuid;
    if (!ports || !dataset || !datasetStore.isWeSpace()) {
      batch(() => {
        setSpaceShapes([]);
        setShapesLoaded(true);
      });
      return;
    }
    setShapesLoaded(false);
    const started = performance.now();
    let step = started;
    const lap = () => {
      const now = performance.now();
      const ms = Math.round(now - step);
      step = now;
      return ms;
    };
    try {
      const records = await storage().list(dataset);
      trace('shapes', 'records', { space: uuid, count: records.length, ms: lap() });
      if (!current()) return; // navigated away, or reloaded, while loading

      const views = shapeViewsOf(
        records,
        untrack(datasetStore.currentDatasetEntities).map((m) => m.name),
      );
      trace('shapes', 'validated', { space: uuid, ms: lap() });
      const adopted = new Set<string>();
      for (const view of views) {
        if (!view.manifest || view.problems.length || adopted.has(view.name)) continue;
        adopted.add(view.name);
        try {
          await adoptShape({ ...view, manifest: view.manifest }, dataset, view.editable);
        } catch (err) {
          view.problems = [`adoption failed: ${err instanceof Error ? err.message : String(err)}`];
        }
      }
      trace('shapes', 'ready', {
        space: uuid,
        models: adopted.size,
        adoptMs: lap(),
        totalMs: Math.round(performance.now() - started),
        sincePageStartMs: Math.round(performance.now()),
      });
      if (current()) setSpaceShapes(views);
    } catch (err) {
      console.error('ShapeStore: loading space shapes failed', err);
      if (current()) setSpaceShapes([]);
    } finally {
      if (current()) setShapesLoaded(true);
    }
  }

  effect(() => {
    // Re-runs on every dataset switch, when the space's WE-ness settles, and on a new backend.
    void datasetStore.currentDataset();
    void datasetStore.isWeSpace();
    void session.backendPorts();
    untrack(() => void loadShapes());
  });

  // ── Wizard actions ────────────────────────────────────────────────────────────

  function openShapeWizard(shapeRecordId?: string): void {
    // A schema $invoke with no declared args passes the DOM event as the first argument, so
    // anything but a real id means "new model" — without this, the New button arrived carrying a
    // MouseEvent and the wizard refused to open.
    const recordId = typeof shapeRecordId === 'string' && shapeRecordId ? shapeRecordId : undefined;
    if (!recordId) {
      const draft = emptyShapeDraft();
      // A new model starts from nothing, and the field tests below are what judge it — no snapshot.
      openedDraft = null;
      // Batched: two separate writes mount the wizard with nothing expanded and then expand it, so
      // the starter row played its opening animation every time the modal was opened. Together they
      // are one update, and the row is simply open from the first frame.
      batch(() => {
        resetGenerationState();
        setEditingShapeId(null);
        setShapeDraft(draft);
        // The one starter row opens: it is about to be filled in.
        setExpandedMembers(draft.members.map((m) => m.rowId));
      });
      return;
    }
    const view = untrack(spaceShapes).find((s) => s.id === recordId);
    if (!view?.manifest) {
      resetGenerationState();
      toasts.error('This model has no readable definition to edit.');
      return;
    }
    const draft = manifestToDraft(view.name, view.manifest, { description: view.description, icon: view.icon });
    // What it looked like on open, so the guard can ask whether anything actually changed. See
    // `draftHasWork`.
    openedDraft = JSON.stringify(draft);
    batch(() => {
      resetGenerationState();
      setEditingShapeId(recordId);
      setShapeDraft(draft);
      // A stored model opens collapsed — the list is there to be read before it is edited.
      setExpandedMembers([]);
    });
  }

  /**
   * What opening the wizard clears, whatever it opens on: the last save's errors, and the record of
   * what generation wrote — nothing in a freshly opened draft was generated yet, so every word in it
   * is the author's, including a stored model's own description.
   */
  function resetGenerationState(): void {
    setDraftErrors([]);
    setLastGenerated(null);
    setConfirmReplaceFields(false);
  }

  function requestCloseWizard(): void {
    // Evaluated on the click rather than memoised: rows are mutated in place without touching the
    // signal (see the note below `cancelShapeWizard`), so nothing would notify a memo.
    const work = untrack(() => draftHasWork(shapeDraft(), editingShapeId() ? { opened: openedDraft } : null));
    if (work) setConfirmDiscard(true);
    else cancelShapeWizard();
  }

  function cancelDiscard(): void {
    setConfirmDiscard(false);
  }

  function cancelShapeWizard(): void {
    batch(() => {
      setConfirmDiscard(false);
      setConfirmReplaceFields(false);
      setShapeDraft(null);
      setEditingShapeId(null);
      setDraftErrors([]);
      setExpandedMembers([]);
      setLastGenerated(null);
    });
  }

  /*
    Typed-input edits mutate the draft IN PLACE, deliberately without touching the signal.

    The renderer keys $each rows by object reference and captures context refs as plain values, so
    replacing the draft (or a row) on every keystroke remounts the very input being typed in — the
    caret drops after each character. Nothing needs the re-render: the DOM already shows the typed
    text, and save() reads the mutated draft. Reactivity is reserved for edits that change what a
    row *renders* (type, switches, reference target) and for structural edits (add/remove rows),
    which replace objects and accept the remount — there is no caret to lose in a select.
  */
  function setShapeField(field: 'name' | 'description' | 'icon' | 'classHint', value: string): void {
    const draft = untrack(shapeDraft);
    /*
      Published, not mutated in place. In-place mutation is the *member rows'* concession — they
      live in an $each keyed by object identity, where replacing a row remounts it and drops input
      focus. These fields are ordinary controlled inputs outside any keyed loop, and mutating
      silently left every reactive reader stale: the generate button stayed disabled after a name
      was typed, then enabled when adding a row happened to republish the signal.
    */
    if (draft) setShapeDraft({ ...draft, [field]: value });
  }

  function setIdentityMember(rowId: string): void {
    const draft = untrack(shapeDraft);
    // '' is the "None" option, and the only way to clear it.
    if (draft) setShapeDraft({ ...draft, identityMember: rowId === 'none' ? '' : rowId });
  }

  function setNameMember(rowId: string): void {
    const draft = untrack(shapeDraft);
    // 'none' here is "work it out" rather than "there isn't one" — see `nameOptions`.
    if (draft) setShapeDraft({ ...draft, nameMember: rowId === 'none' ? '' : rowId });
  }

  function setInterpretable(on: boolean): void {
    const draft = untrack(shapeDraft);
    if (draft) setShapeDraft({ ...draft, extractable: on });
  }

  const interpretationNeedsIdentity = memo(() => {
    const draft = shapeDraft();
    return Boolean(draft?.extractable) && !draft?.identityMember;
  });

  /** Append a row and open it — you added it in order to fill it in. */
  function appendMember(row: ShapeDraftMember): void {
    const draft = untrack(shapeDraft);
    if (!draft) return;
    batch(() => {
      setShapeDraft({ ...draft, members: [...draft.members, row] });
      setExpandedMembers([...untrack(expandedMembers), row.rowId]);
    });
  }

  function addProperty(): void {
    appendMember(emptyDraftProperty());
  }

  function addRelationship(): void {
    appendMember(emptyDraftRelationship());
  }

  function toggleMemberExpanded(rowId: string): void {
    const open = untrack(expandedMembers);
    setExpandedMembers(open.includes(rowId) ? open.filter((id) => id !== rowId) : [...open, rowId]);
  }

  function commitDraft(): void {
    const draft = untrack(shapeDraft);
    if (draft) setShapeDraft({ ...draft });
  }

  function removeMember(rowId: string): void {
    const draft = untrack(shapeDraft);
    if (!draft) return;
    batch(() => {
      setShapeDraft({
        ...draft,
        members: draft.members.filter((m) => m.rowId !== rowId),
        // A dangling identity would be refused at save with an error about a row that is no longer
        // on screen, which reads as a bug rather than a consequence. Same for the naming property.
        identityMember: draft.identityMember === rowId ? '' : draft.identityMember,
        nameMember: draft.nameMember === rowId ? '' : draft.nameMember,
      });
      setExpandedMembers(untrack(expandedMembers).filter((id) => id !== rowId));
    });
  }

  /** Member fields edited by typing — updated in place so the input keeps focus (see note above). */
  const TYPED_MEMBER_FIELDS: ReadonlySet<keyof ShapeDraftMember> = new Set(['name', 'hint', 'defaultValue', 'options']);

  function setMemberField(rowId: string, field: keyof ShapeDraftMember, value: string | boolean | number): void {
    const draft = untrack(shapeDraft);
    const row = draft?.members.find((m) => m.rowId === rowId);
    if (!draft || !row) return;
    // `we-number-input` reports a number where the draft holds text — every default is stored as
    // typed and coerced once, at lowering, by the property's declared type.
    const next = typeof value === 'number' ? String(value) : value;

    if (TYPED_MEMBER_FIELDS.has(field)) {
      (row as unknown as Record<string, unknown>)[field] = next;
      // Options are typed in place like any other text, but the default picker is built from them,
      // so the derived list is kept in step here and published on blur (see `commitDraft`).
      if (field === 'options') syncDerived(row);
      return;
    }
    // Discrete fields change what the row renders (conditional inputs), so this path replaces the
    // row to trigger it — the spread carries any silently-mutated text along.
    setShapeDraft({
      ...draft,
      members: draft.members.map((m) => (m.rowId === rowId ? syncDerived({ ...m, [field]: next }) : m)),
    });
  }

  /**
   * Apply a drag-reorder, given the row ids in their new order (what `we-sortable` reports).
   *
   * Order is not cosmetic: it is the declaration order the stored manifest carries, and it will be
   * the field order of the derived creation form. Ids the event does not mention keep their relative
   * position at the end, so a partial or stale report can never drop a row.
   */
  function reorderMembers(rowIds: string[]): void {
    const draft = untrack(shapeDraft);
    if (!draft || !Array.isArray(rowIds)) return;
    const byId = new Map(draft.members.map((m) => [m.rowId, m]));
    const ordered = rowIds.map((id) => byId.get(id)).filter((m): m is ShapeDraftMember => Boolean(m));
    const missing = draft.members.filter((m) => !rowIds.includes(m.rowId));
    setShapeDraft({ ...draft, members: [...ordered, ...missing] });
  }

  function replaceDraft(draft: ShapeDraft): void {
    batch(() => {
      setShapeDraft(draft);
      setDraftErrors([]);
    });
  }

  /** Ask for a draft, with what the space already names, and land it through `land`. */
  async function generate(prompt: string, failure: string, land: (generated: ShapeDraft) => void): Promise<void> {
    const transport = untrack(generationTransport);
    if (!transport) return;
    batch(() => {
      setGenerating(true);
      setDraftErrors([]);
    });
    try {
      const { draft, remainingProblems } = await untrack(() =>
        runShapeGeneration(prompt, {
          transport,
          existingEntities: knownEntityNames(editingShapeId() ?? undefined),
          referenceTargets: relationshipTargets().map((t) => t.value),
        }),
      );
      batch(() => {
        land(draft);
        if (remainingProblems.length) setDraftErrors(remainingProblems);
      });
    } catch (err) {
      console.error(`ShapeStore: ${failure} failed`, err);
      setDraftErrors([`Generation failed: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setGenerating(false);
    }
  }

  async function generateShapeDraft(description: string): Promise<void> {
    if (!untrack(generationTransport) || !description.trim()) return;
    // Editing keeps the record's name and predicates — generation only replaces a NEW draft
    // wholesale; on an edit it would orphan storage keys, so it is offered only for new models.
    await generate(description, 'shape generation', (draft) => {
      replaceDraft(draft);
      // Closed, like the typed route: a collapsed row shows its hint, so what was generated can
      // be read without every card standing open.
      setExpandedMembers([]);
      // Every word of it is the machine's — this route replaces the draft outright, so there is
      // no authored field to protect from the next run.
      setLastGenerated(generatedOutputOf(draft));
    });
  }

  const generateIntent = memo<GenerateIntent>(() => generateIntentOf(shapeDraft(), lastGenerated()));

  /**
   * The button's own entry point: generate now, or ask first when the click would discard work.
   *
   * The question is asked here rather than in the template because only the store can tell a
   * proposal nobody has touched from rows somebody typed — and asking about the former would train
   * the answer out of anyone before they met the latter.
   */
  function requestGenerateFields(): void {
    // Computed fresh rather than read from the memo: member rows mutate in place (the focus
    // concession), so the memo can be a keystroke stale.
    if (untrack(() => generateIntentOf(shapeDraft(), lastGenerated())) === 'replace') setConfirmReplaceFields(true);
    else void generateShapeFields();
  }

  function cancelReplaceFields(): void {
    setConfirmReplaceFields(false);
  }

  async function generateShapeFields(): Promise<void> {
    const draft = untrack(shapeDraft);
    // Computed fresh rather than read from the memo, as above — and a stale intent here decides
    // whether rows somebody just typed are replaced without asking.
    if (!draft || !untrack(generationTransport) || generateIntentOf(draft, untrack(lastGenerated)) === 'none') return;
    setConfirmReplaceFields(false);
    const authored = authoredFields(draft, untrack(lastGenerated));
    await generate(generationPrompt(draft, authored), 'field generation', (generated) => {
      const current = untrack(shapeDraft);
      if (!current) return;
      const landed = landGeneratedFields(current, generated, authored);
      replaceDraft(landed.draft);
      // Left closed: a collapsed row shows its hint, so the generated hints can be read without
      // eight expanded cards standing between the author and the Save button.
      setExpandedMembers([]);
      setLastGenerated(landed.last);
    });
  }

  async function saveShapeDraft(): Promise<void> {
    const draft = untrack(shapeDraft);
    const dataset = untrack(handle);
    if (!draft || !dataset) return;
    const editingId = untrack(editingShapeId);
    const existing = editingId ? untrack(spaceShapes).find((s) => s.id === editingId) : undefined;
    const known = untrack(() => knownEntityNames(editingId ?? undefined));

    batch(() => {
      setSavingShape(true);
      setDraftErrors([]);
    });
    try {
      const shapeUuid = existing?.shapeId.replace('we://shapes/', '') || crypto.randomUUID();
      const lowered = draftToManifest(draft, shapeUuid);
      if (!lowered.ok) {
        batch(() => {
          setDraftErrors(lowered.errors);
          // Open whatever the complaint is about: a message naming a field the reader cannot see
          // reads as a bug in the form rather than a mistake in the model.
          setExpandedMembers([...new Set([...untrack(expandedMembers), ...lowered.rows])]);
        });
        return;
      }
      const entityName = Object.keys(lowered.manifest.entities)[0];
      if (!existing && known.includes(entityName)) {
        setDraftErrors([`"${entityName}" already names a model here — pick another name.`]);
        return;
      }
      if (existing && entityName !== existing.name) {
        setDraftErrors(['Renaming a model is not supported yet — its name is how existing data is found.']);
        return;
      }
      const gate = validateManifest(lowered.manifest, { externalEntities: known });
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

      const shape: ShapeInput = {
        name: entityName,
        description: draft.description,
        icon: draft.icon,
        shapeId: `we://shapes/${shapeUuid}`,
        version: existing ? existing.version + 1 : 1,
        forkedFrom: existing?.forkedFrom ?? '',
        manifest: gate.manifest,
      };
      // Installed before the record is saved, so a model the backend refuses leaves no record that
      // every later visit would fail to adopt.
      await adoptShape(shape, dataset);
      await storage().save(dataset, shape, existing?.id);
      /*
        Ticking the switch is the space's decision, so it does not need making twice.

        `extractable` on the entity is candidacy — it travels with the definition, so a fork of this
        model lands elsewhere as something that space may switch on. Enrolling it in *this* space's
        defaults is a separate fact, and asking for it separately would be the two-affordances-for-
        one-intent problem: whoever ticked the box in this wizard is the community, saying yes, now.

        Best-effort. The model is saved and adopted by this point, so a failure here is one setting
        that did not stick, not a lost definition — and the space's own settings can fix it.
      */
      if (draft.extractable) {
        try {
          await interpretationEnroller.get()?.(entityName);
        } catch (err) {
          console.warn('ShapeStore: could not add the new model to this space’s extraction targets', err);
        }
      }
      cancelShapeWizard();
      toasts.success(existing ? `Model "${entityName}" updated` : `Model "${entityName}" created`);
      await loadShapes();
    } catch (err) {
      console.error('ShapeStore: saving shape failed', err);
      setDraftErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSavingShape(false);
    }
  }

  async function addRecordTypes(
    bundleId: string,
    types: readonly BundleRecordType[],
    datasetId?: string,
  ): Promise<string[]> {
    const current = untrack(datasetStore.currentDataset);
    const target = datasetId ? untrack(datasetStore.datasets).find((d) => d.id === datasetId) : current;
    const ports = untrack(schemas);
    if (!target || !ports) return ['There is no space open to add them to'];
    const dataset = target.handle;
    const onScreen = target.id === current?.id;
    const problems: string[] = [];
    // A space not on screen has no loaded list, so its own records say what it already has.
    let present: Map<string, { shapeId?: string }>;
    if (onScreen) {
      present = new Map(untrack(spaceShapes).map((shape) => [shape.name, shape]));
    } else {
      present = new Map((await storage().list(dataset)).map((shape) => [shape.name, shape]));
    }
    const names = types.map((type) => type.name);
    const adopted: ShapeInput[] = [];
    let refused = false;
    for (const type of types) {
      // Recognised by where it came from, so a second install or set-up adds nothing twice.
      const shapeId = `we://shapes/bundle/${bundleId}/${type.name}`;
      const already = present.get(type.name);
      if (already) {
        if (already.shapeId !== shapeId)
          problems.push(`it already has a kind of record called "${type.name}" that this app did not bring`);
        continue;
      }
      const known = onScreen ? untrack(() => knownEntityNames()) : [...knownEntityNamesOf([], []), ...present.keys()];
      const gate = validateManifest(type.manifest, {
        externalEntities: [...known, ...names.filter((name) => name !== type.name)],
      });
      if (!gate.valid) {
        problems.push(`"${type.name}" is not a valid definition — ${gate.errors[0]?.message}`);
        continue;
      }
      const shape: ShapeInput = {
        name: type.name,
        description: type.description ?? '',
        icon: type.icon ?? 'shapes',
        shapeId,
        version: 1,
        forkedFrom: '',
        manifest: gate.manifest,
      };
      // Adopted as `loadShapes` adopts it on every later visit. A type the backend refuses — a
      // shape URI another app's class already holds, say — is a problem to show, like an invalid
      // definition, not an error thrown out of the middle of the set.
      try {
        await adoptShape(shape, dataset);
        adopted.push(shape);
      } catch (err) {
        refused = true;
        problems.push(`"${type.name}" could not be added — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    /*
      Records only once the backend took every type. A record is what the space lists, and adopts
      on every visit, so records written beside a refused type would leave the app half in the
      space: some of its kinds of record there, one missing, and set-up reported as failed. The
      shapes the backend did take stay registered, which shows nowhere and costs nothing on the next
      try: an unchanged shape writes nothing.
    */
    if (refused) return problems;
    for (const shape of adopted) await storage().save(dataset, shape);
    if (onScreen) await loadShapes();
    return problems;
  }

  async function deleteShape(shapeRecordId: string): Promise<void> {
    const dataset = untrack(handle);
    if (!dataset) return;
    try {
      await storage().remove(dataset, shapeRecordId);
      toasts.success('Model removed. Existing entries keep their data.');
      await loadShapes();
    } catch (err) {
      console.error('ShapeStore: deleting shape failed', err);
      toasts.error('Removing the model failed.');
    }
  }

  // ── Hint editor actions ───────────────────────────────────────────────────────

  async function openHintEditor(entity: string): Promise<void> {
    const ports = untrack(schemas);
    const dataset = untrack(handle);
    if (!ports || !dataset) return;
    setHintBusy(true);
    try {
      const declared = declaredHintsOf(entity, untrack(spaceShapes));
      const editor = hintEditorStateOf(entity, declared, await ports.interpretationHints(dataset, entity));
      // What it looked like on open, so closing can tell an edit from a read. See `hintEditorDirty`.
      openedHints = JSON.stringify(editor);
      setHintEditor(editor);
    } catch (err) {
      console.error('ShapeStore: reading hints failed', err);
      toasts.error('Could not read this model’s hints.');
    } finally {
      setHintBusy(false);
    }
  }

  function closeHintEditor(): void {
    openedHints = null;
    setHintEditor(null);
  }

  /**
   * Whether the hint editor holds anything that would be lost by closing.
   *
   * ## Why it needed one at all
   *
   * The hint editor is a modal full of textareas and it was the one draft surface in the app with
   * **no** guard: a backdrop click or Escape threw away every hint somebody had written, silently.
   * The wizard beside it guards, the record form guards, the theme editor autosaves — this one just
   * lost the work.
   *
   * Compared against a snapshot rather than tested for content, for the reason the other two
   * guards learned the hard way: every row opens pre-filled with the declared hint, so "holds
   * something" is true of an editor nobody has touched, and a dialog that always fires is one
   * people stop reading.
   *
   * Evaluated on the click rather than memoised: hint text is mutated in place, deliberately (see
   * `setHintDraft`), so nothing would notify a memo.
   */
  function hintEditorDirty(): boolean {
    const editor = untrack(hintEditor);
    if (!editor || openedHints === null) return false;
    return JSON.stringify(editor) !== openedHints;
  }

  function setHintDraft(key: string, value: string): void {
    // In-place for the same reason as setShapeField: every hint is a typed textarea, and nothing
    // rendered derives from hint text — save() reads the mutated editor state.
    const editor = untrack(hintEditor);
    if (!editor) return;
    if (key === 'class') {
      editor.classHint = value;
    } else {
      const row = editor.rows.find((r) => r.name === key);
      if (row) row.hint = value;
    }
  }

  async function saveHintEditor(): Promise<void> {
    const ports = untrack(schemas);
    const dataset = untrack(handle);
    const editor = untrack(hintEditor);
    if (!ports || !dataset || !editor) return;
    setHintBusy(true);
    try {
      await ports.setInterpretationHints(dataset, editor.entity, {
        classHint: editor.classHint,
        propHints: Object.fromEntries(editor.rows.map((row) => [row.name, row.hint])),
      });
      setHintEditor(null);
      toasts.success(`Hints for ${editor.entity} saved for this space`);
    } catch (err) {
      console.error('ShapeStore: saving hints failed', err);
      toasts.error('Saving hints failed.');
    } finally {
      setHintBusy(false);
    }
  }

  async function resetHintEditor(): Promise<void> {
    const ports = untrack(schemas);
    const dataset = untrack(handle);
    const editor = untrack(hintEditor);
    if (!ports || !dataset || !editor) return;
    setHintBusy(true);
    try {
      await ports.resetInterpretationHints(dataset, editor.entity);
      toasts.success(`Hints for ${editor.entity} reset to defaults`);
      await openHintEditor(editor.entity);
    } catch (err) {
      console.error('ShapeStore: resetting hints failed', err);
      toasts.error('Resetting hints failed.');
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
    interpretationCandidates,
    interpretationCandidatesLoaded,
    interpretationCandidatesFor,
    provideInterpretationEnroller: interpretationEnroller.provide,
    relationshipTargets,
    identityOptions,
    nameOptions,
    draftNameMember,
    hintEditor,
    hintBusy,
    openShapeWizard,
    cancelShapeWizard,
    setShapeField,
    setIdentityMember,
    setNameMember,
    setInterpretable,
    interpretationNeedsIdentity,
    addProperty,
    addRelationship,
    removeMember,
    setMemberField,
    reorderMembers,
    memberOptions,
    expandedMembers,
    toggleMemberExpanded,
    commitDraft,
    replaceDraft,
    generateShapeDraft,
    generateShapeFields,
    generateIntent,
    requestGenerateFields,
    confirmReplaceFields,
    cancelReplaceFields,
    requestCloseWizard,
    confirmDiscard,
    cancelDiscard,
    saveShapeDraft,
    addRecordTypes,
    deleteShape,
    openHintEditor,
    closeHintEditor,
    hintEditorDirty,
    setHintDraft,
    saveHintEditor,
    resetHintEditor,
  };

  return store;
}
