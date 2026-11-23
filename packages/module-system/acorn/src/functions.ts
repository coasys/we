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
];
