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
import { extractableEntities, manifestEntries, type ModelManifest, validateManifest } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { asFileField, decodeFileAsJson, encodeJsonFileData, Shape } from '@we/models';
import { CORE_MANIFEST } from '@we/models/manifest';
import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  ParentProps,
  useContext,
} from 'solid-js';

import {
  generateShapeDraft as runShapeGeneration,
  type ShapeGenerationTransport,
} from '../../../shared/ai/shapeGeneration';
import { hintToDisplay } from '../../../shared/shapes/hintEditor';
import {
  additiveViolations,
  authoredFields,
  draftToManifest,
  emptyDraftProperty,
  emptyDraftRelationship,
  emptyShapeDraft,
  type GeneratedOutput,
  isTouched,
  manifestToDraft,
  memberSignature,
  type ShapeDraft,
  type ShapeDraftMember,
  syncDerived,
} from '../../../shared/shapes/shapeDraft';
import { useDatasetStore } from './DatasetStore';
import { useSessionStore } from './SessionStore';

/** A we-select option row: icon drawn beside the label, group rendered once as a heading. */
export interface RelationshipTargetOption {
  label: string;
  value: string;
  icon?: string;
  group?: string;
}

/**
 * The block composer's own iconography (BlockMenu.tsx), so a block is drawn the same way wherever
 * it is named. Blocks the composer has no insert entry for get the nearest documented icon.
 */
export const BLOCK_ICONS: Record<string, string> = {
  AudioBlock: 'speaker-high',
  CalloutBlock: 'megaphone',
  CodeBlock: 'code',
  CollectionBlock: 'squares-four',
  DividerBlock: 'minus',
  EmbedBlock: 'browser',
  EventBlock: 'calendar',
  FileBlock: 'paperclip',
  ImageBlock: 'image',
  LinkBlock: 'link',
  LocationBlock: 'map-pin',
  TagBlock: 'tag',
  TaskBlock: 'check-square',
  TextBlock: 'text-t',
  VideoBlock: 'youtube-logo',
};

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

/**
 * What clicking the wizard's generate button would do, given what the draft currently holds.
 *
 * Generation replaces the member list wholesale, so the interesting distinction is what stands to
 * be lost: `generate` (nothing yet), `regenerate` (a proposal nobody has touched — the "try again"
 * that must stay one click), `replace` (rows somebody wrote, so it asks first), `none` (there is
 * nothing to generate from).
 */
export type GenerateIntent = 'none' | 'generate' | 'regenerate' | 'replace';

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
  /**
   * Entity names an extraction pass may write in this space — core vocabulary that declares itself
   * extractable, plus every adopted shape that does.
   *
   * The answer to "what could be found here", and deliberately not "what will this pass look for":
   * a call may narrow it and the space may have auto-extraction off. Read it to *display* findings,
   * so a card shows a record another member extracted whatever this agent had selected.
   */
  extractionTargets: Accessor<string[]>;
  /** Options for the relationship target picker — `{ label, value }`, grouped and labelled. */
  relationshipTargets: Accessor<RelationshipTargetOption[]>;
  /**
   * Options for the identity picker: "None" plus every named property of the open draft.
   *
   * Built here rather than `$map`-ped in the schema for the same reason as
   * `spaceStore.templateOverrideOptions` — a schema can map a store array into options but cannot
   * prepend one, and without the "None" entry the choice would be one-way.
   */
  identityOptions: Accessor<{ label: string; value: string }[]>;
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
  /** Choose which member is the interpretation dedup key; 'none' (or '') clears it. */
  setIdentityMember: (rowId: string) => void;
  /**
   * Whether an AI extraction pass may write instances of the open draft — its own action rather
   * than a `setShapeField` case because the value is a boolean and the field takes strings.
   */
  setExtractable: (on: boolean) => void;
  /**
   * The open draft would be extracted into, and has no field to recognise what it already wrote.
   *
   * Worth saying rather than refusing: a model with no identity property still extracts, it just
   * duplicates everything on every pass — so this is a warning beside the switch, and the wizard
   * saves either way.
   */
  extractionNeedsIdentity: Accessor<boolean>;
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
  const [expandedMembers, setExpandedMembers] = createSignal<string[]>([]);
  const [confirmDiscard, setConfirmDiscard] = createSignal(false);
  const [confirmReplaceFields, setConfirmReplaceFields] = createSignal(false);
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
  const [lastGenerated, setLastGenerated] = createSignal<GeneratedOutput | null>(null);

  const memberOptions = createMemo(() =>
    (shapeDraft()?.members ?? []).map((m) => ({ rowId: m.rowId, options: m.defaultOptions })),
  );

  /*
    The backend's own model first — the node the community runs on, same as transcription and
    extraction — with the agent's Anthropic key as fallback. Gating on the key alone hid the whole
    AI surface from anyone who had not used the template editor, however capable their node was.
  */
  const [backendLlm, setBackendLlm] = createSignal(false);
  createEffect(() => {
    const port = session.backendPorts()?.languageModel;
    if (!port) {
      setBackendLlm(false);
      return;
    }
    void port
      .available()
      .then(setBackendLlm)
      .catch(() => setBackendLlm(false));
  });
  const aiAvailable = createMemo(() => backendLlm() || Boolean(datasetStore.agentSettings()?.claudeApiKey));

  /** The transport a generation should run on right now, or null when neither is configured. */
  function generationTransport(): ShapeGenerationTransport | null {
    const port = session.backendPorts()?.languageModel;
    if (backendLlm() && port) return { kind: 'backend', port };
    const apiKey = datasetStore.agentSettings()?.claudeApiKey;
    return apiKey ? { kind: 'anthropic', apiKey } : null;
  }

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

  /** Core vocabulary that declares itself extractable — `TaskBlock` and `EventBlock` today. */
  const coreExtractionTargets = extractableEntities(CORE_MANIFEST);

  /*
    What could be extracted in this space: core vocabulary plus the shapes this community adopted.

    Core first because those are the entities every space has, so a list that grows as a community
    defines models reads as an addition rather than a reshuffle. A shape with adoption problems is
    excluded by `manifest` being null — an entity that is not queryable cannot be minted into
    either, and offering it would produce a pass that fails on a name the executor has no shape for.

    Deduplicated, because a space may name a shape after core vocabulary: `getModelForPerspective`
    prefers the native class, so the two names resolve to one class and requesting it twice would
    put the same shape in the prompt twice at the community's expense.
  */
  const extractionTargets = createMemo<string[]>(() => {
    const names = [
      ...coreExtractionTargets,
      ...spaceShapes().flatMap((shape) => (shape.manifest ? extractableEntities(shape.manifest) : [])),
    ];
    return [...new Set(names)];
  });

  /*
    Lend the list downward, the way SpaceStore lends `autoInterpret`.

    DatasetStore publishes the interpretation surface modules reach, and sits *above* this store in
    the provider tree, so it cannot read a shape. The accessor rather than the value, so it follows
    a community defining a model without anything re-registering.
  */
  datasetStore.provideExtractionTargets(extractionTargets);

  /**
   * What a relationship may point at here, grouped by where it comes from and labelled for the
   * picker: this space's own models first (the interesting case when modelling), then the block
   * vocabulary (attaching content — a photo, a place), then any foreign app's models.
   *
   * Core entities are offered **only** where they are block types. The rest of core is
   * infrastructure — `Template`, `Theme`, `AgentSettings`, `SpacePreference` — which no community
   * shape should point at, and offering them made the picker read as a dump of everything the app
   * happens to define. The block-suffix rule is the one WE's own model conventions already enforce
   * (`blocks/` holds exactly the `*Block` classes), and it fails safe: a new block type appears
   * here automatically, a new infrastructure entity stays out.
   */
  /*
    Grouped rather than suffixed. "ImageBlock — block" said the name twice, and the suffixes were
    inconsistent between groups — worst of all "— another app", which asserted an origin nothing
    established: getForeignShacl returns every SHACL shape in the dataset that is not WE's own,
    whoever put it there. The heading claims only where the model lives, which is all that is known.

    Block icons are the block composer's own (BlockMenu.tsx), so the two surfaces name a block the
    same way; a space shape brings the icon its author picked in this wizard.
  */
  const relationshipTargets = createMemo<RelationshipTargetOption[]>(() => {
    const entry = (name: string, group: string, icon?: string) => ({ label: name, value: name, group, icon });
    const dedupeSort = <T extends { value: string }>(rows: T[]) => {
      const seen = new Set<string>();
      return rows.filter((r) => !seen.has(r.value) && seen.add(r.value)).sort((a, b) => a.value.localeCompare(b.value));
    };
    return [
      ...dedupeSort(
        spaceShapes()
          .filter((s) => s.manifest)
          .map((s) => ({ ...entry(s.name, 'This space', s.icon || 'cube'), icon: s.icon || 'cube' })),
      ),
      ...dedupeSort(
        Object.keys(CORE_MANIFEST.entities)
          .filter((name) => name.endsWith('Block'))
          .map((name) => entry(name, 'Blocks', BLOCK_ICONS[name] ?? 'cube')),
      ),
      ...dedupeSort(datasetStore.currentDatasetModels().map((m) => entry(m.name, 'Other models in this space'))),
    ];
  });

  const identityOptions = createMemo<{ label: string; value: string }[]>(() => [
    { label: 'None', value: 'none' },
    ...(shapeDraft()?.members ?? [])
      .filter((m) => m.kind === 'property' && m.name.trim())
      .map((m) => ({ label: m.name, value: m.rowId })),
  ]);

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
    // A schema $action with no declared args passes the DOM event as the first argument, so
    // anything but a real id means "new model" — without this, the New button arrived carrying a
    // MouseEvent and the wizard refused to open.
    const recordId = typeof shapeRecordId === 'string' && shapeRecordId ? shapeRecordId : undefined;
    setDraftErrors([]);
    // Nothing here was generated yet, whatever the last draft did — so every word in it is the
    // author's, including a stored model's own description.
    setLastGenerated(null);
    setConfirmReplaceFields(false);
    if (!recordId) {
      const draft = emptyShapeDraft();
      // Batched: two separate writes mount the wizard with nothing expanded and then expand it, so
      // the starter row played its opening animation every time the modal was opened. Together they
      // are one update, and the row is simply open from the first frame.
      batch(() => {
        setEditingShapeId(null);
        setShapeDraft(draft);
        // The one starter row opens: it is about to be filled in.
        setExpandedMembers(draft.members.map((m) => m.rowId));
      });
      return;
    }
    const view = spaceShapes().find((s) => s.id === recordId);
    if (!view?.manifest) {
      toastService.error('This model has no readable definition to edit.');
      return;
    }
    // Lifted out of the batch: a property narrowing does not survive into a callback, and the
    // lowering is pure anyway.
    const draft = manifestToDraft(view.name, view.manifest, { description: view.description, icon: view.icon });
    batch(() => {
      setEditingShapeId(recordId);
      setShapeDraft(draft);
      // A stored model opens collapsed — the list is there to be read before it is edited.
      setExpandedMembers([]);
    });
  }

  /**
   * Whether closing would throw anything away.
   *
   * A pristine wizard — opened and not typed in — closes without ceremony; asking there would train
   * the answer out of anyone. Editing an existing model counts as having something to lose from the
   * moment it opens, since its content came from the space.
   */
  function draftHasWork(): boolean {
    const draft = shapeDraft();
    if (!draft) return false;
    if (editingShapeId()) return true;
    if (draft.name.trim() || draft.description.trim() || draft.classHint.trim() || draft.icon) return true;
    return draft.members.some((m) => m.name.trim() || m.hint.trim() || m.options.trim() || m.target || m.defaultValue);
  }

  function requestCloseWizard(): void {
    if (draftHasWork()) setConfirmDiscard(true);
    else cancelShapeWizard();
  }

  function cancelDiscard(): void {
    setConfirmDiscard(false);
  }

  function cancelShapeWizard(): void {
    setConfirmDiscard(false);
    setConfirmReplaceFields(false);
    setShapeDraft(null);
    setEditingShapeId(null);
    setDraftErrors([]);
    setExpandedMembers([]);
    setLastGenerated(null);
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
    const draft = shapeDraft();
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
    const draft = shapeDraft();
    // '' is the "None" option, and the only way to clear it.
    if (draft) setShapeDraft({ ...draft, identityMember: rowId === 'none' ? '' : rowId });
  }

  function setExtractable(on: boolean): void {
    const draft = shapeDraft();
    if (draft) setShapeDraft({ ...draft, extractable: on });
  }

  const extractionNeedsIdentity = createMemo(() => {
    const draft = shapeDraft();
    return Boolean(draft?.extractable) && !draft?.identityMember;
  });

  /** Append a row and open it — you added it in order to fill it in. */
  function appendMember(row: ShapeDraftMember): void {
    const draft = shapeDraft();
    if (!draft) return;
    setShapeDraft({ ...draft, members: [...draft.members, row] });
    setExpandedMembers([...expandedMembers(), row.rowId]);
  }

  function addProperty(): void {
    appendMember(emptyDraftProperty());
  }

  function addRelationship(): void {
    appendMember(emptyDraftRelationship());
  }

  function toggleMemberExpanded(rowId: string): void {
    const open = expandedMembers();
    setExpandedMembers(open.includes(rowId) ? open.filter((id) => id !== rowId) : [...open, rowId]);
  }

  function commitDraft(): void {
    const draft = shapeDraft();
    if (draft) setShapeDraft({ ...draft });
  }

  function removeMember(rowId: string): void {
    const draft = shapeDraft();
    if (!draft) return;
    setShapeDraft({
      ...draft,
      members: draft.members.filter((m) => m.rowId !== rowId),
      // A dangling identity would be refused at save with an error about a row that is no longer
      // on screen, which reads as a bug rather than a consequence.
      identityMember: draft.identityMember === rowId ? '' : draft.identityMember,
    });
    setExpandedMembers(expandedMembers().filter((id) => id !== rowId));
  }

  /** Member fields edited by typing — updated in place so the input keeps focus (see note above). */
  const TYPED_MEMBER_FIELDS: ReadonlySet<keyof ShapeDraftMember> = new Set(['name', 'hint', 'defaultValue', 'options']);

  function setMemberField(rowId: string, field: keyof ShapeDraftMember, value: string | boolean | number): void {
    const draft = shapeDraft();
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
    const draft = shapeDraft();
    if (!draft || !Array.isArray(rowIds)) return;
    const byId = new Map(draft.members.map((m) => [m.rowId, m]));
    const ordered = rowIds.map((id) => byId.get(id)).filter((m): m is ShapeDraftMember => Boolean(m));
    const missing = draft.members.filter((m) => !rowIds.includes(m.rowId));
    setShapeDraft({ ...draft, members: [...ordered, ...missing] });
  }

  function replaceDraft(draft: ShapeDraft): void {
    setShapeDraft(draft);
    setDraftErrors([]);
  }

  async function generateShapeDraft(description: string): Promise<void> {
    const transport = generationTransport();
    if (!transport || !description.trim()) return;
    setGenerating(true);
    setDraftErrors([]);
    try {
      const existing = knownEntityNames(editingShapeId() ?? undefined);
      const { draft, remainingProblems } = await runShapeGeneration(description, {
        transport,
        existingEntities: existing,
        referenceTargets: relationshipTargets().map((t) => t.value),
      });
      // Editing keeps the record's name and predicates — generation only replaces a NEW draft
      // wholesale; on an edit it would orphan storage keys, so it is offered only for new models.
      batch(() => {
        replaceDraft(draft);
        // Closed, like the typed route: a collapsed row shows its hint, so what was generated can
        // be read without every card standing open.
        setExpandedMembers([]);
        // Every word of it is the machine's — this route replaces the draft outright, so there is
        // no authored field to protect from the next run.
        setLastGenerated({
          name: draft.name,
          description: draft.description,
          icon: draft.icon,
          classHint: draft.classHint,
          members: memberSignature(draft.members),
        });
      });
      if (remainingProblems.length) setDraftErrors(remainingProblems);
    } catch (err) {
      console.error('ShapeStore: shape generation failed', err);
      setDraftErrors([`Generation failed: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setGenerating(false);
    }
  }

  /**
   * The guard itself, over a live draft — the memo below tracks it, the action re-checks it fresh.
   *
   * Generation replaces the member list wholesale, so what the button may do depends entirely on
   * what would be lost: nothing (`generate`), a proposal nobody has touched (`regenerate` — the
   * "try again" that must not cost a dialog), or somebody's own work (`replace`, which asks first).
   *
   * The context test is deliberately over everything present, the author's words or not: a draft
   * carrying a generated description has something to re-run from, and greying the button there
   * would be refusing to act on a form that visibly has writing in it.
   */
  function computeGenerateIntent(draft: ShapeDraft | null): GenerateIntent {
    if (!draft) return 'none';
    const hasContext = Boolean(draft.name.trim() || draft.description.trim() || draft.classHint.trim());
    if (!hasContext) return 'none';
    if (!draft.members.some(isTouched)) return 'generate';
    return memberSignature(draft.members) === lastGenerated()?.members ? 'regenerate' : 'replace';
  }

  const generateIntent = createMemo<GenerateIntent>(() => computeGenerateIntent(shapeDraft()));

  /**
   * The button's own entry point: generate now, or ask first when the click would discard work.
   *
   * The question is asked here rather than in the template because only the store can tell a
   * proposal nobody has touched from rows somebody typed — and asking about the former would train
   * the answer out of anyone before they met the latter.
   */
  function requestGenerateFields(): void {
    if (computeGenerateIntent(shapeDraft()) === 'replace') setConfirmReplaceFields(true);
    else void generateShapeFields();
  }

  function cancelReplaceFields(): void {
    setConfirmReplaceFields(false);
  }

  async function generateShapeFields(): Promise<void> {
    const draft = shapeDraft();
    const transport = generationTransport();
    // Computed fresh rather than read from the memo: member rows mutate in place (the focus
    // concession), so the memo can be a keystroke stale — and a stale intent here decides whether
    // rows somebody just typed are replaced without asking.
    if (!draft || !transport || computeGenerateIntent(draft) === 'none') return;
    setConfirmReplaceFields(false);

    /*
      Prompted by what the author wrote, and only that.

      A previous generation's own description and hint are still sitting in the form, and feeding
      them back would quote the last answer as part of the next question: renaming a model to
      "MovieNight" while its generated description still discussed books returned a model about
      both. Fields generation wrote are dropped here and re-answered below, so a re-run follows the
      rename — and pressing Regenerate twice over an untouched draft is a fresh attempt rather than
      a slow convergence on the first one.
    */
    const authored = authoredFields(draft, lastGenerated());
    const askedFor = [
      authored.name && `The model is called "${authored.name}".`,
      authored.description && `Description: ${authored.description}`,
      authored.classHint && `Guidance for AI extraction: ${authored.classHint}`,
    ].filter(Boolean);
    /*
      Nothing of the author's left to go on — they generated a model and then deleted the name they
      started from. What remains is the machine's, but it is all there is, and a prompt built from
      it beats refusing a button the form gives every reason to expect to work.
    */
    const context = askedFor.length
      ? askedFor.join('\n')
      : [
          draft.name.trim() && `The model is called "${draft.name.trim()}".`,
          draft.description.trim() && `Description: ${draft.description.trim()}`,
          draft.classHint.trim() && `Guidance for AI extraction: ${draft.classHint.trim()}`,
        ]
          .filter(Boolean)
          .join('\n');
    setGenerating(true);
    setDraftErrors([]);
    try {
      const existing = knownEntityNames(editingShapeId() ?? undefined);
      const { draft: generated, remainingProblems } = await runShapeGeneration(context, {
        transport,
        existingEntities: existing,
        referenceTargets: relationshipTargets().map((t) => t.value),
      });
      batch(() => {
        const current = shapeDraft();
        if (!current) return;
        // The author's words survive; the generation answers everything else — the fields, and any
        // top-level blank, including the ones its own last run had filled.
        const settled = {
          name: authored.name || generated.name,
          description: authored.description || generated.description,
          icon: authored.icon || generated.icon,
          classHint: authored.classHint || generated.classHint,
        };
        replaceDraft({ ...current, ...settled, members: generated.members, identityMember: generated.identityMember });
        // Left closed. Generated hints are the part most worth reading before adopting, which is
        // why every row used to be opened — but a collapsed row shows its hint now, so the reading
        // is available without eight expanded cards standing between the author and the Save button.
        setExpandedMembers([]);
        // '' for anything the author owns, so their words can never be mistaken for the machine's
        // on the next run — the record is of what generation contributed, not of what is on screen.
        setLastGenerated({
          name: authored.name ? '' : settled.name,
          description: authored.description ? '' : settled.description,
          icon: authored.icon ? '' : settled.icon,
          classHint: authored.classHint ? '' : settled.classHint,
          members: memberSignature(generated.members),
        });
      });
      if (remainingProblems.length) setDraftErrors(remainingProblems);
    } catch (err) {
      console.error('ShapeStore: field generation failed', err);
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
        // Open whatever the complaint is about: a message naming a field the reader cannot see
        // reads as a bug in the form rather than a mistake in the model.
        setExpandedMembers([...new Set([...expandedMembers(), ...lowered.rows])]);
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
      // One rule for every hint on the entity, class and properties alike — they disagreed before,
      // and the properties had it wrong. See {@link hintToDisplay} for what an absent hint means.
      const customized = stored?.customized ?? false;
      setHintEditor({
        entity,
        classHint: hintToDisplay({ stored: stored?.classHint, declared: declared.classHint, customized }),
        defaultClassHint: declared.classHint,
        rows: declared.rows.map((row) => ({
          name: row.name,
          predicate: row.predicate,
          hint: hintToDisplay({ stored: stored?.propHints[row.predicate], declared: row.hint, customized }),
          defaultHint: row.hint,
        })),
        customized,
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
    // In-place for the same reason as setShapeField: every hint is a typed textarea, and nothing
    // rendered derives from hint text — save() reads the mutated editor state.
    const editor = hintEditor();
    if (!editor) return;
    if (key === 'class') {
      editor.classHint = value;
    } else {
      const row = editor.rows.find((r) => r.predicate === key);
      if (row) row.hint = value;
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
    extractionTargets,
    relationshipTargets,
    identityOptions,
    hintEditor,
    hintBusy,
    openShapeWizard,
    cancelShapeWizard,
    setShapeField,
    setIdentityMember,
    setExtractable,
    extractionNeedsIdentity,
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
