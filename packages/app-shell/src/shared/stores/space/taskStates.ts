/**
 * The states a space's work moves through: its `TaskState` records, followed live, in the community's
 * own order; whether moving between them asks for agreement, and the workflow that counts it; and what
 * the record layer and extraction are told about them. Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * A new space's starter writes the first ones, once, at the create press — so they are the
 * community's own from the start, and editing "To do" is an edit like any other. There are no
 * defaults standing in for records: a space with no states has none, and its boards have no
 * columns, which is what a starter that seeds none asked for.
 *
 * Held here rather than queried in a template, because every board, picker and key reads the same
 * ordered list, and the order is the community's (`Space.taskStates`).
 */
import type { WorkflowView } from '@we/backend-shared';
import { trace } from '@we/backend-shared';
import { getEntityForDataset, Space, type TaskBlock, TaskState } from '@we/entities';

import type { BoardWorkflow } from '../../boards';
import { distinctSignal } from '../../distinctSignal';
import { evidenceSubjectOf } from '../../evidenceSubjects';
import { followLive } from '../../followLive';
import { hostSlot } from '../../hostSlot';
import {
  approvalsOf,
  compileTaskWorkflow,
  createTaskWorkflowActions,
  needsAgreement,
  openMoveOf,
  readTaskStateEvidence,
  storeTaskStateEvidence,
  TASK_WORKFLOW,
  type TaskStateRule,
  type TaskWorkflowRule,
  workflowStateOf,
} from '../../taskWorkflow';
import type { TaskWorkflowLive } from '../../taskWorkflowLive';
import { deriveSlug } from '../../utils';
import { idListOf } from '../../viewResolution';
import { evidenceLabel, refusalWords } from '../../workflowViews';
import type { RecordStore } from '../RecordStore';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';
import type { SpaceOnScreen } from './onScreen';
import type { TaskStateView } from './types';
import type { SpaceWrites } from './writes';

export interface SpaceTaskStatesDeps extends SpaceContext {
  recordStore: Pick<RecordStore, 'provideVocabularies'>;
  onScreen: Pick<SpaceOnScreen, 'currentSpace' | 'pushedOnScreen'>;
  writes: Pick<SpaceWrites, 'writeSpaceFields' | 'writeSpaceSetting'>;
  /** Whether this agent administers the space on screen — the roles' answer. */
  canAdministerCurrentSpace: () => boolean;
  /** The space's task workflow as the board draws it — the app's one, published here. */
  taskWorkflowLive: TaskWorkflowLive;
}

function taskStateIds(rows: unknown): string[] {
  return ((Array.isArray(rows) ? rows : []) as ({ id?: string } | string)[])
    .map((row) => (typeof row === 'string' ? row : (row?.id ?? '')))
    .filter(Boolean);
}

const sameState = (a: TaskStateView, b: TaskStateView) =>
  a.id === b.id &&
  a.name === b.name &&
  a.slug === b.slug &&
  a.semantic === b.semantic &&
  a.color === b.color &&
  a.icon === b.icon &&
  a.retired === b.retired &&
  a.approvals === b.approvals &&
  a.approverKind === b.approverKind &&
  JSON.stringify(a.evidence) === JSON.stringify(b.evidence);

export function createSpaceTaskStates(deps: SpaceTaskStatesDeps) {
  const {
    reactivity,
    toasts,
    sessionStore: session,
    datasetStore,
    recordStore,
    onScreen,
    writes,
    runCore,
    reportOperation,
    canAdministerCurrentSpace,
    taskWorkflowLive,
  } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const { currentSpace, pushedOnScreen } = onScreen;

  /*
    Give the space's own board a column for a state just named. The boards are the content part's,
    and they read the states this part offers — so the content part is built after this one and lends
    the column write back through `provideSpaceBoard`, reached only when somebody names a state.
  */
  const spaceBoard = hostSlot<(slug: string, name: string) => Promise<void>>();
  const addStateToSpaceBoard = (slug: string, name: string) =>
    spaceBoard.need('SpaceStore: the space board (provideSpaceBoard)')(slug, name);
  const { writeSpaceFields, writeSpaceSetting } = writes;

  const [ownTaskStates, setOwnTaskStates] = reactivity.signal<TaskStateView[]>([]);
  const [taskStatesLoaded, setTaskStatesLoaded] = distinctSignal(reactivity, false);
  const [taskStateOrder, setTaskStateOrder] = reactivity.signal<string[]>([]);
  /** The workflow's runs as last watched, with the key they were watched under — see the publish below. */
  const [taskWorkflowView, setTaskWorkflowView] = distinctSignal<{ key: string; view: WorkflowView } | null>(
    reactivity,
    null,
  );

  /**
   * Read the space's own states. `quiet` for a re-read after somebody changed one: the list is
   * already on screen, and dropping back to "not loaded" would flash every surface gated on it.
   */
  async function loadTaskStates(quiet = false): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const uuid = datasetStore.currentDataset()?.id;
    const ports = session.backendPorts()?.schemas;
    if (!dataset || !ports || !datasetStore.isWeSpace()) {
      batch(() => {
        setOwnTaskStates([]);
        setTaskStatesLoaded(true);
      });
      return;
    }
    if (!quiet) setTaskStatesLoaded(false);
    try {
      // Every space predates this entity, so none of them have its shape installed. `ensure` is the
      // diff-first idempotent path — a read in the common case — and the same step `loadShapes`
      // takes for exactly this reason.
      await ports.ensure(dataset, TaskState);
      const records = await TaskState.findAll(dataset);
      if (datasetStore.currentDataset()?.id !== uuid) return; // navigated away while loading
      applyTaskStates(records);
    } catch (error) {
      console.warn('SpaceStore: could not read task states', error);
      if (datasetStore.currentDataset()?.id === uuid) setOwnTaskStates([]);
    } finally {
      if (datasetStore.currentDataset()?.id === uuid) setTaskStatesLoaded(true);
    }
  }

  /** The space's state records, as the store holds them — from a read, or from what a watch pushed. */
  function applyTaskStates(rows: TaskState[]): void {
    setOwnTaskStates(
      rows.map((r: TaskState) => ({
        id: r.id,
        name: r.name || r.slug,
        slug: r.slug || deriveSlug(r.name || ''),
        semantic: r.semantic || 'open',
        color: r.color || '',
        icon: r.icon || '',
        retired: Boolean(r.retired),
        // A record written before these existed has neither: one approval, from anybody.
        approvals: approvalsOf({ slug: '', approvals: r.approvals }),
        approverKind: r.approverKind || '',
        evidence: readTaskStateEvidence(r.evidence).map((g) => ({
          entity: g.entity,
          ...(g.where ? { where: g.where } : {}),
          via: g.via && 'relation' in g.via ? g.via.relation : '',
          min: g.min ?? 1,
          label: evidenceLabel(g),
        })),
      })),
    );
  }

  /*
    Followed from entering the space.

    Another member's rename, colour or new state has to reach everybody here: a member still holding
    an old rule would be offered Approve on a move their vote no longer counts toward.

    The watch starts after `ensure`, which installs the entity's shape on a space that predates it —
    a query against a shape the dataset does not hold has nothing to watch.
  */
  effect(() => {
    const dataset = datasetStore.currentDataset()?.handle;
    const weSpace = datasetStore.isWeSpace();
    const ports = session.backendPorts()?.schemas;
    if (!dataset || !weSpace || !ports) {
      // Nothing to follow: the list is empty, and answered.
      untrack(() => void loadTaskStates());
      return;
    }
    setTaskStatesLoaded(false);
    followLive(
      reactivity,
      async (current) => {
        // The shape is installed first — see above. After that the query's first result is the list.
        await ports.ensure(dataset, TaskState);
        return current() ? TaskState.query(dataset, {}) : undefined;
      },
      {
        store: 'SpaceStore',
        what: 'task states',
        // The pushed rows are the states, whole — the read `loadTaskStates` makes — so a change is
        // applied from them. The list is already on screen, so nothing drops back to "not loaded".
        apply: (rows) =>
          batch(() => {
            try {
              applyTaskStates(rows);
            } catch (error) {
              console.warn('SpaceStore: could not read task states', error);
            }
            setTaskStatesLoaded(true);
          }),
        stored: { read: () => TaskState.findAll(dataset), apply: applyTaskStates },
        // The states held are the previous space's (this effect runs per space), so a list that could
        // not be read is emptied; either way the list is answered.
        settled: (loaded) =>
          batch(() => {
            if (!loaded) setOwnTaskStates([]);
            setTaskStatesLoaded(true);
          }),
      },
    );
  });

  /*
    The community's chosen order — a separate fact from which states exist, see `Space.taskStates`.

    Read through an `include` on a fresh fetch rather than off a copy of the space record. A copy is
    whatever the last push carried, and reading one made by an optimistic write handed back the order
    from *before* the write — the list snapped to the old arrangement, then never caught up. A
    hydrated include goes through the backend's ordered read, so what comes back is the arrangement
    as every peer would read it.

    Re-run whenever the space record changes, which is how a peer's reorder reaches this screen, and
    how this agent's own write is confirmed after `reorderTaskStates` has already shown it.
  */

  /** The state order a pushed record carries, or null for a record that is not a push or carries none. */
  function pushedTaskStateOrder(space: Space): string[] | null {
    if (!pushedOnScreen(space) || !Array.isArray(space.taskStates)) return null;
    return taskStateIds(space.taskStates);
  }

  async function loadTaskStateOrder(spaceId: string): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    if (!dataset) return;
    try {
      const record = await Space.findOne(dataset, { where: { id: spaceId }, include: { taskStates: true } });
      if (currentSpace()?.id !== spaceId) return; // moved on while loading
      setTaskStateOrder(taskStateIds(record?.taskStates));
    } catch (error) {
      console.warn('SpaceStore: could not read the task state order', error);
    }
  }

  effect(() => {
    const space = currentSpace();
    if (!space?.id) {
      setTaskStateOrder([]);
      return;
    }
    /*
      A record the live read pushed carries the order already: the read includes `taskStates`, and a
      push is the backend's hydrated, ordered read made after the change it reports — the same answer
      the fresh read below gets. A copy this store made for an optimistic write is not a push, and its
      `taskStates` may predate a reorder, so that one is read fresh.
    */
    const pushed = pushedTaskStateOrder(space);
    if (pushed) setTaskStateOrder(pushed);
    else untrack(() => void loadTaskStateOrder(space.id));
  });

  /**
   * The row objects the list rendered last time, by slug, so a recompute hands back the same object
   * for a state that has not changed. The renderer keys `$each` rows by reference: a fresh object per
   * state per recompute remounted every row — the flash — and with it the sortable's own bookkeeping.
   */
  let renderedTaskStates = new Map<string, TaskStateView>();

  /**
   * The states this space uses, as screens read them.
   *
   * "To do" renamed to "Backlog" is one state with one slug, and every task holding `todo` follows it.
   *
   * Ordered by the community's own arrangement where it has one, and otherwise by semantic — what is
   * coming, what is happening, what is stuck, what is finished, what was dropped. That is the only
   * ordering that means anything across communities, and a position number on each state would be a
   * scalar two people editing at once break — see the note on `TaskState`.
   */
  const taskStates = memo<TaskStateView[]>(() => {
    const states = [...ownTaskStates()];
    /*
      The community's own order where it has one, and what a state *counts as* where it has not.

      Position hints over a membership, one more time: a state the order does not mention is not
      dropped, it follows the ones it does — which is what lets a newly named state appear at all
      without anybody having to arrange the columns first.
    */
    const chosen = taskStateOrder();
    // Reading order for a state nobody has positioned: what is coming, what is happening, what is
    // stuck, what is finished, what was dropped. An unrecognised value sorts first, with the
    // outstanding work, which is where something nobody can read belongs.
    const rank: Record<string, number> = { open: 0, active: 1, blocked: 2, done: 3, cancelled: 4 };
    const at = (state: TaskStateView) => {
      const i = chosen.indexOf(state.id);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    };
    const sorted = states.sort((a, b) => {
      if (at(a) !== at(b)) return at(a) < at(b) ? -1 : 1;
      return (rank[a.semantic] ?? 0) - (rank[b.semantic] ?? 0);
    });
    const next = new Map<string, TaskStateView>();
    const stable = sorted.map((state) => {
      const previous = renderedTaskStates.get(state.slug);
      const view = previous && sameState(previous, state) ? previous : state;
      next.set(state.slug, view);
      return view;
    });
    renderedTaskStates = next;
    return stable;
  });

  /** The states a person should be offered — the same list, without the withdrawn ones. */
  const offeredTaskStates = memo<TaskStateView[]>(() => taskStates().filter((s) => !s.retired));

  /*
    The space's task states as a workflow — see `shared/taskWorkflow.ts` for when a space has one and
    what it compiles to.

    Every state, withdrawn ones included: work still sits in a withdrawn state, and a workflow that did
    not know it could not move that work out of it.

    The same list while the rules read the same, so a rename or a colour wakes nothing that follows
    the workflow.
  */
  let heldRules: TaskStateRule[] = [];
  const taskWorkflowRules = memo<TaskStateRule[]>(() => {
    const rules = taskStates().map((s) => ({
      slug: s.slug,
      approvals: s.approvals,
      approverKind: s.approverKind,
      evidence: readTaskStateEvidence(storeTaskStateEvidence(s.evidence)),
    }));
    if (JSON.stringify(rules) !== JSON.stringify(heldRules)) heldRules = rules;
    return heldRules;
  });
  const taskWorkflowRule = memo<TaskWorkflowRule>(() => {
    const rule = currentSpace()?.taskWorkflowRule ?? '';
    return rule === 'next' || rule === 'next-and-back' ? rule : '';
  });
  const taskWorkflowDefinition = memo(() => compileTaskWorkflow(taskWorkflowRules(), taskWorkflowRule()));
  /** Why a task's move was refused, naming the rule — in the community's own words for its states. */
  const explainTaskMove = (from: string, to: string, outcome: string): string | null => {
    const names = new Map(taskStates().map((state) => [state.slug, state.name]));
    return refusalWords(untrack(taskWorkflowDefinition), from, to, outcome, {
      state: (slug) => names.get(slug) ?? slug,
      kind: (slug) => slug,
    });
  };
  const taskWorkflowEnabled = (): boolean =>
    Boolean(taskWorkflowDefinition() && session.backendPorts()?.workflows && datasetStore.isWeSpace());

  const taskWorkflow = createTaskWorkflowActions({
    dataset: () => datasetStore.currentDataset()?.handle,
    port: () => (taskWorkflowEnabled() ? session.backendPorts()?.workflows : undefined),
    states: () => taskWorkflowRules(),
    rule: () => taskWorkflowRule(),
  });

  /*
    Keep the definition installed, and watch the runs.

    Keyed on the space and the definition's text, so a recompute of the states that changes nothing
    about agreement — a rename, a colour — neither reinstalls nor re-subscribes.

    **Installed only by whoever administers the space.** The definition is shared: every member's
    board derives from the one copy the space holds, so one person owns writing it — the same person
    the space's other shared settings answer to. A member's device only watches. The port diffs
    before writing, so an administrator opening a space whose definition is already current writes
    nothing.
  */
  const taskWorkflowKey = memo(() => {
    const definition = taskWorkflowDefinition();
    const id = datasetStore.currentDataset()?.id;
    return definition && id && taskWorkflowEnabled() ? `${id}\u0000${JSON.stringify(definition)}` : '';
  });
  effect(() => {
    const key = taskWorkflowKey();
    setTaskWorkflowView(null);
    if (!key) return;
    const port = session.backendPorts()?.workflows;
    const dataset = datasetStore.currentDataset()?.handle;
    const definition = untrack(taskWorkflowDefinition);
    if (!port || !dataset || !definition) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
      stop?.();
    });
    void (async () => {
      if (untrack(canAdministerCurrentSpace)) {
        try {
          await port.install(dataset, definition);
        } catch (error) {
          console.error('SpaceStore: could not install the task workflow', error);
          toasts.error('Could not save which moves need agreement');
        }
      }
      if (cancelled) return;
      try {
        const unsubscribe = await port.watch(dataset, TASK_WORKFLOW, (view) => {
          if (!cancelled) setTaskWorkflowView({ key, view });
        });
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      } catch (error) {
        console.warn('SpaceStore: could not watch the task workflow', error);
      }
    })();
  });

  /*
    What the board draws from — the view and the rules, together, or nothing.

    A view is published only under the key it was watched under, so a view of the last definition is
    never drawn beside the rules of the next, whichever of these two effects hears the change first.
  */
  effect(() => {
    const held = taskWorkflowView();
    const key = taskWorkflowKey();
    const rules = Object.fromEntries(
      taskWorkflowRules().map((rule) => [
        rule.slug,
        { approvals: approvalsOf(rule), approverKind: rule.approverKind ?? '' },
      ]),
    );
    taskWorkflowLive.set(key && held?.key === key ? { view: held.view, rules } : null);
  });
  onCleanup(() => taskWorkflowLive.set(null));

  /** What a board asks of the workflow: whether there is one, and a move through it. */
  const boardWorkflow: BoardWorkflow = {
    enabled: () => taskWorkflow.enabled(),
    needsAgreement: (slug) => needsAgreement(taskWorkflowRules().find((state) => state.slug === slug)),
    stateOf: (taskId) => workflowStateOf(taskWorkflowLive.view(), taskId),
    move: (taskId, from, to) => taskWorkflow.move(taskId, from, to),
    entryFor: (to) => taskWorkflow.entryFor(to),
    explain: (from, to, outcome) => explainTaskMove(from, to, outcome ?? ''),
  };

  /**
   * Write `status` to follow a move that happened, for every surface that reads it rather than the run.
   * Whoever's action made the move writes it, so it is written once and by somebody who saw it happen.
   */
  async function mirrorTaskStatus(taskId: string, slug: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    // The registry answers untyped, but what it holds under 'TaskBlock' is the TaskBlock class.
    const Task = p ? (getEntityForDataset('TaskBlock', p) as typeof TaskBlock | undefined) : undefined;
    if (!p || !Task) return;
    const task = await Task.findOne(p, { where: { id: taskId } });
    if (!task || task.status === slug) return;
    task.status = slug;
    const started = performance.now();
    await task.save();
    trace('workflows', 'mirror', { taskId, slug, ms: Math.round(performance.now() - started) });
  }

  /**
   * Agree with the move a task is waiting on — which is asking for the same move, so it is exactly
   * what dragging the card there would do.
   */
  async function approveTaskMove(taskId: string): Promise<void> {
    const view = taskWorkflowLive.view();
    const move = openMoveOf(view, taskId);
    const from = workflowStateOf(view, taskId);
    if (!move || !from) return;
    try {
      const outcome = await taskWorkflow.move(taskId, from, move.to);
      if (outcome === 'moved' || outcome === 'already-there') await mirrorTaskStatus(taskId, move.to);
      else if (outcome === 'stalled') {
        toasts.error('That card is stuck between two moves — one of them has to be withdrawn');
      } else if (outcome === 'slow') {
        // Not a failure: the vote is usually counted after the call gives up waiting, and the board
        // moves the card when it is.
        toasts.info('The node is still counting your approval — the card will move when it has');
      } else if (outcome === 'unmet') {
        toasts.error(explainTaskMove(from, move.to, outcome) ?? 'Not yet — what that column asks for is not there');
      } else if (outcome === 'not-allowed') {
        toasts.error(explainTaskMove(from, move.to, outcome) ?? 'That card cannot move there from where it is');
      }
    } catch (error) {
      console.error('SpaceStore: could not agree with that move', error);
      toasts.error('Could not agree with that move');
    }
  }

  /** Take back this agent's vote on the move a task is waiting on. */
  async function withdrawTaskMove(taskId: string): Promise<void> {
    try {
      await taskWorkflow.withdraw(taskId);
    } catch (error) {
      console.error('SpaceStore: could not withdraw that vote', error);
      toasts.error('Could not withdraw that');
    }
  }

  // The same list while the names read the same, so a push that changes something else wakes nothing.
  let heldArchived: string[] = [];
  const archivedWorkflows = memo<string[]>(() => {
    const names = idListOf(currentSpace()?.archivedWorkflows);
    if (names.join('\u0000') !== heldArchived.join('\u0000')) heldArchived = names;
    return heldArchived;
  });

  /**
   * Put a workflow away or bring it back — `core.setWorkflowArchived`, cached and republished the
   * way every setting on the space is.
   */
  async function setWorkflowArchived(name: string, archived: boolean): Promise<void> {
    const ds = datasetStore.currentDataset();
    const space = currentSpace();
    if (!ds || !space) return;
    if (!canAdministerCurrentSpace()) throw new Error('Only whoever administers this space can archive its workflows');
    if (!name || idListOf(space.archivedWorkflows).includes(name) === archived) return;
    await writeSpaceSetting(ds, space, 'setWorkflowArchived', 'archivedWorkflows', { workflow: name, archived });
  }

  /** See the interface. Persisted on the space the way `setWorkflowArchived` is. */
  async function setTaskWorkflowRule(rule: '' | 'next' | 'next-and-back'): Promise<void> {
    const ds = datasetStore.currentDataset();
    const space = currentSpace();
    if (!ds || !space) return;
    if (!canAdministerCurrentSpace()) throw new Error('Only whoever administers this space can change how tasks move');
    const next = rule === 'next' || rule === 'next-and-back' ? rule : '';
    if ((space.taskWorkflowRule ?? '') === next) return;
    await writeSpaceFields(ds, space, { taskWorkflowRule: next });
  }

  /*
    Hand the record layer the vocabularies this community owns.

    A property whose declaration names a `vocabulary` has an `options` list that is only a floor —
    `TaskBlock.status` declares the three defaults because an extraction model has to be shown words
    it can use, and nothing enforces them, so a space that has named "Blocked" holds tasks in a state
    that list does not contain. A picker built from the declaration alone would refuse to offer the
    state the record is already in.

    Slugs, because a slug is what `TaskBlock.status` stores and what the declaration's own options
    are. Withdrawn states are left out for the reason `offeredTaskStates` exists: a picker should not
    offer a state the community has stopped using, even though work already sitting in one keeps it.

    Lent rather than read: this lives on records in the space, and the record store is composed
    before this one.
  */
  onCleanup(
    recordStore.provideVocabularies((vocabulary) =>
      vocabulary === 'taskState' ? offeredTaskStates().map((state) => state.slug) : undefined,
    ),
  );

  /**
   * Tell extraction which states this space actually uses.
   *
   * A model fills `TaskBlock.status` from the vocabulary it is shown, and what it is shown is the
   * hint on the *stored shape* — which the backend reads instead of the model class, so a space is
   * already the override point (see `interpretationHints.ts`). Without this, a community could add
   * "Blocked", get a Blocked column, and watch extraction keep writing the three defaults forever,
   * because nothing connected naming a state to telling the model it existed.
   *
   * Only for a space that has written a state of its own. One still on the defaults already matches
   * the declared hint, so writing it would customise every space to say what it already said — and a
   * customised hint stops receiving improvements from releases, which is a real cost to pay for a
   * no-op. Once a space has any state of its own the hint lists everything it offers, virtual
   * defaults included, since those are states too.
   *
   * Withdrawn states are left out: a state nobody may pick is not one a model should write.
   *
   * Known limitation, and it is the one `interpretationHints.ts` documents for every hint: a
   * *structural* shape refresh — the model gaining a property in a release — rewrites the stored
   * shape and drops customised hints with it. This is re-derived the next time a state changes
   * rather than watched for, because the alternative is a read on every space open to check whether
   * a hint the community may never have touched still says what we last wrote.
   */
  async function syncTaskStateHint(): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const ports = session.backendPorts()?.schemas;
    const offered = untrack(offeredTaskStates);
    if (!dataset || !ports || !untrack(ownTaskStates).length || !offered.length) return;
    const list = offered.map((state) => `"${state.slug}"`).join(', ');
    /*
      Where a task lands when the conversation does not say.

      **The community's first column**, not "the first state that counts as open" — which any
      second open state could take over.

      Reading it as the first column makes it something the community can *see* and change: the
      leftmost column of the board is where new work arrives. `offered` is already in their order.
      Blocked and cancelled are refused outright — whatever is at the front, an interpretation pass has no
      business declaring work stuck or dropped before anybody has looked at it.
    */
    const entry = offered.find((state) => state.semantic === 'open' || state.semantic === 'active');
    try {
      await ports.setInterpretationHints(dataset, 'TaskBlock', {
        propHints: {
          'we://status': `Exactly one of: ${list}.${
            entry ? ` Use "${entry.slug}" unless the speaker says work has begun.` : ''
          }`,
        },
      });
    } catch (error) {
      // A space whose shape predates the property, or a peer without write access. The states still
      // work; extraction just keeps using the vocabulary it already had.
      console.warn('SpaceStore: could not update the interpretation hint for task states', error);
    }
  }

  /**
   * A change to the space's states, then the two things only the host does after one: read them
   * again for what follows on this screen (the board and the interpretation hint read the list), and
   * tell interpretation which states there are. The watch would bring the same rows a moment later.
   */
  async function changeTaskState(operation: string, args: Record<string, unknown>, failure: string): Promise<void> {
    try {
      await runCore(operation, args);
    } catch (error) {
      reportOperation('change a task state', failure, error);
      return;
    }
    await loadTaskStates(true);
    await syncTaskStateHint();
  }

  /**
   * Name a state this community's work moves through — `core.createTaskState`, which derives the
   * slug and refuses one the space already has.
   *
   * The space's own board — Everything, the catch-all — gains a column for the new state in the same
   * act, so the one board whose job is to show all the work never lags the vocabulary. Boards people
   * made are left alone; theirs offer the column from Unplaced when work in the state shows up.
   */
  async function createTaskState(config: {
    name: string;
    semantic?: TaskStateView['semantic'];
    color?: string;
    icon?: string;
  }): Promise<void> {
    if (!config?.name?.trim()) return;
    let slug: string;
    try {
      ({ slug } = await runCore<{ slug: string }>('createTaskState', {
        name: config.name,
        semantic: config.semantic,
        color: config.color,
        icon: config.icon,
      }));
    } catch (error) {
      reportOperation('create a task state', 'Could not add that state', error);
      return;
    }
    await loadTaskStates(true);
    await Promise.all([syncTaskStateHint(), addStateToSpaceBoard(slug, config.name.trim())]);
  }

  /**
   * Change a state the community already has — its name, its colour, its glyph, what it counts as,
   * and what agreement moving into it asks for. `core.updateTaskState` holds the rules: the slug is
   * not in the update (it is what every task stores; renaming is what `name` is for), `semantic` is
   * (the field most likely chosen wrongly at creation, and otherwise unfixable), and an empty string
   * clears where an absent key leaves a field alone.
   *
   * Normalised here: the approvals into their range, and the evidence form's keys ("comment") into
   * requirements as the state stores them.
   */
  async function updateTaskState(
    slug: string,
    updates: {
      name?: string;
      icon?: string;
      color?: string;
      semantic?: TaskStateView['semantic'];
      approvals?: number;
      approverKind?: string;
      evidence?: { entity: string; where?: Record<string, string | number | boolean>; via?: string; min?: number }[];
    },
  ): Promise<void> {
    if (!slug || !updates) return;
    await changeTaskState(
      'updateTaskState',
      {
        slug,
        name: updates.name,
        icon: updates.icon,
        color: updates.color,
        semantic: updates.semantic,
        approverKind: updates.approverKind,
        approvals: updates.approvals === undefined ? undefined : approvalsOf({ slug, approvals: updates.approvals }),
        // None at all is stored as nothing, which is a clear.
        evidence: Array.isArray(updates.evidence)
          ? (storeTaskStateEvidence(
              updates.evidence.map((requirement) => ({ ...requirement, ...evidenceSubjectOf(requirement.entity) })),
            ) ?? '')
          : undefined,
      },
      'Could not save that change',
    );
  }

  async function addTaskStateEvidence(
    slug: string,
    requirement: { entity: string; via?: string; min?: number },
  ): Promise<void> {
    if (!slug || !requirement?.entity) return;
    // `entity` is what the requirement form picked — a key such as "comment" — or an entity name.
    const [stored] = storeTaskStateEvidence([{ ...requirement, ...evidenceSubjectOf(requirement.entity) }]) ?? [];
    if (!stored) return;
    await changeTaskState('addTaskStateEvidence', { slug, requirement: stored }, 'Could not save that change');
  }

  async function removeTaskStateEvidence(slug: string, index: number): Promise<void> {
    if (!slug || !Number.isInteger(index) || index < 0) return;
    await changeTaskState('removeTaskStateEvidence', { slug, index }, 'Could not save that change');
  }

  /**
   * Set the order this community reads its states in — what a column drag on the board writes.
   *
   * An ordered relation rather than a number on each state, which is the difference between a
   * reorder that survives two people doing it at once and one where the second write silently
   * discards the first. Takes slugs, which is what a screen holds; `core.reorderTaskStates` writes
   * the relation over the records' ids.
   */
  async function reorderTaskStates(orderedSlugs: string[]): Promise<void> {
    const space = currentSpace();
    if (!space?.id || !Array.isArray(orderedSlugs)) return;
    const ids = new Map(untrack(taskStates).map((state) => [state.slug, state.id]));
    const shown = orderedSlugs.map((slug) => ids.get(slug)).filter((id): id is string => Boolean(id));
    if (!shown.length) return;
    const before = untrack(taskStateOrder);
    // Shown before it is written, and kept until the space record's next push carries the order the
    // backend holds — this one, or a peer's concurrent one that beat it.
    setTaskStateOrder(shown);
    try {
      setTaskStateOrder(await runCore<string[]>('reorderTaskStates', { space: space.id, slugs: orderedSlugs }));
    } catch (error) {
      setTaskStateOrder(before);
      reportOperation('reorder task states', 'Could not save that order', error);
    }
  }

  /**
   * Withdraw a state from use, or bring it back — without touching the work sitting in it.
   *
   * The same decision `setSignalTypeRetired` makes, for the same reason one layer along: a task
   * names its state by slug, so deleting the state leaves every task holding a word nothing
   * defines. Retiring stops it being offered and leaves everything readable.
   */
  async function setTaskStateRetired(slug: string, retired: boolean): Promise<void> {
    if (!slug) return;
    await changeTaskState('setTaskStateRetired', { slug, retired }, 'Could not update that state');
  }

  const members: Pick<
    SpaceStore,
    | 'taskStates'
    | 'offeredTaskStates'
    | 'taskStatesLoaded'
    | 'createTaskState'
    | 'updateTaskState'
    | 'setTaskStateRetired'
    | 'reorderTaskStates'
    | 'addTaskStateEvidence'
    | 'removeTaskStateEvidence'
    | 'taskWorkflowEnabled'
    | 'archivedWorkflows'
    | 'setWorkflowArchived'
    | 'setTaskWorkflowRule'
    | 'approveTaskMove'
    | 'withdrawTaskMove'
  > = {
    taskStates,
    offeredTaskStates,
    taskStatesLoaded,
    createTaskState,
    updateTaskState,
    setTaskStateRetired,
    reorderTaskStates,
    addTaskStateEvidence,
    removeTaskStateEvidence,
    taskWorkflowEnabled,
    archivedWorkflows,
    setWorkflowArchived,
    setTaskWorkflowRule,
    approveTaskMove,
    withdrawTaskMove,
  };

  return { members, offeredTaskStates, boardWorkflow, provideSpaceBoard: spaceBoard.provide };
}

export type SpaceTaskStates = ReturnType<typeof createSpaceTaskStates>;
