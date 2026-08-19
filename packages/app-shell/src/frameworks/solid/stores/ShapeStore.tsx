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
import {
  additiveViolations,
  draftToManifest,
  emptyDraftProperty,
  emptyDraftRelationship,
  emptyShapeDraft,
  manifestToDraft,
  type ShapeDraft,
  type ShapeDraftMember,
  syncDerived,
  isTouched,
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
const BLOCK_ICONS: Record<string, string> = {
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
   * The auto-generate button has something to work from and nothing to destroy: some context is
   * written (name, description or hint) and no member row has been started. False once a member is
   * touched — generation replaces the member list wholesale, and quietly discarding typed rows is
   * how a click becomes a loss.
   */
  canAutoGenerateFields: Accessor<boolean>;
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
    setShapeDraft(null);
    setEditingShapeId(null);
    setDraftErrors([]);
    setExpandedMembers([]);
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
        // Everything a model wrote is opened: the point of the flow is that it gets read before it
        // is adopted, and hints are the part most worth checking.
        setExpandedMembers(draft.members.map((m) => m.rowId));
      });
      if (remainingProblems.length) setDraftErrors(remainingProblems);
    } catch (err) {
      console.error('ShapeStore: shape generation failed', err);
      setDraftErrors([`Generation failed: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setGenerating(false);
    }
  }

  /** The guard itself, over a live draft — the memo below tracks it, the action re-checks it fresh. */
  function computeCanAutoGenerate(draft: ShapeDraft | null): boolean {
    if (!draft) return false;
    const hasContext = Boolean(draft.name.trim() || draft.description.trim() || draft.classHint.trim());
    return hasContext && !draft.members.some(isTouched);
  }

  const canAutoGenerateFields = createMemo<boolean>(() => computeCanAutoGenerate(shapeDraft()));

  async function generateShapeFields(): Promise<void> {
    const draft = shapeDraft();
    const transport = generationTransport();
    // Computed fresh rather than read from the memo: member rows mutate in place (the focus
    // concession), so the memo can be a keystroke stale — and stale-true here replaces rows
    // somebody just typed.
    if (!draft || !transport || !computeCanAutoGenerate(draft)) return;
    // The same generation as the describe-it flow, prompted by what the author already wrote.
    const context = [
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
        // The author's words survive; the generation contributes the structure — plus an answer
        // for anything they left blank.
        replaceDraft({
          ...current,
          name: current.name.trim() || generated.name,
          description: current.description.trim() ? current.description : generated.description,
          icon: current.icon || generated.icon,
          classHint: current.classHint.trim() ? current.classHint : generated.classHint,
          members: generated.members,
          identityMember: generated.identityMember,
        });
        // Opened for the same reason the describe-it flow opens them: generated fields are a
        // proposal, and the hints are the part most worth reading before adopting.
        setExpandedMembers(generated.members.map((m) => m.rowId));
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
    relationshipTargets,
    identityOptions,
    hintEditor,
    hintBusy,
    openShapeWizard,
    cancelShapeWizard,
    setShapeField,
    setIdentityMember,
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
    canAutoGenerateFields,
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
