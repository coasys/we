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

/**
 * An outcome's children, drawn from the `AcornConnection` records — the edges Acorn itself builds
 * its tree from (`outcomesAsGraph.ts`), present on both hosts. The mount's derived
 * `AcornOutcome.children` is not read: the in-memory host does not derive it, and a child created
 * here would not show there.
 */
const childrenOf = (
  id: string,
  outcomes: Record<string, unknown>[],
  connections: Record<string, unknown>[],
): Record<string, unknown>[] => {
  const byId = new Map(outcomes.map((o) => [refId(o.id), o]));
  return connections
    .filter((c) => refId(c.parent) === id)
    .map((c) => ({ c, child: byId.get(refId(c.child)) }))
    .filter((e): e is { c: Record<string, unknown>; child: Record<string, unknown> } => !!e.child)
    .sort((a, b) => num(a.c.siblingOrder) - num(b.c.siblingOrder) || num(a.c.randomizer) - num(b.c.randomizer))
    .map((e) => e.child);
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
 * without, its own scope. Tasks are its own. A cycle in the connections stops at the repeat.
 */
const rollup = (
  outcome: Record<string, unknown>,
  outcomes: Record<string, unknown>[],
  connections: Record<string, unknown>[],
  seen: Set<string> = new Set(),
): AcornRollup => {
  const id = refId(outcome.id);
  const inner = new Set(seen).add(id);
  const children = childrenOf(id, outcomes, connections)
    .filter((c) => !inner.has(refId(c.id)))
    .map((c) => rollup(c, outcomes, connections, inner));
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
];
