/**
 * FlowStore — the space's flows, as the Flows route, a record's inspector and a card read and change
 * them.
 *
 * The Solid binding over three framework-neutral files: `shared/flowLanes.ts` (a flow as a main line,
 * branches and a sequence rule), `shared/flowDraft.ts` (every edit to a flow being written) and
 * `shared/flowViews.ts` (lanes, requirements and a record's walk, in words). Everything a schema shows
 * is computed there; this file decides only *when* — which flow is open, what is being watched, and
 * what a press does.
 *
 * ## What it watches
 *
 * - **The open flow**: every record going through it, for the route's list of records.
 * - **Every startable flow**: so a card or the inspector can say which flows a record is going
 *   through, and where it stands in each (`recordFlows`). One watch per flow; a space has a handful.
 *
 * The task-state flow is listed and shown, but it is the board's: it is written from the space's
 * task states and moved on the board, so it is never edited, started or moved from here
 * (`managedBy: 'task-states'`).
 *
 * ## Who may change what
 *
 * Saving, deleting and archiving a flow are for whoever administers the space — the same person the
 * space's other shared settings answer to. Anybody may start a flow on a record, ask for a move, and
 * take back their own ask.
 */
import * as draftEdits from '@shared/flowDraft';
import {
  definitionOf,
  type DraftEdit,
  draftOf,
  type FlowDraft,
  type FlowPreset,
  isRefusal,
  presetDraft,
  stateLabelOf,
} from '@shared/flowDraft';
import { type FlowSequenceRule, toLanes } from '@shared/flowLanes';
import {
  approvalsRule,
  editorView,
  type FlowEditorView,
  type FlowLabels,
  historyView,
  type RecordView,
  recordView,
  type StepHistoryView,
} from '@shared/flowViews';
import { TASK_FLOW } from '@shared/taskFlow';
import { useDatasetStore } from '@solid/stores/DatasetStore';
import { useSessionStore } from '@solid/stores/SessionStore';
import { useSpaceStore } from '@solid/stores/SpaceStore';
import type { FlowCapabilities, FlowDefinition, FlowItem, FlowRequirement, FlowSummary } from '@we/backend-shared';
import { validateFlowDefinition } from '@we/backend-shared';
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

/** A flow as a list shows it. */
export interface FlowSummaryView {
  name: string;
  label: string;
  /** It can be edited here: it reads back exactly, and nothing else writes it. */
  editable: boolean;
  /** How many records are going through it. */
  records: number;
  /** What writes it, when something other than this editor does. Empty otherwise. */
  managedBy: '' | 'task-states';
  archived: boolean;
}

/** The flow on screen, and the records going through it. */
export interface OpenFlowView extends FlowEditorView {
  label: string;
  editable: boolean;
  managedBy: '' | 'task-states';
  archived: boolean;
  records: RecordView[];
  /** A record's moves, once asked for with `loadHistory`. */
  history: Record<string, StepHistoryView[]>;
}

/** The flow being written. */
export interface FlowDraftView extends FlowEditorView {
  label: string;
  /** Not saved yet at all. */
  isNew: boolean;
  /** Differs from what is saved. */
  dirty: boolean;
  /** What a backend would refuse, as sentences. Saving is refused while there are any. */
  problems: string[];
}

/** One flow a record is going through, as a chip on its card says it. */
export interface RecordFlowChip {
  flow: string;
  label: string;
  state: string | null;
  stateLabel: string;
  /** Moves asked for and not made. */
  waiting: number;
  stalled: boolean;
}

export interface FlowStore {
  /** This space has flows at all: its backend offers them and it is a WE space. */
  available: Accessor<boolean>;
  /** What the backend can enforce, and how — see `FlowCapabilities`. `null` without flows. */
  capabilities: Accessor<FlowCapabilities | null>;
  /** The viewer may save, delete and archive flows here. */
  canEdit: Accessor<boolean>;
  /** Every flow in the space, archived ones included. */
  flows: Accessor<FlowSummaryView[]>;
  /** Flows a record can be started on: not archived, not written by something else. */
  startable: Accessor<{ name: string; label: string; subjects: string[] }[]>;
  /** The flow on screen, or `null`. */
  open: Accessor<OpenFlowView | null>;
  /** The flow being written, or `null`. */
  draft: Accessor<FlowDraftView | null>;
  /** By record id: every startable flow the record is going through. */
  recordFlows: Accessor<Record<string, RecordFlowChip[]>>;

  refreshFlows: () => Promise<void>;
  openFlow: (name: string) => Promise<void>;
  closeFlow: () => void;
  loadHistory: (subject: string) => Promise<void>;

  startFlow: (flow: string, recordId: string) => Promise<void>;
  moveRecord: (flow: string, recordId: string, to: string, note?: string) => Promise<string>;
  withdrawRecord: (flow: string, recordId: string) => Promise<void>;

  newFlow: (preset: FlowPreset, label: string, subjects?: string[]) => void;
  editFlow: () => void;
  cancelDraft: () => void;
  saveDraft: () => Promise<void>;
  deleteFlow: (name: string) => Promise<void>;

  setDraftLabel: (label: string) => void;
  setDraftHint: (hint: string) => void;
  setDraftSubjects: (subjects: string[]) => void;
  addStep: (lane: number, label: string, after?: string) => void;
  removeStep: (name: string) => void;
  moveStep: (name: string, by: number) => void;
  renameStep: (name: string, label: string) => void;
  setStepHint: (name: string, hint: string) => void;
  addBranch: (from: string, label: string, rejoins?: string) => void;
  setBranchEnd: (lane: number, rejoins: string) => void;
  setRule: (rule: FlowSequenceRule) => void;
  addException: (from: string, to: string) => void;
  removeException: (from: string, to: string) => void;
  setApprovals: (name: string, count: number, kind?: string) => void;
  addGuard: (name: string, entity: string, tie?: string, min?: number) => void;
  removeGuard: (name: string, index: number) => void;
}

const FlowContext = createContext<FlowStore>();

/** A flow's name from what a person typed: its words, capitalised and run together. */
function flowNameOf(label: string): string {
  return label
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/** A flow's name as a person reads it: "DesignReview" → "Design review". */
function flowLabelOf(name: string): string {
  if (name === TASK_FLOW) return 'Task states';
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The entities searched for a record's title, when a flow names none. */
const ANY_RECORD = ['TaskBlock', 'TextBlock', 'CollectionBlock', 'EventBlock'];

const titleOf = (row: Record<string, unknown>): string => {
  for (const key of ['title', 'name', 'text']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      const plain = value.replace(/<[^>]*>/g, '').trim();
      return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
    }
  }
  return '';
};

export function FlowStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const spaceStore = useSpaceStore();

  const port = () => (datasetStore.isWeSpace() ? (session.backendPorts()?.flows ?? null) : null);
  const handle = () => datasetStore.currentDataset()?.handle;
  const datasetId = () => datasetStore.currentDataset()?.id ?? '';
  const me = () => session.me()?.did;

  const available = () => Boolean(port() && handle());
  const capabilities = () => port()?.capabilities ?? null;
  const canEdit = () => available() && spaceStore.canAdministerCurrentSpace();

  /**
   * Words for a flow's steps. The task-state flow's steps are the space's task states, so they read as
   * the community named them; any other flow's read from their names.
   */
  const taskStateNames = createMemo(() => new Map(spaceStore.taskStates().map((s) => [s.slug, s.name])));
  const kindNames = createMemo(() => new Map(spaceStore.involvementTypes().map((k) => [k.slug, k.name])));
  const labelsFor = (flow: string): FlowLabels => ({
    state: (name) => (flow === TASK_FLOW ? taskStateNames().get(name) : undefined) ?? stateLabelOf(name),
    kind: (slug) => kindNames().get(slug) ?? stateLabelOf(slug),
  });

  // ─── The list ────────────────────────────────────────────────────────────────

  const [summaries, setSummaries] = createSignal<FlowSummary[]>([]);

  async function refreshFlows(): Promise<void> {
    const p = port();
    const h = handle();
    if (!p || !h) {
      setSummaries([]);
      return;
    }
    try {
      setSummaries(await p.list(h));
    } catch (error) {
      console.warn('FlowStore: could not list the flows', error);
    }
  }

  // Asked again whenever the space changes; after a write, the write asks.
  createEffect(() => {
    datasetId();
    available();
    void untrack(refreshFlows);
  });

  const flows = createMemo<FlowSummaryView[]>(() => {
    const archived = new Set(spaceStore.archivedFlows());
    return summaries()
      .map((s) => {
        const managedBy = s.name === TASK_FLOW ? ('task-states' as const) : ('' as const);
        return {
          name: s.name,
          label: flowLabelOf(s.name),
          editable: s.editable && !managedBy,
          records: s.records,
          managedBy,
          archived: archived.has(s.name),
        };
      })
      .sort((a, b) => Number(Boolean(b.managedBy)) - Number(Boolean(a.managedBy)) || a.label.localeCompare(b.label));
  });

  // ─── Definitions, read once per flow and kept ────────────────────────────────

  const [definitions, setDefinitions] = createSignal<Record<string, FlowDefinition>>({});
  const definitionOfFlow = async (name: string): Promise<FlowDefinition | null> => {
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

  const startableNames = createMemo(
    () =>
      flows()
        .filter((f) => !f.archived && !f.managedBy)
        .map((f) => f.name),
    [],
    { equals: (a, b) => a.join('\u0000') === b.join('\u0000') },
  );

  const startable = createMemo(() => {
    const defs = definitions();
    return startableNames().map((name) => ({ name, label: flowLabelOf(name), subjects: defs[name]?.subjects ?? [] }));
  });

  // ─── Watching ────────────────────────────────────────────────────────────────

  const [items, setItems] = createSignal<Record<string, FlowItem[]>>({});

  /** Watch these flows, and only these, for as long as the space is on screen. */
  function watchFlows(names: () => string[]) {
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
        void definitionOfFlow(name).catch(() => {});
        void p
          .watch(h, name, (view) => {
            if (!cancelled) setItems((prev) => ({ ...prev, [name]: view.items }));
          })
          .then(
            (stop) => (cancelled ? stop() : stops.push(stop)),
            (error: unknown) => console.warn('FlowStore: could not watch', name, error),
          );
      }
    });
  }

  const [openName, setOpenName] = createSignal('');
  watchFlows(startableNames);
  watchFlows(() => (openName() && !startableNames().includes(openName()) ? [openName()] : []));

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
    const missing = list.map((item) => item.subject).filter((id) => !(id in known));
    if (!missing.length) return;
    const entities = definition?.subjects.length ? definition.subjects : ANY_RECORD;
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

  // ─── The open flow ───────────────────────────────────────────────────────────

  const [history, setHistory] = createSignal<Record<string, StepHistoryView[]>>({});

  async function openFlow(name: string): Promise<void> {
    if (!name) return closeFlow();
    setOpenName(name);
    setHistory({});
    setDefinitions(({ [name]: _stale, ...rest }) => rest);
    try {
      await definitionOfFlow(name);
    } catch (error) {
      console.error('FlowStore: could not read that flow', error);
      toastService.error('Could not open that flow');
      throw error;
    }
  }

  function closeFlow(): void {
    setOpenName('');
    setHistory({});
  }

  const open = createMemo<OpenFlowView | null>(() => {
    const name = openName();
    const definition = definitions()[name];
    if (!name || !definition) return null;
    const summary = flows().find((f) => f.name === name);
    const labels = labelsFor(name);
    const view = editorView(definition, labels);
    const { model } = toLanes(definition);
    const named = titles();
    return {
      ...view,
      label: flowLabelOf(name),
      editable: summary?.editable ?? false,
      managedBy: summary?.managedBy ?? (name === TASK_FLOW ? 'task-states' : ''),
      archived: summary?.archived ?? false,
      records: (items()[name] ?? []).map((item) =>
        recordView(definition, model, item, named[item.subject] ?? '', me(), labels),
      ),
      history: history(),
    };
  });

  async function loadHistory(subject: string): Promise<void> {
    const p = port();
    const h = handle();
    const name = openName();
    if (!p || !h || !name) return;
    try {
      const steps = await p.history(h, name, subject);
      setHistory((prev) => ({ ...prev, [subject]: historyView(steps, labelsFor(name)) }));
    } catch (error) {
      console.error('FlowStore: could not read that record’s history', error);
      toastService.error('Could not read what happened to that record');
      throw error;
    }
  }

  // ─── Records ─────────────────────────────────────────────────────────────────

  const recordFlows = createMemo<Record<string, RecordFlowChip[]>>(() => {
    const out: Record<string, RecordFlowChip[]> = {};
    const all = items();
    for (const name of startableNames()) {
      for (const item of all[name] ?? []) {
        (out[item.subject] ??= []).push({
          flow: name,
          label: flowLabelOf(name),
          state: item.state,
          stateLabel: item.state ? labelsFor(name).state(item.state) : '',
          waiting: item.waiting.length,
          stalled: item.stalled,
        });
      }
    }
    return out;
  });

  const writable = (flow: string) => {
    if (flow === TASK_FLOW) throw new Error('Tasks move through their states on the board');
    const p = port();
    const h = handle();
    if (!p || !h) throw new Error('This space has no flows');
    return { p, h };
  };

  async function startFlow(flow: string, recordId: string): Promise<void> {
    try {
      const { p, h } = writable(flow);
      await p.start(h, flow, recordId);
    } catch (error) {
      console.error('FlowStore: could not start that flow', error);
      toastService.error('Could not start that flow');
      throw error;
    }
  }

  async function moveRecord(flow: string, recordId: string, to: string, note?: string): Promise<string> {
    let outcome: string;
    try {
      const { p, h } = writable(flow);
      const result = await p.move(h, flow, recordId, to, note ? { note } : undefined);
      outcome = result.outcome === 'refused' ? result.reason : result.outcome;
    } catch (error) {
      console.error('FlowStore: could not ask for that move', error);
      toastService.error('Could not ask for that move');
      throw error;
    }
    if (outcome === 'unmet') toastService.error('Not yet — what that step asks for is not there');
    else if (outcome === 'not-allowed') toastService.error('It cannot move there from where it is');
    else if (outcome === 'stalled')
      toastService.error('Stuck between two agreed moves — one of them has to be withdrawn');
    else if (outcome === 'pending') toastService.info('Still being counted — it will move when it has');
    return outcome;
  }

  async function withdrawRecord(flow: string, recordId: string): Promise<void> {
    try {
      const { p, h } = writable(flow);
      await p.withdraw(h, flow, recordId);
    } catch (error) {
      console.error('FlowStore: could not withdraw that', error);
      toastService.error('Could not withdraw that');
      throw error;
    }
  }

  // ─── Writing a flow ──────────────────────────────────────────────────────────

  const [draftState, setDraftState] = createSignal<{ draft: FlowDraft; saved: FlowDefinition | null } | null>(null);

  const draft = createMemo<FlowDraftView | null>(() => {
    const state = draftState();
    if (!state) return null;
    const definition = definitionOf(state.draft);
    const caps = capabilities();
    const taken = !state.saved && flows().some((f) => f.name === state.draft.name);
    return {
      ...editorView(definition, labelsFor(state.draft.name), state.draft.model),
      label: flowLabelOf(state.draft.name),
      isNew: !state.saved,
      dirty: !state.saved || JSON.stringify(state.saved) !== JSON.stringify(definition),
      problems: [
        ...(taken ? [`There is already a flow called "${flowLabelOf(state.draft.name)}".`] : []),
        ...validateFlowDefinition(definition, caps ?? undefined),
      ],
    };
  });

  /** Apply one edit to the draft, or say why it cannot be made. */
  const edit = (change: (draft: FlowDraft) => DraftEdit) => {
    const state = draftState();
    if (!state) return;
    const next = change(state.draft);
    if (isRefusal(next)) {
      toastService.error(next.refused);
      return;
    }
    setDraftState({ ...state, draft: next });
  };

  function newFlow(preset: FlowPreset, label: string, subjects: string[] = ['TaskBlock']): void {
    const name = flowNameOf(label) || 'NewFlow';
    setDraftState({ draft: presetDraft(preset, name, subjects), saved: null });
  }

  function editFlow(): void {
    const view = open();
    const definition = definitions()[openName()];
    if (!view || !definition) return;
    if (!view.editable) {
      toastService.error(
        view.managedBy === 'task-states'
          ? 'Task states are edited in the space’s settings'
          : 'This flow was written by something that uses more than this editor can show',
      );
      return;
    }
    const read = draftOf(definition);
    if (!read) {
      toastService.error('This flow does not read as lanes, so it cannot be edited here');
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
    if (!canEdit()) throw new Error('Only whoever administers this space can save its flows');
    if (view.problems.length) {
      toastService.error(view.problems[0]);
      throw new Error(view.problems.join(' '));
    }
    const definition = definitionOf(state.draft);
    try {
      const { p, h } = writable(definition.name);
      await p.install(h, definition);
    } catch (error) {
      console.error('FlowStore: could not save that flow', error);
      toastService.error('Could not save that flow');
      throw error;
    }
    setDraftState(null);
    setDefinitions((prev) => ({ ...prev, [definition.name]: definition }));
    await refreshFlows();
    await openFlow(definition.name);
  }

  async function deleteFlow(name: string): Promise<void> {
    if (!canEdit()) throw new Error('Only whoever administers this space can delete its flows');
    try {
      const { p, h } = writable(name);
      await p.remove(h, name);
    } catch (error) {
      console.error('FlowStore: could not delete that flow', error);
      toastService.error('A flow can only be deleted once nothing is going through it — archive it instead');
      throw error;
    }
    if (openName() === name) closeFlow();
    await refreshFlows();
  }

  const requirementsOf = (draftValue: FlowDraft, name: string): FlowRequirement[] => [
    ...(draftValue.states[name]?.requires ?? []),
  ];

  const store: FlowStore = {
    available,
    capabilities,
    canEdit,
    flows,
    startable,
    open,
    draft,
    recordFlows,
    refreshFlows,
    openFlow,
    closeFlow,
    loadHistory,
    startFlow,
    moveRecord,
    withdrawRecord,
    newFlow,
    editFlow,
    cancelDraft,
    saveDraft,
    deleteFlow,
    setDraftLabel: (label) =>
      edit((d) => {
        const state = draftState();
        if (state?.saved) return { refused: 'A saved flow keeps its name.' };
        const name = flowNameOf(label);
        return name ? { ...d, name } : { refused: 'A flow needs a name.' };
      }),
    setDraftHint: (hint) => edit((d) => ({ ...d, ...(hint.trim() ? { hint: hint.trim() } : { hint: undefined }) })),
    setDraftSubjects: (subjects) => edit((d) => ({ ...d, subjects: [...new Set(subjects.filter(Boolean))] })),
    addStep: (lane, label, after) => edit((d) => draftEdits.addStep(d, lane, label, after || undefined)),
    removeStep: (name) => edit((d) => draftEdits.removeStep(d, name)),
    moveStep: (name, by) => edit((d) => draftEdits.moveStep(d, name, by < 0 ? -1 : 1)),
    renameStep: (name, label) => edit((d) => draftEdits.renameStep(d, name, label)),
    setStepHint: (name, hint) => edit((d) => draftEdits.setStepHint(d, name, hint)),
    addBranch: (from, label, rejoins) => edit((d) => draftEdits.addBranch(d, from, label, rejoins || undefined)),
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
    addGuard: (name, entity, tie, min = 1) =>
      edit((d) => {
        if (!entity) return { refused: 'Say what kind of record has to be there.' };
        const guard: FlowRequirement = {
          kind: 'guard',
          entity,
          ...(min !== 1 ? { min } : {}),
          ...(tie ? { tie: { relation: tie } } : {}),
        };
        return draftEdits.setRequirements(d, name, [...requirementsOf(d, name), guard]);
      }),
    removeGuard: (name, index) =>
      edit((d) => {
        let seen = -1;
        const kept = requirementsOf(d, name).filter((r) => r.kind !== 'guard' || ++seen !== index);
        return draftEdits.setRequirements(d, name, kept);
      }),
  };

  return <FlowContext.Provider value={store}>{props.children}</FlowContext.Provider>;
}

export function useFlowStore(): FlowStore {
  const store = useContext(FlowContext);
  if (!store) throw new Error('useFlowStore must be used within a FlowStoreProvider');
  return store;
}
