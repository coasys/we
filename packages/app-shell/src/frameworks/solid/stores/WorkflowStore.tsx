/**
 * WorkflowStore — the space's workflows, as the Workflows route, a record's inspector and a card read and change
 * them.
 *
 * The Solid binding over three framework-neutral files: `shared/workflowLanes.ts` (a workflow as a main line,
 * branches and a sequence rule), `shared/workflowDraft.ts` (every edit to a workflow being written) and
 * `shared/workflowViews.ts` (lanes, requirements and a record's walk, in words). Everything a schema shows
 * is computed there; this file decides only *when* — which workflow is open, what is being watched, and
 * what a press does.
 *
 * ## What it watches
 *
 * - **The open workflow**: every record going through it, for the route's list of records.
 * - **Every startable workflow**: so a card or the inspector can say which workflows a record is going
 *   through, and where it stands in each (`recordWorkflows`). One watch per workflow; a space has a handful.
 *
 * The task-state workflow is listed and shown, but it is the board's: it is written from the space's
 * task states and moved on the board, so it is never edited, started or moved from here
 * (`managedBy: 'task-states'`).
 *
 * ## Who may change what
 *
 * Saving, deleting and archiving a workflow are for whoever administers the space — the same person the
 * space's other shared settings answer to. Anybody may start a workflow on a record, ask for a move, and
 * take back their own ask.
 */
import { evidenceSubjectOf } from '@shared/evidenceSubjects';
import { TASK_WORKFLOW } from '@shared/taskWorkflow';
import * as draftEdits from '@shared/workflowDraft';
import {
  definitionOf,
  type DraftEdit,
  draftOf,
  isRefusal,
  presetDraft,
  stateLabelOf,
  type WorkflowDraft,
  type WorkflowPreset,
} from '@shared/workflowDraft';
import { toLanes, type WorkflowSequenceRule } from '@shared/workflowLanes';
import {
  approvalsRule,
  editorView,
  historyView,
  kindOf,
  type RecordView,
  recordView,
  refusalWords,
  type StepHistoryView,
  type WorkflowEditorView,
  type WorkflowLabels,
} from '@shared/workflowViews';
import { useDatasetStore } from '@solid/stores/DatasetStore';
import { useSessionStore } from '@solid/stores/SessionStore';
import { useSpaceStore } from '@solid/stores/SpaceStore';
import type {
  Requirement,
  WorkflowCapabilities,
  WorkflowDefinition,
  WorkflowItem,
  WorkflowSummary,
} from '@we/backend-shared';
import { validateWorkflowDefinition } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { getEntityForDataset } from '@we/entities';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  untrack,
  useContext,
} from 'solid-js';

/** A workflow as a list shows it. */
export interface WorkflowSummaryView {
  name: string;
  label: string;
  /** It can be edited here: it reads back exactly, and nothing else writes it. */
  editable: boolean;
  /** How many records are going through it. */
  records: number;
  /** What writes it, when something other than this editor does. Empty otherwise. */
  managedBy: '' | 'task-states';
  archived: boolean;
  /** Its steps, in order — empty until its definition has been read. */
  steps: { name: string; label: string; final: boolean }[];
  /** The moves between them. */
  moves: { from: string; to: string }[];
}

/** The workflow on screen, and the records going through it. */
export interface OpenWorkflowView extends WorkflowEditorView {
  label: string;
  editable: boolean;
  managedBy: '' | 'task-states';
  archived: boolean;
  /** Newest first. */
  records: RecordView[];
  /**
   * The records have been read. Until they have, an empty `records` is not yet an answer — so Delete,
   * which is offered only for a workflow nothing is going through, waits for it rather than flashing.
   */
  recordsLoaded: boolean;
  /** A record's moves, once asked for with `loadHistory`. */
  history: Record<string, StepHistoryView[]>;
}

/** The workflow being written. */
export interface WorkflowDraftView extends WorkflowEditorView {
  label: string;
  /** Not saved yet at all. */
  isNew: boolean;
  /** Differs from what is saved. */
  dirty: boolean;
  /** What a backend would refuse, as sentences. Saving is refused while there are any. */
  problems: string[];
}

/** One workflow a record is going through, as a chip on its card says it. */
export interface RecordWorkflowChip {
  workflow: string;
  label: string;
  state: string | null;
  stateLabel: string;
  /** Moves asked for and not made. */
  waiting: number;
  stalled: boolean;
  /** Where it may be asked to go from here — empty until the workflow's definition is read. */
  next: RecordView['next'];
  /** Each move asked for, with who asked and whether the viewer did — what Agree and Withdraw act on. */
  asks: RecordView['waiting'];
}

export interface WorkflowStore {
  /** This space has workflows at all: its backend offers them and it is a WE space. */
  available: Accessor<boolean>;
  /** What the backend can enforce, and how — see `WorkflowCapabilities`. `null` without workflows. */
  capabilities: Accessor<WorkflowCapabilities | null>;
  /** The viewer may save, delete and archive workflows here. */
  canEdit: Accessor<boolean>;
  /** Every workflow in the space, archived ones included. */
  workflows: Accessor<WorkflowSummaryView[]>;
  /**
   * The backend has answered with this space's workflows. Until it has, an empty `workflows` is not yet an
   * answer, and the list is drawn as loading rather than as "no workflows".
   */
  workflowsLoaded: Accessor<boolean>;
  /** Workflows a record can be started on: not archived, not written by something else. */
  startable: Accessor<{ name: string; label: string; entities: string[] }[]>;
  /** The workflow on screen, or `null`. */
  open: Accessor<OpenWorkflowView | null>;
  /** The workflow being written, or `null`. */
  draft: Accessor<WorkflowDraftView | null>;
  /** By record id: every startable workflow the record is going through. */
  recordWorkflows: Accessor<Record<string, RecordWorkflowChip[]>>;

  refreshWorkflows: () => Promise<void>;
  openWorkflow: (name: string) => Promise<void>;
  closeWorkflow: () => void;
  loadHistory: (record: string) => Promise<void>;

  startWorkflow: (workflow: string, recordId: string) => Promise<void>;
  moveRecord: (workflow: string, recordId: string, to: string, note?: string) => Promise<string>;
  withdrawRecord: (workflow: string, recordId: string) => Promise<void>;

  newWorkflow: (preset: WorkflowPreset, label: string, entities?: string[]) => Promise<void>;
  editWorkflow: () => void;
  cancelDraft: () => void;
  saveDraft: () => Promise<void>;
  deleteWorkflow: (name: string) => Promise<void>;

  setDraftLabel: (label: string) => void;
  setDraftHint: (hint: string) => void;
  setDraftEntities: (entities: string[]) => void;
  addStep: (lane: number, label: string, after?: string) => Promise<void>;
  removeStep: (name: string) => void;
  moveStep: (name: string, by: number) => void;
  renameStep: (name: string, label: string) => void;
  setStepHint: (name: string, hint: string) => void;
  /**
   * A step's name, hint and approvals at once — what a step's edit form saves. Applied as one edit,
   * so a refusal (a name already used) leaves the step exactly as it was.
   */
  updateStep: (
    name: string,
    changes: { label?: string; hint?: string; approvals?: number; kind?: string },
  ) => Promise<void>;
  addBranch: (from: string, label: string, rejoins?: string) => Promise<void>;
  setBranchEnd: (lane: number, rejoins: string) => void;
  setRule: (rule: WorkflowSequenceRule) => void;
  addException: (from: string, to: string) => void;
  removeException: (from: string, to: string) => void;
  setApprovals: (name: string, count: number, kind?: string) => void;
  addEvidence: (name: string, entity: string, via?: string, min?: number) => Promise<void>;
  removeEvidence: (name: string, index: number) => void;
}

const WorkflowContext = createContext<WorkflowStore>();

/** A workflow's name from what a person typed: its words, capitalised and run together. */
function workflowNameOf(label: string): string {
  return label
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/** A workflow's name as a person reads it: "DesignReview" → "Design review". */
function workflowLabelOf(name: string): string {
  if (name === TASK_WORKFLOW) return 'Task states';
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The entities searched for a record's title, when a workflow names none. */
const ANY_RECORD = ['TaskBlock', 'TextBlock', 'CollectionBlock', 'EventBlock'];

const titleOf = (row: Record<string, unknown>): string => {
  // A post or a note is a collection with no title of its own: what it says is in `textContent`.
  for (const key of ['title', 'name', 'textContent', 'text']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      const plain = value.replace(/<[^>]*>/g, '').trim();
      return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
    }
  }
  return '';
};

export function WorkflowStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const spaceStore = useSpaceStore();

  const port = () => (datasetStore.isWeSpace() ? (session.backendPorts()?.workflows ?? null) : null);
  const handle = () => datasetStore.currentDataset()?.handle;
  const datasetId = () => datasetStore.currentDataset()?.id ?? '';
  const me = () => session.me()?.did;

  const available = () => Boolean(port() && handle());
  const capabilities = () => port()?.capabilities ?? null;
  const canEdit = () => available() && spaceStore.canAdministerCurrentSpace();

  /**
   * Words for a workflow's steps. The task-state workflow's steps are the space's task states, so they read as
   * the community named them; any other workflow's read from their names.
   */
  const taskStateNames = createMemo(() => new Map(spaceStore.taskStates().map((s) => [s.slug, s.name])));
  const kindNames = createMemo(() => new Map(spaceStore.involvementTypes().map((k) => [k.slug, k.name])));
  const labelsFor = (workflow: string): WorkflowLabels => ({
    state: (name) => (workflow === TASK_WORKFLOW ? taskStateNames().get(name) : undefined) ?? stateLabelOf(name),
    kind: (slug) => kindNames().get(slug) ?? stateLabelOf(slug),
  });

  // ─── The list ────────────────────────────────────────────────────────────────

  const [summaries, setSummaries] = createSignal<WorkflowSummary[]>([]);
  /*
    Which space the list last answered for, rather than a flag: a switch of space has to make the list
    unanswered again at once, and a slow answer for the space somebody just left must not count for
    the one they are in. On a shared node listing workflows takes seconds, and "no workflows" for those
    seconds read as the space having lost them.
  */
  const [listedFor, setListedFor] = createSignal<string | null>(null);
  const workflowsLoaded = () => listedFor() === datasetId();

  async function refreshWorkflows(): Promise<void> {
    const p = port();
    const h = handle();
    const asked = datasetId();
    if (!p || !h) {
      setSummaries([]);
      setListedFor(asked);
      return;
    }
    try {
      const listed = await p.list(h);
      if (datasetId() !== asked) return;
      setSummaries(listed);
      setListedFor(asked);
      // Every definition, once: the list says which workflows there are, and a map of the space's workflows
      // draws their steps — a handful of workflows, each read once and kept until the space changes.
      for (const summary of listed) void definitionOfWorkflow(summary.name).catch(() => {});
    } catch (error) {
      console.warn('WorkflowStore: could not list the workflows', error);
      // An answer of a kind: waiting on a list that failed would spin for ever.
      if (datasetId() === asked) setListedFor(asked);
    }
  }

  // Asked again whenever the space changes; after a write, the write asks.
  createEffect(() => {
    datasetId();
    available();
    untrack(() => setSummaries([]));
    void untrack(refreshWorkflows);
  });

  // ─── Definitions, read once per workflow and kept ────────────────────────────────

  // Declared before `workflows`, which reads them: a memo runs as soon as it is made, and a signal
  // declared below it does not exist yet at that moment.
  const [definitions, setDefinitions] = createSignal<Record<string, WorkflowDefinition>>({});
  const definitionOfWorkflow = async (name: string): Promise<WorkflowDefinition | null> => {
    const known = untrack(definitions)[name];
    if (known) return known;
    const p = port();
    const h = handle();
    if (!p || !h) return null;
    const read = await p.read(h, name);
    if (read) setDefinitions((prev) => ({ ...prev, [name]: read }));
    return read;
  };
  createEffect(() => {
    datasetId();
    setDefinitions({});
  });

  const workflows = createMemo<WorkflowSummaryView[]>(() => {
    const archived = new Set(spaceStore.archivedWorkflows());
    const defs = definitions();
    return summaries()
      .map((s) => {
        const managedBy = s.name === TASK_WORKFLOW ? ('task-states' as const) : ('' as const);
        const definition = defs[s.name];
        const labels = labelsFor(s.name);
        const leaving = new Set(definition?.transitions.map((t) => t.from) ?? []);
        return {
          name: s.name,
          label: workflowLabelOf(s.name),
          editable: s.editable && !managedBy,
          records: s.records,
          managedBy,
          archived: archived.has(s.name),
          steps: (definition?.states ?? []).map((state) => ({
            name: state.name,
            label: labels.state(state.name),
            final: !leaving.has(state.name),
          })),
          moves: (definition?.transitions ?? []).map((t) => ({ from: t.from, to: t.to })),
        };
      })
      .sort((a, b) => Number(Boolean(b.managedBy)) - Number(Boolean(a.managedBy)) || a.label.localeCompare(b.label));
  });

  const startableNames = createMemo(
    () =>
      workflows()
        .filter((f) => !f.archived && !f.managedBy)
        .map((f) => f.name),
    [],
    { equals: (a, b) => a.join('\u0000') === b.join('\u0000') },
  );

  const startable = createMemo(() => {
    const defs = definitions();
    return startableNames().map((name) => ({
      name,
      label: workflowLabelOf(name),
      entities: defs[name]?.entities ?? [],
    }));
  });

  // ─── Watching ────────────────────────────────────────────────────────────────

  const [items, setItems] = createSignal<Record<string, WorkflowItem[]>>({});

  /** Watch these workflows, and only these, for as long as the space is on screen. */
  function watchWorkflows(names: () => string[]) {
    createEffect(() => {
      const list = names();
      const p = port();
      const h = handle();
      if (!p || !h || !list.length) return;
      let cancelled = false;
      const stops: (() => void)[] = [];
      onCleanup(() => {
        cancelled = true;
        for (const stop of stops) stop();
      });
      for (const name of list) {
        void definitionOfWorkflow(name).catch(() => {});
        void p
          .watch(h, name, (view) => {
            if (!cancelled) setItems((prev) => ({ ...prev, [name]: view.items }));
          })
          .then(
            (stop) => (cancelled ? stop() : stops.push(stop)),
            (error: unknown) => console.warn('WorkflowStore: could not watch', name, error),
          );
      }
    });
  }

  const [openName, setOpenName] = createSignal('');
  watchWorkflows(startableNames);
  watchWorkflows(() => (openName() && !startableNames().includes(openName()) ? [openName()] : []));

  createEffect(() => {
    datasetId();
    setItems({});
    setOpenName('');
    setDraftState(null);
  });

  // ─── Titles ──────────────────────────────────────────────────────────────────

  const [titles, setTitles] = createSignal<Record<string, string>>({});

  createEffect(() => {
    const h = handle();
    const name = openName();
    const list = items()[name] ?? [];
    const definition = definitions()[name];
    if (!h || !list.length) return;
    const known = untrack(titles);
    const missing = list.map((item) => item.record).filter((id) => !(id in known));
    if (!missing.length) return;
    const entities = definition?.entities.length ? definition.entities : ANY_RECORD;
    void (async () => {
      const found: Record<string, string> = Object.fromEntries(missing.map((id) => [id, '']));
      for (const entity of entities) {
        const Model = getEntityForDataset(entity, h) as
          { findAll(d: unknown, q: unknown): Promise<Record<string, unknown>[]> } | undefined;
        if (!Model) continue;
        try {
          for (const row of await Model.findAll(h, { where: { id: missing } })) {
            if (typeof row.id === 'string' && !found[row.id]) found[row.id] = titleOf(row);
          }
        } catch {
          // A type this space has never held reads as nothing to name.
        }
      }
      setTitles((prev) => ({ ...prev, ...found }));
    })();
  });

  // ─── The open workflow ───────────────────────────────────────────────────────────

  const [history, setHistory] = createSignal<Record<string, StepHistoryView[]>>({});

  async function openWorkflow(name: string): Promise<void> {
    if (!name) return closeWorkflow();
    setOpenName(name);
    setHistory({});
    setDefinitions(({ [name]: _stale, ...rest }) => rest);
    try {
      await definitionOfWorkflow(name);
    } catch (error) {
      console.error('WorkflowStore: could not read that workflow', error);
      toastService.error('Could not open that workflow');
      throw error;
    }
  }

  function closeWorkflow(): void {
    setOpenName('');
    setHistory({});
  }

  const open = createMemo<OpenWorkflowView | null>(() => {
    const name = openName();
    const definition = definitions()[name];
    if (!name || !definition) return null;
    const summary = workflows().find((f) => f.name === name);
    const labels = labelsFor(name);
    const view = editorView(definition, labels);
    const { model } = toLanes(definition);
    const named = titles();
    return {
      ...view,
      label: workflowLabelOf(name),
      editable: summary?.editable ?? false,
      managedBy: summary?.managedBy ?? (name === TASK_WORKFLOW ? 'task-states' : ''),
      archived: summary?.archived ?? false,
      records: [...(items()[name] ?? [])]
        .sort((a, b) => (b.since ?? 0) - (a.since ?? 0))
        .map((item) => recordView(definition, model, item, named[item.record] ?? '', me(), labels)),
      recordsLoaded: name in items(),
      history: history(),
    };
  });

  async function loadHistory(record: string): Promise<void> {
    const p = port();
    const h = handle();
    const name = openName();
    if (!p || !h || !name) return;
    try {
      const moves = await p.history(h, name, record);
      setHistory((prev) => ({ ...prev, [record]: historyView(moves, labelsFor(name)) }));
    } catch (error) {
      console.error('WorkflowStore: could not read that record’s history', error);
      toastService.error('Could not read what happened to that record');
      throw error;
    }
  }

  // ─── Records ─────────────────────────────────────────────────────────────────

  const recordWorkflows = createMemo<Record<string, RecordWorkflowChip[]>>(() => {
    const out: Record<string, RecordWorkflowChip[]> = {};
    const all = items();
    const defs = definitions();
    for (const name of startableNames()) {
      const definition = defs[name];
      const model = definition ? toLanes(definition).model : null;
      const labels = labelsFor(name);
      for (const item of all[name] ?? []) {
        const view = definition && model ? recordView(definition, model, item, '', me(), labels) : null;
        (out[item.record] ??= []).push({
          workflow: name,
          label: workflowLabelOf(name),
          state: item.state,
          stateLabel: item.state ? labels.state(item.state) : '',
          waiting: item.waiting.length,
          stalled: item.stalled,
          next: view?.next ?? [],
          asks: view?.waiting ?? [],
        });
      }
    }
    return out;
  });

  const writable = (workflow: string) => {
    if (workflow === TASK_WORKFLOW) throw new Error('Tasks move through their states on the board');
    const p = port();
    const h = handle();
    if (!p || !h) throw new Error('This space has no workflows');
    return { p, h };
  };

  async function startWorkflow(workflow: string, recordId: string): Promise<void> {
    try {
      const { p, h } = writable(workflow);
      await p.start(h, workflow, recordId);
    } catch (error) {
      console.error('WorkflowStore: could not start that workflow', error);
      toastService.error('Could not start that workflow');
      throw error;
    }
  }

  async function moveRecord(workflow: string, recordId: string, to: string, note?: string): Promise<string> {
    let outcome: string;
    try {
      const { p, h } = writable(workflow);
      const result = await p.move(h, workflow, recordId, to, note ? { note } : undefined);
      outcome = result.outcome === 'refused' ? result.reason : result.outcome;
    } catch (error) {
      console.error('WorkflowStore: could not ask for that move', error);
      toastService.error('Could not ask for that move');
      throw error;
    }
    const from = untrack(items)[workflow]?.find((item) => item.record === recordId)?.state;
    const why = refusalWords(untrack(definitions)[workflow], from, to, outcome, labelsFor(workflow));
    if (outcome === 'unmet') toastService.error(why ?? 'Not yet — what that step asks for is not there');
    else if (outcome === 'not-allowed') toastService.error(why ?? 'It cannot move there from where it is');
    else if (outcome === 'stalled')
      toastService.error('Stuck between two agreed moves — one of them has to be withdrawn');
    else if (outcome === 'pending') toastService.info('Still being counted — it will move when it has');
    return outcome;
  }

  async function withdrawRecord(workflow: string, recordId: string): Promise<void> {
    try {
      const { p, h } = writable(workflow);
      await p.withdraw(h, workflow, recordId);
    } catch (error) {
      console.error('WorkflowStore: could not withdraw that', error);
      toastService.error('Could not withdraw that');
      throw error;
    }
  }

  // ─── Writing a workflow ──────────────────────────────────────────────────────────

  const [draftState, setDraftState] = createSignal<{ draft: WorkflowDraft; saved: WorkflowDefinition | null } | null>(
    null,
  );

  const draft = createMemo<WorkflowDraftView | null>(() => {
    const state = draftState();
    if (!state) return null;
    const definition = definitionOf(state.draft);
    const caps = capabilities();
    const taken = !state.saved && workflows().some((f) => f.name === state.draft.name);
    return {
      ...editorView(definition, labelsFor(state.draft.name), state.draft.model),
      label: workflowLabelOf(state.draft.name),
      isNew: !state.saved,
      dirty: !state.saved || JSON.stringify(state.saved) !== JSON.stringify(definition),
      problems: [
        ...(taken ? [`There is already a workflow called "${workflowLabelOf(state.draft.name)}".`] : []),
        ...validateWorkflowDefinition(definition, caps ?? undefined),
      ],
    };
  });

  /** Apply one edit to the draft, or say why it cannot be made. Answers whether it applied. */
  const edit = (change: (draft: WorkflowDraft) => DraftEdit): boolean => {
    const state = draftState();
    if (!state) return false;
    const next = change(state.draft);
    if (isRefusal(next)) {
      toastService.error(next.refused);
      return false;
    }
    setDraftState({ ...state, draft: next });
    return true;
  };

  /*
    The same edit, for an edit a form submits. A form closes in its action's `onSuccess`, which only
    a promise has, so these resolve when the edit applied and reject when it was refused: the form
    closes on the one and stays open, holding what was typed, on the other. The refusal has already
    been said in a toast.
  */
  const submitted = async (change: (draft: WorkflowDraft) => DraftEdit): Promise<void> => {
    if (!edit(change)) throw new Error('That change was not made');
  };

  async function newWorkflow(preset: WorkflowPreset, label: string, entities: string[] = ['TaskBlock']): Promise<void> {
    const name = workflowNameOf(label) || 'NewWorkflow';
    setDraftState({ draft: presetDraft(preset, name, entities), saved: null });
  }

  function editWorkflow(): void {
    const view = open();
    const definition = definitions()[openName()];
    if (!view || !definition) return;
    if (!view.editable) {
      toastService.error(
        view.managedBy === 'task-states'
          ? 'Task states are edited in the space’s settings'
          : 'This workflow was written by something that uses more than this editor can show',
      );
      return;
    }
    const read = draftOf(definition);
    if (!read) {
      toastService.error('This workflow does not read as lanes, so it cannot be edited here');
      return;
    }
    setDraftState({ draft: read, saved: definition });
  }

  function cancelDraft(): void {
    setDraftState(null);
  }

  async function saveDraft(): Promise<void> {
    const state = draftState();
    const view = draft();
    if (!state || !view) return;
    if (!canEdit()) throw new Error('Only whoever administers this space can save its workflows');
    if (view.problems.length) {
      toastService.error(view.problems[0]);
      throw new Error(view.problems.join(' '));
    }
    const definition = definitionOf(state.draft);
    try {
      const { p, h } = writable(definition.name);
      await p.install(h, definition);
    } catch (error) {
      console.error('WorkflowStore: could not save that workflow', error);
      toastService.error('Could not save that workflow');
      throw error;
    }
    setDraftState(null);
    setDefinitions((prev) => ({ ...prev, [definition.name]: definition }));
    await refreshWorkflows();
    await openWorkflow(definition.name);
  }

  async function deleteWorkflow(name: string): Promise<void> {
    if (!canEdit()) throw new Error('Only whoever administers this space can delete its workflows');
    try {
      const { p, h } = writable(name);
      await p.remove(h, name);
    } catch (error) {
      console.error('WorkflowStore: could not delete that workflow', error);
      toastService.error('A workflow can only be deleted once nothing is going through it — archive it instead');
      throw error;
    }
    if (openName() === name) closeWorkflow();
    await refreshWorkflows();
  }

  const requirementsOf = (draftValue: WorkflowDraft, name: string): Requirement[] => [
    ...(draftValue.states[name]?.requires ?? []),
  ];

  const store: WorkflowStore = {
    available,
    capabilities,
    canEdit,
    workflows,
    workflowsLoaded,
    startable,
    open,
    draft,
    recordWorkflows,
    refreshWorkflows,
    openWorkflow,
    closeWorkflow,
    loadHistory,
    startWorkflow,
    moveRecord,
    withdrawRecord,
    newWorkflow,
    editWorkflow,
    cancelDraft,
    saveDraft,
    deleteWorkflow,
    setDraftLabel: (label) =>
      edit((d) => {
        const state = draftState();
        if (state?.saved) return { refused: 'A saved workflow keeps its name.' };
        const name = workflowNameOf(label);
        return name ? { ...d, name } : { refused: 'A workflow needs a name.' };
      }),
    setDraftHint: (hint) => edit((d) => ({ ...d, ...(hint.trim() ? { hint: hint.trim() } : { hint: undefined }) })),
    setDraftEntities: (entities) => edit((d) => ({ ...d, entities: [...new Set(entities.filter(Boolean))] })),
    addStep: (lane, label, after) => submitted((d) => draftEdits.addStep(d, lane, label, after || undefined)),
    removeStep: (name) => edit((d) => draftEdits.removeStep(d, name)),
    moveStep: (name, by) => edit((d) => draftEdits.moveStep(d, name, by < 0 ? -1 : 1)),
    renameStep: (name, label) => edit((d) => draftEdits.renameStep(d, name, label)),
    setStepHint: (name, hint) => edit((d) => draftEdits.setStepHint(d, name, hint)),
    updateStep: (name, changes) =>
      submitted((d) => {
        let next: DraftEdit = d;
        if (changes.hint !== undefined) next = draftEdits.setStepHint(next, name, changes.hint);
        if (!isRefusal(next) && (changes.approvals !== undefined || changes.kind !== undefined)) {
          const current = next.states[name]?.requires ?? [];
          const before = current.find((r) => r.kind === 'approvals');
          const count = changes.approvals ?? (before?.kind === 'approvals' ? before.count : 1);
          const rule = approvalsRule(count, changes.kind ?? (before?.kind === 'approvals' ? kindOf(before.from) : ''));
          const rest = current.filter((r) => r.kind !== 'approvals');
          next = draftEdits.setRequirements(next, name, rule ? [rule, ...rest] : rest);
        }
        // Renamed last: everything above names the step as it was.
        if (!isRefusal(next) && changes.label !== undefined) next = draftEdits.renameStep(next, name, changes.label);
        return next;
      }),
    addBranch: (from, label, rejoins) => submitted((d) => draftEdits.addBranch(d, from, label, rejoins || undefined)),
    setBranchEnd: (lane, rejoins) => edit((d) => draftEdits.setBranchEnd(d, lane, rejoins || undefined)),
    setRule: (rule) => edit((d) => draftEdits.setRule(d, rule)),
    addException: (from, to) => edit((d) => draftEdits.addException(d, from, to)),
    removeException: (from, to) => edit((d) => draftEdits.removeException(d, from, to)),
    setApprovals: (name, count, kind = '') =>
      edit((d) => {
        const rule = approvalsRule(count, kind);
        const rest = requirementsOf(d, name).filter((r) => r.kind !== 'approvals');
        return draftEdits.setRequirements(d, name, rule ? [rule, ...rest] : rest);
      }),
    addEvidence: (name, entity, via, min = 1) =>
      submitted((d) => {
        if (!entity) return { refused: 'Say what kind of record has to be there.' };
        const requirement: Requirement = {
          kind: 'evidence',
          ...evidenceSubjectOf(entity),
          ...(min !== 1 ? { min } : {}),
          ...(via ? { via: { relation: via } } : {}),
        };
        return draftEdits.setRequirements(d, name, [...requirementsOf(d, name), requirement]);
      }),
    removeEvidence: (name, index) =>
      edit((d) => {
        let seen = -1;
        const kept = requirementsOf(d, name).filter((r) => r.kind !== 'evidence' || ++seen !== index);
        return draftEdits.setRequirements(d, name, kept);
      }),
  };

  return <WorkflowContext.Provider value={store}>{props.children}</WorkflowContext.Provider>;
}

export function useWorkflowStore(): WorkflowStore {
  const store = useContext(WorkflowContext);
  if (!store) throw new Error('useWorkflowStore must be used within a WorkflowStoreProvider');
  return store;
}
