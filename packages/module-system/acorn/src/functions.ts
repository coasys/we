import type { ModuleFunction } from '@we/module-shared';

/**
 * The Acorn-derived functions the template's expressions call.
 *
 * Pure and total, as the contract asks: every one answers the empty value of its kind on
 * wrong-typed input, and none reaches a store, a dataset or a clock. They are the projections
 * Acorn's wire fields need — `taskList` is JSON text, `timeFrame` a `{from,to}` document,
 * `achievementStatus` an enum — kept beside the module rather than restated in every view.
 */

interface AcornTask {
  task: string;
  complete: boolean;
}

const parseTasks = (taskList: unknown): AcornTask[] => {
  if (typeof taskList !== 'string' || !taskList) return [];
  try {
    const parsed: unknown = JSON.parse(taskList);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is { task: string; complete?: unknown } =>
          typeof t === 'object' && t !== null && typeof (t as { task?: unknown }).task === 'string',
      )
      .map((t) => ({ task: t.task, complete: t.complete === true }));
  } catch {
    return [];
  }
};

const option = (args: unknown[], key: string): unknown =>
  args[0] && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>)[key] : undefined;

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : [];

/** A relation read without `include` is the target's id; with it, the record — either way, the id. */
const refId = (value: unknown): string =>
  typeof value === 'string' ? value : value && typeof value === 'object' ? refId((value as { id?: unknown }).id) : '';

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * An outcome's children, drawn from the `AcornConnection` records — the edges Acorn itself builds
 * its tree from (`outcomesAsGraph.ts`), present on both hosts. The mount's derived
 * `AcornOutcome.children` is not read: the in-memory host does not derive it, and a child created
 * here would not show there.
 *
 * In Acorn's sibling order: the **highest** `siblingOrder` first, ties by statement — the sort its
 * map (`classicCoordinates.ts`) and its table (`OutcomeTableRow.tsx`) both apply, and why stock's
 * "new sibling goes to the far right" writes one lower than the lowest (`connections/index.ts`).
 * The id breaks what is left, so the same records always draw the same way.
 */
const childrenOf = (
  id: string,
  outcomes: Record<string, unknown>[],
  connections: Record<string, unknown>[],
): Record<string, unknown>[] => indexTree(outcomes, connections).kids(id);

/**
 * The tree, indexed once: each outcome by id, and each parent's children in Acorn's sibling order
 * (`siblingOrder` descending, then statement, then id — see `childrenOf`). Every connection is read once here, so a projection that
 * walks the whole tree costs what the tree has, not what it has squared.
 */
const indexTree = (outcomes: Record<string, unknown>[], connections: Record<string, unknown>[]) => {
  const byId = new Map(outcomes.map((o) => [refId(o.id), o]));
  const edges = new Map<string, Array<{ c: Record<string, unknown>; child: Record<string, unknown> }>>();
  for (const c of connections) {
    const child = byId.get(refId(c.child));
    if (!child) continue;
    const parent = refId(c.parent);
    const list = edges.get(parent) ?? [];
    list.push({ c, child });
    edges.set(parent, list);
  }
  const kids = new Map<string, Record<string, unknown>[]>();
  for (const [parent, list] of edges) {
    list.sort(
      (x, y) =>
        num(y.c.siblingOrder) - num(x.c.siblingOrder) ||
        text(x.child.content).localeCompare(text(y.child.content)) ||
        refId(x.child.id).localeCompare(refId(y.child.id)),
    );
    kids.set(
      parent,
      list.map((e) => e.child),
    );
  }
  return { byId, kids: (id: string) => kids.get(id) ?? [], parents: new Set(edges.keys()) };
};
type TreeIndex = ReturnType<typeof indexTree>;

/**
 * The siblingOrder a new child of `parent` is written with: one below the lowest of its siblings,
 * so it is drawn on the right (Acorn draws the highest leftmost), or 0 when it has none. This is
 * stock's `lowerThanLowestSiblingOrder` (`connections/index.ts`), which its map uses for a new
 * child; its expanded view writes 0 always, which equals this only when there are no siblings.
 */
const nextSiblingOrder = (parent: string, connections: Record<string, unknown>[]): number => {
  const orders = connections.filter((c) => refId(c.parent) === parent).map((c) => num(c.siblingOrder));
  return orders.length ? Math.min(...orders) - 1 : 0;
};

export interface AcornRollup {
  /** 'Small' | 'Uncertain' | 'Big' — Acorn's computed scope. */
  scope: string;
  /** 'Achieved' | 'PartiallyAchieved' | 'NotAchieved' — Acorn's computed simple status. */
  status: string;
  uncertains: number;
  smallsAchieved: number;
  smallsTotal: number;
  tasksAchieved: number;
  tasksTotal: number;
  children: number;
}

/**
 * Acorn's roll-up, ported as it stands in `computedState.ts` (`computeAchievementStatus`,
 * `computeScope`): with children, an outcome counts its descendants' uncertains and smalls;
 * without, its own scope. Tasks are its own. Each outcome's roll-up is
 * computed once, children first; a connection back to an outcome still being computed (a cycle)
 * is cut there, so a cyclic tree still answers, as if that edge were absent.
 */
const rollups = (tree: TreeIndex): ((id: string) => AcornRollup) => {
  const done = new Map<string, AcornRollup>();
  const open = new Set<string>();
  const finish = (id: string): AcornRollup => {
    const outcome = tree.byId.get(id) ?? {};
    const children = tree
      .kids(id)
      .map((c) => done.get(refId(c.id)))
      .filter((r): r is AcornRollup => !!r);
    const small = outcome.scopeType === 'Small';
    const achievedSelf = small && outcome.achievementStatus === 'Achieved';
    const has = children.length > 0;
    const total = (key: 'uncertains' | 'smallsAchieved' | 'smallsTotal') => children.reduce((m, c) => m + c[key], 0);
    const uncertains = has ? total('uncertains') : outcome.scopeType === 'Uncertain' ? 1 : 0;
    const smallsAchieved = has ? total('smallsAchieved') : achievedSelf ? 1 : 0;
    const smallsTotal = has ? total('smallsTotal') : small ? 1 : 0;
    const tasks = small ? parseTasks(outcome.taskList) : [];
    const tasksAchieved = tasks.filter((t) => t.complete).length;
    const tasksTotal = tasks.length;

    const partly =
      uncertains === 0 &&
      ((smallsTotal > 0 && smallsAchieved > 0 && smallsAchieved < smallsTotal) ||
        (tasksTotal > 0 && tasksAchieved > 0 && tasksAchieved < tasksTotal));
    const none =
      !(uncertains === 0 && smallsTotal === 0 && achievedSelf) &&
      (uncertains > 0 || (smallsTotal > 0 && smallsAchieved === 0) || (tasksTotal > 0 && tasksAchieved === 0));
    const status = partly ? 'PartiallyAchieved' : none ? 'NotAchieved' : 'Achieved';

    const scope = !has
      ? small
        ? 'Small'
        : 'Uncertain'
      : children.some((c) => c.scope === 'Uncertain')
        ? 'Uncertain'
        : 'Big';
    return {
      scope,
      status,
      uncertains,
      smallsAchieved,
      smallsTotal,
      tasksAchieved,
      tasksTotal,
      children: children.length,
    };
  };
  // Post-order without recursion, so a deep chain cannot overflow the stack.
  return (root: string) => {
    const stack = [root];
    while (stack.length) {
      const id = stack[stack.length - 1];
      if (done.has(id)) {
        stack.pop();
      } else if (open.has(id)) {
        done.set(id, finish(id));
        open.delete(id);
        stack.pop();
      } else {
        open.add(id);
        for (const c of tree.kids(id)) {
          const k = refId(c.id);
          if (!done.has(k) && !open.has(k)) stack.push(k);
        }
      }
    }
    return done.get(root)!;
  };
};

/** One outcome's roll-up — the outcome as given, over the tree its records make. */
const rollup = (
  outcome: Record<string, unknown>,
  outcomes: Record<string, unknown>[],
  connections: Record<string, unknown>[],
): AcornRollup => {
  const id = refId(outcome.id);
  const tree = indexTree(outcomes, connections);
  tree.byId.set(id, outcome);
  return rollups(tree)(id);
};

/** Acorn's "ID#" — `hashCodeId` (acorn-ad4m-ui `api/clientSideIdHash.ts`) of the action hash. */
const outcomeNumber = (id: string): string => {
  const at = id.lastIndexOf('://');
  const hash = at < 0 ? id : id.slice(at + 3);
  let h = 0;
  for (let i = 0; i < hash.length; i++) {
    h = (h << 5) - h + hash.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString().slice(0, 6);
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(refId).filter(Boolean) : []);

/**
 * The outcome table's rows, as Acorn's `OutcomeTable` draws them: every root outcome (one no
 * connection names as a child), then each rootless cycle from its first outcome, and their
 * descendants depth-first in sibling order, each row a level deeper than its parent. Unfiltered, a row is drawn while every ancestor is open; filtered, every
 * outcome that matches is drawn at its own depth, as Acorn's `filterMatch` does — keyword or ID
 * number, high priority, computed status, computed scope and tags, each list an OR, all ANDed.
 */
const tableRows = (options: Record<string, unknown>) => {
  const outcomes = list(options.outcomes);
  const connections = list(options.connections);
  const tags = list(options.tags);
  const priorities = new Set(strings(options.priorities));
  const collapsed = new Set(strings(options.collapsed));
  const filter = (options.filter && typeof options.filter === 'object' ? options.filter : {}) as Record<
    string,
    unknown
  >;
  const keyword = typeof filter.keyword === 'string' ? filter.keyword.trim().toLowerCase() : '';
  const statuses = strings(filter.statuses);
  const scopes = strings(filter.scopes);
  const tagFilter = strings(filter.tags);
  const filtering =
    !!keyword || filter.highPriority === true || !!statuses.length || !!scopes.length || !!tagFilter.length;

  const tree = indexTree(outcomes, connections);
  const rollupOf = rollups(tree);
  const childIds = new Set<string>();
  for (const parent of tree.parents)
    if (tree.byId.has(parent)) for (const c of tree.kids(parent)) childIds.add(refId(c.id));
  // Each outcome's parents, in the order the outcomes are listed — for climbing out of a rootless tail.
  const parentsOf = new Map<string, string[]>();
  for (const o of outcomes) {
    const parent = refId(o.id);
    for (const c of tree.kids(parent)) {
      const child = refId(c.id);
      const parents = parentsOf.get(child);
      if (parents) parents.push(parent);
      else parentsOf.set(child, [parent]);
    }
  }
  const tagsById = new Map(tags.map((t) => [refId(t.id), t]));
  const rows: Record<string, unknown>[] = [];

  /*
    Depth-first in sibling order, without recursion. An outcome under two parents is drawn under
    each; one that is its own ancestor (a cycle) is not drawn again below itself. Unfiltered, a
    folded row's subtree is not walked at all — nothing in it is drawn. A walk from a rootless
    cycle (`owner`, below) draws only the outcomes it reached first, so nothing an earlier walk
    reached is drawn twice.
  */
  const walk = (root: Record<string, unknown>, owner?: string) => {
    const path = new Set<string>();
    const stack: Array<{ outcome: Record<string, unknown>; depth: number; shown: boolean } | { leave: string }> = [
      { outcome: root, depth: 0, shown: true },
    ];
    while (stack.length) {
      const frame = stack.pop()!;
      if ('leave' in frame) {
        path.delete(frame.leave);
        continue;
      }
      const { outcome, depth, shown } = frame;
      const id = refId(outcome.id);
      if (path.has(id) || (owner !== undefined && reachedBy.get(id) !== owner)) continue;
      const r = rollupOf(id);
      const number = outcomeNumber(id);
      const outcomeTags = strings(outcome.tags);
      const matches =
        (!keyword ||
          (typeof outcome.content === 'string' ? outcome.content : '').toLowerCase().includes(keyword) ||
          number.includes(keyword)) &&
        (filter.highPriority !== true || priorities.has(id)) &&
        (!statuses.length || statuses.includes(r.status)) &&
        (!scopes.length || scopes.includes(r.scope)) &&
        (!tagFilter.length || tagFilter.some((t) => outcomeTags.includes(t)));
      const open = !collapsed.has(id);
      if (filtering ? matches : shown) {
        const progress =
          r.scope === 'Big'
            ? Math.round((r.smallsAchieved / (r.smallsTotal || 1)) * 100)
            : r.scope === 'Small' && r.tasksTotal > 0
              ? Math.round((r.tasksAchieved / r.tasksTotal) * 100)
              : r.scope === 'Small' && r.status === 'Achieved'
                ? 100
                : 0;
        rows.push({
          id,
          outcome,
          depth,
          number,
          scope: r.scope,
          status: r.status,
          progress: r.scope === 'Uncertain' ? '' : `${progress}%`,
          children: r.children,
          open,
          priority: priorities.has(id),
          tags: outcomeTags.map((t) => tagsById.get(t)).filter(Boolean),
        });
      }
      if (!filtering && !(shown && open)) continue;
      path.add(id);
      stack.push({ leave: id });
      const kids = tree.kids(id);
      for (let i = kids.length - 1; i >= 0; i--)
        stack.push({ outcome: kids[i], depth: depth + 1, shown: shown && open });
    }
  };
  /*
    Every outcome is under some walk, and each is owned by the first walk that reaches it. The
    roots go first. An outcome no root reaches is in a cycle with no way in (A → B → A), or below
    one: from the first such outcome in list order, its parents are climbed until they close a
    cycle, and the walk starts from that cycle's first outcome in list order — so a tail is drawn
    under its parent, and folds with it, wherever it sits in the list. That walk draws only what it
    owns: an outcome another walk reached first is not drawn again.
  */
  const reachedBy = new Map<string, string>();
  const reach = (id: string, owner: string) => {
    const queue = [id];
    while (queue.length) {
      const next = queue.pop()!;
      if (reachedBy.has(next)) continue;
      reachedBy.set(next, owner);
      for (const c of tree.kids(next)) queue.push(refId(c.id));
    }
  };
  const listed = new Map(outcomes.map((o, i) => [refId(o.id), i]));
  const cycleAbove = (id: string) => {
    const climbed = new Map<string, number>();
    let at: string | undefined = id;
    while (at !== undefined && !climbed.has(at)) {
      climbed.set(at, climbed.size);
      // Unreached, so every parent is unreached too; it has one, or it would be a root.
      at = parentsOf.get(at)?.[0];
    }
    const cycle = at === undefined ? [id] : [...climbed.keys()].slice(climbed.get(at));
    return cycle.reduce((a, b) => ((listed.get(b) ?? 0) < (listed.get(a) ?? 0) ? b : a));
  };
  const roots = outcomes.filter((o) => !childIds.has(refId(o.id)));
  for (const root of roots) reach(refId(root.id), '');
  for (const root of roots) walk(root);
  for (const o of outcomes) {
    if (reachedBy.has(refId(o.id))) continue;
    const start = cycleAbove(refId(o.id));
    reach(start, start);
    walk(tree.byId.get(start)!, start);
  }
  return rows;
};

const STATUS_LABEL: Record<string, string> = {
  Achieved: 'Achieved',
  PartiallyAchieved: 'Partially achieved',
  NotAchieved: 'Not achieved',
};

/**
 * The one parent each card is drawn under, exactly as `@we/graph-layouts` `forest` chooses it
 * (`shapeOf` in `forest.ts`): breadth-first from the roots — cards on a line with no line into
 * them — roots and each card's children walked in id order, a card taking the first parent that
 * reaches it; a loop with no root opened at its lowest id. Restated here because a module imports
 * nothing but the module contract (`portability.test.ts`). `mapLayout.test.ts` lays the projection
 * out with the real layout and checks that every parent's own children are drawn in its order, so
 * the two cannot drift apart unnoticed.
 */
const forestParents = (links: ReadonlyArray<{ source: string; target: string }>): Map<string, string> => {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const { source, target } of links) {
    (childrenOf.get(source) ?? childrenOf.set(source, []).get(source)!).push(target);
    hasParent.add(target);
  }
  const onSpine = new Set<string>([...childrenOf.keys(), ...hasParent]);
  const placed = new Set<string>();
  const parent = new Map<string, string>();
  const walk = (roots: string[]) => {
    const queue = [...roots];
    for (const root of roots) placed.add(root);
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head];
      for (const child of [...(childrenOf.get(id) ?? [])].sort()) {
        if (placed.has(child)) continue;
        placed.add(child);
        parent.set(child, id);
        queue.push(child);
      }
    }
  };
  walk([...onSpine].filter((id) => !hasParent.has(id)).sort());
  for (const id of [...onSpine].sort()) if (!placed.has(id)) walk([id]);
  return parent;
};

/**
 * The map's graph, as a `GraphView` literal seed — one node per outcome, one edge per connection.
 *
 * A **projection**, not a seed the graph reads itself, for two reasons the stock wire forces. A
 * connection's ends are untyped refs on the mount (`AcornConnection.parent`/`child` are `kind: ref`
 * with no class), so there is no relation a `query` seed could hydrate; and what Acorn draws on a
 * card — the computed scope and status — is the roll-up, which only these functions know.
 *
 * Sibling order lives on the connection, and the `forest` layout orders siblings by a field on the
 * *card*. So each node carries `rank`: its place in a depth-first walk of the tree forest draws —
 * each card under the one parent forest places it under (`forestParents`), those children in that
 * parent's Acorn order (`indexTree`). A child of two parents is drawn once, under one of them, so its
 * rank only has to be right there; ranking it by whichever parent a walk reached first could reverse
 * the siblings of the parent that actually draws it. Roots — isolated outcomes among them — keep the
 * order the outcomes arrived in, and the card forest opens a rootless loop at comes after them.
 *
 * The card's values sit under the stored names (`scopeType`, `achievementStatus`) because those are
 * the fields `content: 'record'` lists, but they hold the **computed** scope and status, which is
 * what Acorn draws; `status` keeps the computed code for style rules.
 */
const mapGraph = (options: Record<string, unknown>) => {
  const outcomes = list(options.outcomes).filter((o) => refId(o.id));
  const connections = list(options.connections);
  const ids = new Set(outcomes.map((o) => refId(o.id)));
  const tree = indexTree(outcomes, connections);
  const rollupOf = rollups(tree);
  const seen = new Set<string>();
  const edges = connections.flatMap((c) => {
    const source = refId(c.parent);
    const target = refId(c.child);
    const id = refId(c.id) || `${source}>${target}`;
    if (!ids.has(source) || !ids.has(target) || source === target || seen.has(id)) return [];
    seen.add(id);
    return [{ id, source, target, type: 'AcornConnection', data: { siblingOrder: num(c.siblingOrder) } }];
  });

  // Rank in a pre-order walk of the tree forest draws: each card under the parent forest places
  // it under, those children in that parent's order. Genuine roots first, then the cards forest
  // opens a loop at, each group in the order the outcomes arrived. Without recursion, children
  // pushed last-first so the first sibling is ranked first.
  const owner = forestParents(edges);
  const rank = new Map<string, number>();
  const visit = (root: string) => {
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (rank.has(id)) continue;
      rank.set(id, rank.size);
      const kids = tree
        .kids(id)
        .map((k) => refId(k.id))
        .filter((k) => owner.get(k) === id);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  };
  const unowned = outcomes.map((o) => refId(o.id)).filter((id) => !owner.has(id));
  const targets = new Set(edges.map((e) => e.target));
  for (const id of unowned) if (!targets.has(id)) visit(id);
  for (const id of unowned) visit(id);

  const nodes = outcomes.map((outcome) => {
    const id = refId(outcome.id);
    const r = rollupOf(id);
    const content = text(outcome.content);
    return {
      id,
      kind: 'entity',
      type: 'AcornOutcome',
      label: content,
      data: {
        content,
        scopeType: r.scope,
        achievementStatus: STATUS_LABEL[r.status] ?? r.status,
        status: r.status,
        rank: rank.get(id) ?? 0,
      },
    };
  });
  return { literal: true, nodes, edges };
};

/**
 * A whole-field value in one canonical text, so a read-back compares equal to what was written:
 * JSON text is parsed first (the mount hands a task list back with its keys in another order),
 * object keys are sorted, and an absent value is the empty list the field means.
 */
const canonical = (value: unknown): string => {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return JSON.stringify(v);
    }
  }
  if (v === undefined || v === null || v === '') v = [];
  const sorted = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sorted)
      : x && typeof x === 'object'
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, sorted((x as Record<string, unknown>)[k])]),
          )
        : x;
  return JSON.stringify(sorted(v));
};

/*
  A view's write history: canonical snapshots of the values its edits replaced and wrote, the last
  being the value it wrote last — text, so a subscription that reconciles its arrays in place cannot
  change what was recorded. A template has no effect to clear its own state when the subscription
  catches up, so the settling is recorded here, against the history list itself: once the stored
  value is the one written last (it read back) or one this view never saw (somebody else's write,
  adopted), that list suppresses nothing again — a value it holds that is stored later is a new
  write, and is drawn. Keyed by identity: each edit writes a new list into local state, and starts
  it afresh once the one before has settled (`acornWritten`).
*/
const settled = new WeakSet<object>();
const pendingHistory = (stored: unknown, written: unknown): string[] => {
  if (!Array.isArray(written) || !written.length || settled.has(written)) return [];
  const history = written.map(canonical);
  const seen = canonical(stored);
  if (history[history.length - 1] === seen || !history.includes(seen)) {
    settled.add(written);
    return [];
  }
  return history;
};

/** The task list with one change, as the JSON text the record holds — what `record.update` writes. */
const tasksText = (tasks: AcornTask[]): string => JSON.stringify(tasks);

/** `did:key:z6MkabcdEFGH…wxyz` → `z6Mk…wxyz` — enough to tell two authors apart. */
const shortDid = (did: string): string => {
  const tail = did.slice(did.lastIndexOf(':') + 1);
  return tail.length > 10 ? `${tail.slice(0, 4)}…${tail.slice(-4)}` : tail;
};

export const ACORN_FUNCTIONS: ModuleFunction[] = [
  {
    name: 'acornTasks',
    params: ['taskList'],
    doc: "An outcome's task list, parsed from its JSON field into `{ task, complete }` rows.",
    example: 'acornTasks({ taskList: outcome.taskList })',
    fn: (...args: never[]) => parseTasks(option(args, 'taskList')),
  },
  {
    name: 'acornTaskProgress',
    params: ['taskList'],
    doc: "How far an outcome's task list is — '2/3', or '' when it has none.",
    example: 'acornTaskProgress({ taskList: outcome.taskList })',
    fn: (...args: never[]) => {
      const tasks = parseTasks(option(args, 'taskList'));
      if (!tasks.length) return '';
      return `${tasks.filter((t) => t.complete).length}/${tasks.length}`;
    },
  },
  {
    name: 'acornStatusLabel',
    params: ['status'],
    doc: "An outcome's achievement status as a person reads it — 'Achieved', 'Not achieved'.",
    example: 'acornStatusLabel({ status: outcome.achievementStatus })',
    fn: (...args: never[]) => {
      const status = option(args, 'status');
      if (status === 'Achieved') return 'Achieved';
      if (status === 'NotAchieved') return 'Not achieved';
      return '';
    },
  },
  {
    name: 'acornScopeLabel',
    params: ['scope'],
    doc: "An outcome's scope — 'Big', 'Small', 'Uncertain' — as a label.",
    example: 'acornScopeLabel({ scope: outcome.scopeType })',
    fn: (...args: never[]) => {
      const scope = option(args, 'scope');
      return scope === 'Big' || scope === 'Small' || scope === 'Uncertain' ? scope : '';
    },
  },
  {
    name: 'acornTimeFrameLabel',
    params: ['timeFrame'],
    doc: "An outcome's time frame as a date range, or '' when unset.",
    example: 'acornTimeFrameLabel({ timeFrame: outcome.timeFrame })',
    fn: (...args: never[]) => {
      const raw = option(args, 'timeFrame');
      if (typeof raw !== 'string' || !raw) return '';
      try {
        const frame = JSON.parse(raw) as { fromDate?: unknown; toDate?: unknown };
        const fmt = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '');
        const [from, to] = [fmt(frame.fromDate), fmt(frame.toDate)];
        return from || to ? `${from || '?'} – ${to || '?'}` : '';
      } catch {
        return '';
      }
    },
  },
  {
    name: 'acornOutcomeSummary',
    params: ['outcome'],
    doc: 'One line on an outcome — status, task progress and scope, joined where present.',
    example: 'acornOutcomeSummary({ outcome: outcome })',
    fn: (...args: never[]) => {
      const outcome = option(args, 'outcome') as Record<string, unknown> | undefined;
      if (!outcome) return '';
      const status =
        outcome.achievementStatus === 'Achieved'
          ? 'Achieved'
          : outcome.achievementStatus === 'NotAchieved'
            ? 'Not achieved'
            : '';
      const tasks = parseTasks(outcome.taskList);
      const progress = tasks.length ? `${tasks.filter((t) => t.complete).length}/${tasks.length}` : '';
      const scope = ['Big', 'Small', 'Uncertain'].includes(outcome.scopeType as string)
        ? (outcome.scopeType as string)
        : '';
      return [status, progress, scope].filter(Boolean).join(' · ');
    },
  },
  {
    name: 'acornTasksAdded',
    params: ['taskList', 'task'],
    doc: 'The task list with one more, not yet done, task at its end — as the JSON text `taskList` holds.',
    example: 'acornTasksAdded({ taskList: outcome.taskList, task: local.newTask })',
    fn: (...args: never[]) => {
      const task = option(args, 'task');
      const tasks = parseTasks(option(args, 'taskList'));
      return tasksText(
        typeof task === 'string' && task.trim() ? [...tasks, { task: task.trim(), complete: false }] : tasks,
      );
    },
  },
  {
    name: 'acornTasksToggled',
    params: ['taskList', 'index'],
    doc: 'The task list with the task at `index` marked done, or not done again — as JSON text.',
    example: 'acornTasksToggled({ taskList: outcome.taskList, index: index })',
    fn: (...args: never[]) => {
      const index = option(args, 'index');
      return tasksText(
        parseTasks(option(args, 'taskList')).map((t, i) => (i === index ? { ...t, complete: !t.complete } : t)),
      );
    },
  },
  {
    name: 'acornTasksRemoved',
    params: ['taskList', 'index'],
    doc: 'The task list without the task at `index` — as JSON text.',
    example: 'acornTasksRemoved({ taskList: outcome.taskList, index: index })',
    fn: (...args: never[]) => {
      const index = option(args, 'index');
      return tasksText(parseTasks(option(args, 'taskList')).filter((_, i) => i !== index));
    },
  },
  {
    name: 'acornChildren',
    params: ['outcome', 'outcomes', 'connections'],
    doc: "An outcome's child outcomes, in sibling order — joined through the AcornConnection records.",
    example: 'acornChildren({ outcome: outcome.id, outcomes: local.outcomes, connections: local.connections })',
    fn: (...args: never[]) =>
      childrenOf(refId(option(args, 'outcome')), list(option(args, 'outcomes')), list(option(args, 'connections'))),
  },
  {
    name: 'acornNextSiblingOrder',
    params: ['parent', 'connections'],
    doc: "The siblingOrder a new child of `parent` is written with — one below its lowest sibling's, so Acorn draws it on the right; 0 when it has none.",
    example: 'acornNextSiblingOrder({ parent: outcome.id, connections: local.connections })',
    fn: (...args: never[]) => nextSiblingOrder(refId(option(args, 'parent')), list(option(args, 'connections'))),
  },
  {
    name: 'acornRollup',
    params: ['outcome', 'outcomes', 'connections'],
    doc: "Acorn's computed scope and status for an outcome from its descendants — { scope, status, uncertains, smallsAchieved, smallsTotal, tasksAchieved, tasksTotal, children }.",
    example: 'acornRollup({ outcome: outcome, outcomes: local.outcomes, connections: local.connections }).status',
    fn: (...args: never[]) => {
      const outcome = option(args, 'outcome');
      const outcomes = list(option(args, 'outcomes'));
      const connections = list(option(args, 'connections'));
      if (!outcome || typeof outcome !== 'object') return rollup({}, [], []);
      return rollup(outcome as Record<string, unknown>, outcomes, connections);
    },
  },
  {
    name: 'acornRollupLabel',
    params: ['rollup'],
    doc: "A roll-up as a person reads it — 'Partially achieved · 1/2 smalls · 1 uncertain'.",
    example:
      'acornRollupLabel({ rollup: acornRollup({ outcome: outcome, outcomes: local.outcomes, connections: local.connections }) })',
    fn: (...args: never[]) => {
      const r = option(args, 'rollup') as Partial<AcornRollup> | undefined;
      if (!r || typeof r !== 'object') return '';
      const status =
        r.status === 'Achieved' ? 'Achieved' : r.status === 'PartiallyAchieved' ? 'Partially achieved' : 'Not achieved';
      const parts = [status];
      if (num(r.smallsTotal) > 0) parts.push(`${num(r.smallsAchieved)}/${num(r.smallsTotal)} smalls`);
      if (num(r.uncertains) > 0) parts.push(`${num(r.uncertains)} uncertain`);
      if (num(r.tasksTotal) > 0) parts.push(`${num(r.tasksAchieved)}/${num(r.tasksTotal)} tasks`);
      return parts.join(' · ');
    },
  },
  {
    name: 'acornAuthor',
    params: ['did', 'profiles'],
    doc: "Who an agent DID is in the project — the AcornProfile's name, or the DID's short form when no profile names it.",
    example: 'acornAuthor({ did: comment.creator, profiles: local.profiles })',
    fn: (...args: never[]) => {
      const did = refId(option(args, 'did'));
      if (!did) return 'Unknown';
      const profile = list(option(args, 'profiles')).find((p) => refId(p.agent) === did);
      const name = profile
        ? [profile.firstName, profile.lastName].filter((n) => typeof n === 'string' && n).join(' ') ||
          (typeof profile.handle === 'string' ? profile.handle : '')
        : '';
      return name || shortDid(did);
    },
  },
  {
    name: 'acornWhen',
    params: ['timestamp'],
    doc: "An Acorn timestamp — unix seconds, or milliseconds — as 'YYYY-MM-DD HH:mm' (UTC), or '' when unset.",
    example: 'acornWhen({ timestamp: comment.unixTimestamp })',
    fn: (...args: never[]) => {
      const t = num(option(args, 'timestamp'));
      if (t <= 0) return '';
      return new Date(t < 1e12 ? t * 1000 : t).toISOString().slice(0, 16).replace('T', ' ');
    },
  },
  {
    name: 'acornTableRows',
    params: ['outcomes', 'connections', 'tags', 'priorities', 'collapsed', 'filter'],
    doc: "The outcome table's rows — the tree depth-first, each { id, outcome, depth, number, scope, status, progress, children, open, priority, tags }; `filter` is { keyword, highPriority, statuses, scopes, tags }, and a filtered table draws every match at its depth, as Acorn's does.",
    example:
      'acornTableRows({ outcomes: local.outcomes, connections: local.connections, tags: local.tags, priorities: first(local.meta).topPriorityOutcomes, collapsed: local.collapsed, filter: { keyword: local.keyword } })',
    fn: (...args: never[]) => tableRows(args[0] && typeof args[0] === 'object' ? args[0] : {}),
  },
  {
    name: 'acornMapGraph',
    params: ['outcomes', 'connections'],
    doc: "The outcome map as a GraphView literal seed — { literal: true, nodes, edges }: a node per outcome (id the outcome's, type AcornOutcome, label its statement, data { content, scopeType and achievementStatus as Acorn computes them, status the computed code, rank its place in the tree a forest layout draws, each card under the parent forest places it under, for its sortBy }) and an edge per connection between two drawn outcomes.",
    example: 'acornMapGraph({ outcomes: local.outcomes, connections: local.connections })',
    fn: (...args: never[]) => mapGraph(args[0] && typeof args[0] === 'object' ? args[0] : {}),
  },
  {
    name: 'acornWorking',
    params: ['stored', 'working', 'written'],
    doc: 'The whole-field value the next edit starts from. `stored` is the value as subscribed, `working` the last one this view wrote, `written` its history (acornWritten). While that write is unsettled — the stored value is one it replaced on the way — the working value stands, so an edit builds on the one before it. Once the stored value is the one written, or one this view never saw, the history is settled for good and the stored value is the truth again, so a later change elsewhere back to an earlier value is drawn.',
    example: 'acornWorking({ stored: outcome.taskList, working: local.taskWork, written: local.taskWritten })',
    fn: (...args: never[]) => {
      const stored = option(args, 'stored');
      const working = option(args, 'working');
      const written = option(args, 'written');
      if (pendingHistory(stored, written).length) return working;
      // Read back: the two are the same value, and the one this view holds keeps its form.
      return Array.isArray(written) && written.length && canonical(working) === canonical(stored) ? working : stored;
    },
  },
  {
    name: 'acornWritten',
    params: ['stored', 'working', 'written'],
    doc: 'The history after a whole-field edit: what is still unsettled of `written` (the history before it — nothing, once the last write read back or was overtaken), then the stored value the edit replaces and `working`, the value it writes. Recorded as canonical text, for acornWorking to compare against.',
    example: 'acornWritten({ stored: meta.topPriorityOutcomes, working: local.prioWork, written: local.prioWritten })',
    fn: (...args: never[]) => {
      const stored = option(args, 'stored');
      return [
        ...new Set([
          ...pendingHistory(stored, option(args, 'written')),
          canonical(stored),
          canonical(option(args, 'working')),
        ]),
      ];
    },
  },
  {
    name: 'acornPriorityOrder',
    params: ['stored', 'visible'],
    doc: "The project's priority ids after a reorder of the drawn ones. `stored` is the list as kept, `visible` the drawn ids in their new order; each place a drawn id held takes the next of `visible`, and an id that is not drawn — its outcome not loaded, or gone — keeps its place. No stored id is dropped, and each is kept once.",
    example: 'acornPriorityOrder({ stored: meta.topPriorityOutcomes, visible: event.detail })',
    fn: (...args: never[]) => {
      const ids = (value: unknown): string[] =>
        Array.isArray(value)
          ? [
              ...new Set(
                value
                  .map((v: unknown) => (typeof v === 'string' ? v : (v as { id?: unknown } | null)?.id))
                  .filter((v): v is string => typeof v === 'string' && v !== ''),
              ),
            ]
          : [];
      const stored = ids(option(args, 'stored'));
      const visible = ids(option(args, 'visible'));
      const drawn = new Set(visible.filter((id) => stored.includes(id)));
      const moved = visible.filter((id) => drawn.has(id));
      const merged = stored.map((id) => (drawn.has(id) ? moved.shift()! : id));
      // An id the sortable reports that the list never held is added at the end rather than lost.
      return [...merged, ...visible.filter((id) => !stored.includes(id))];
    },
  },
];
