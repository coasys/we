/**
 * Expression vector inputs: `{ id, source, env? }` — the env names a shared environment in
 * `EXPRESSION_ENVS` (values are written already encoded: `{"$namespace": …}`, `{"$undefined": true}`).
 * The recorder parses `source`, evaluates it against that environment and stores `result` plus the
 * printer's `print` — so a vector pins both halves of the pipeline: parse-and-evaluate, and
 * parse-print-parse.
 *
 * The corpus is three things:
 * 1. every expression and expectation from `expressions.test.ts` (ported, ids `expr.*`);
 * 2. systematic coverage of every operator kind — including `/` and `%`, which the bundle never
 *    uses but the grammar has;
 * 3. the real bundle corpus in `bundleExpressions.ts` (ids `bundle.*`), evaluated against the
 *    `stock` environment — a small stand-in for the stores they name, so member reads land on data
 *    rather than `undefined`.
 */
import type { ExpressionEnvSpec } from '../evalEnv';
import { BUNDLE_EXPRESSIONS } from './bundleExpressions';

export interface ExpressionCase {
  id: string;
  /** The expression exactly as a template prop would write it. */
  source: string;
  /** A name into `EXPRESSION_ENVS`; absent means no bound roots. */
  env?: string;
}

/**
 * Shared environments, addressable by name so 250 cases do not each carry a copy. A spec decodes
 * to the `stores` bag and `context` `buildEnvironment` sees in the renderer — so stores are plain
 * data (the tagging rule reads their members), `local` entries become `context.$local` accessors,
 * and `event`/`arg`/`result` stay plain data for `callbackValue` to wrap.
 */
export const EXPRESSION_ENVS: Record<string, ExpressionEnvSpec> = {
  /** The stores and row bindings the bundle corpus names, as one fixed fixture. */
  stock: {
    stores: {
      spaceStore: {
        members: [
          { id: 'did:a', role: 'admin', name: 'Ada' },
          { id: 'did:b', role: 'member', name: 'Bram' },
        ],
        policy: 'member',
        root: 'space://root',
        taskStates: [{ id: 'st:1', name: 'Open' }],
        mutedDids: [],
        offeredInvolvementTypes: [{ id: 'it:1', semantic: 'assignee' }],
        currentSpace: { id: 'sp:1', name: 'Coasys' },
      },
      recordStore: {
        creatableEntities: [
          {
            value: 'NoteBlock',
            label: 'Note',
            via: 'composer',
            group: 'This space',
            description: 'a note',
            icon: 'note',
          },
          { value: 'TaskBlock', label: 'Task', via: 'space', group: 'This space', description: 'a task', icon: 'task' },
        ],
        displays: { TaskBlock: { title: 'name', label: 'Task', icon: 'task' } },
      },
      routeStore: {
        params: { view: 'canvas', id: 'we://a-call', cardType: 'SignalType', card: 'sig:1', channel: 'ch:1' },
        templateSegments: ['channels'],
      },
      workflowStore: {
        startable: [{ name: 'review', label: 'Review', entities: ['TaskBlock'] }],
        recordWorkflows: { 'row:1': [{ workflow: 'review' }] },
        open: { $undefined: true },
      },
      modules: {
        transcribe: {
          changedIds: ['row:1'],
          pendingProposals: [{ id: 'row:1', fields: [{ name: 'text', value: 'x' }] }],
        },
      },
      datasetStore: { currentDatasetCid: 'we://ds' },
      $me: { did: 'did:me' },
    },
    local: {
      search: 'ta',
      typeSearch: '',
      changesOpen: false,
      link: [{ source: 'we://s', sourceType: 'TaskBlock', target: 'we://t', targetType: 'TextBlock' }],
      voices: 'did:a=50',
      monthOffset: 2,
    },
    context: {
      arg: { detail: { key: 'Enter' }, value: 'x', id: 'r:1', kind: 'assignee' },
      event: { detail: 'e:1' },
      item: { role: 'admin', id: 'we://another', n: 2, ok: false },
      row: { id: 'row:1', name: 'Row', signals: [] },
      post: { title: 'Hello', done: false, count: 3, tags: ['a'] },
      sig: { id: 'sig:1', aggregate: 'sum' },
      voice: { did: 'did:a', weight: 50 },
      items: [
        { n: 1, ok: true },
        { n: 2, ok: false },
      ],
      rows: [{ kids: [1, 2] }, { kids: [] }, { kids: [3] }],
      x: 'outer',
      nothing: { $undefined: true },
      missing: { $undefined: true },
      list: ['a', 'x', 'b'],
    },
  },
  /**
   * Every root rule, exercised while a callback context is present: `local` accessors, `event` /
   * `result` / `arg`-falling-back-to-`event` through `callbackValue` (including a function the
   * callback handed over), `$`-prefixed context keys skipped, and function globals invoked.
   */
  callback: {
    stores: {
      $me: { did: 'did:me' },
      $clock: { $accessor: 'tick:tock' },
      $item: { role: 'global-shadowed' },
      counter: { value: 7 },
    },
    local: { page: 2, dirty: false },
    context: {
      event: { id: 'ev:9', detail: { key: 'Enter' }, save: { $callable: 'save' } },
      result: { id: 'res:1', done: { $callable: 'done' } },
      $item: { role: 'skipped' },
      item: { role: 'visible' },
    },
  },
};

const C = (id: string, source: string, env?: string): ExpressionCase => ({ id, source, env });

export const EXPRESSION_CASES: ExpressionCase[] = [
  /* --- ported from expressions.test.ts: parsing & printing ------------------------------- */
  C('print.member-eq', "a.b == 'x'"),
  C('print.precedence', '!a || b && c'),
  C('print.parens', '(a || b) && c'),
  C('print.conditional-chain', 'a ? b : c ? d : e'),
  C('print.conditional-binary', '(a ? b : c) == d'),
  C('print.sub-group', 'a - (b - c)'),
  C('print.sub-left', 'a - b - c'),
  C('print.unary-arith', '-a * 2 + 1'),
  C('print.call-in', "count(items) > 0 && 'x' in list"),
  C('print.macro-count', 'items.filter(x, x.done).count()'),
  C('print.filter-where', "items.filter({ role: 'admin' }, 2)"),
  C('print.template', '`hi ${me.handle}!`'),
  C('print.index-mixed', 'a[0].b["c-d"]'),
  C('print.object', "{ 'a-b': 1, c: [1, 2] }"),
  C('print.nullish', 'a ?? b'),
  C('print.neq-null', 'local.x != null'),

  /* --- ported: evaluation --------------------------------------------------------------- */
  C('eval.filter-count', "filter(spaceStore.members, { role: 'admin' }).count()", 'stock'),
  C('eval.sum-map', 'sum(rows.map(r, count(r.kids)))', 'stock'),
  C('eval.reverse-list', 'reverse([1, 2, 3])'),
  C('eval.reverse-rows', 'reverse(rows)', 'stock'),
  C('eval.reverse-nothing', 'reverse(nothing)', 'stock'),
  C('eval.reverse-string', "reverse('abc')"),
  C('eval.count-gt', 'spaceStore.members.count() > 1', 'stock'),
  C('eval.ns-fn-member', 'spaceStore.logout', 'stock'),
  C('eval.ns-bare', 'spaceStore', 'stock'),
  C('eval.role-eq', "item.role == 'admin'", 'stock'),
  C('eval.index-ns', "store.byId['we://a-call'].targets", 'keyed'),
  C('eval.index-ns-flag', "store.byId['we://a-call'].canExtract", 'keyed'),
  C('eval.index-computed', 'store.byId[item.id].targets', 'keyed'),
  C('eval.index-count', "count(store.byId['we://a-call'].targets)", 'keyed'),
  C('eval.split', "split('ImageBlock, TextBlock')"),
  C('eval.split-empty', "split('')"),
  C('eval.split-sep', "split('a|b', '|')"),
  C('eval.join-split', "join(split('a,,b'), ',')"),
  C('eval.in-split', "'b' in split('a,b')"),
  C('eval.missing-deep', 'missing.deep.path', 'stock'),
  C('eval.div-zero', '1 / 0'),
  C('eval.concat-mixed', "'a' + 1"),
  C('eval.null-arith', 'null + 1'),
  C('eval.in-string', "'x' in 'xyz'"),
  C('eval.count-num', 'count(5)'),
  C('eval.sum-bad', "sum('nonsense')"),
  C('eval.sum-mixed', 'sum([1, "two", 3])'),
  C('eval.macro-nonlist-filter', 'nothing.filter(x, x)', 'stock'),
  C('eval.macro-nonlist-map', 'nothing.map(x, x)', 'stock'),
  C('eval.macro-nonlist-all', 'nothing.all(x, x)', 'stock'),
  C('eval.or-fallback', "'' || 'fallback'"),
  C('eval.and', "'x' && 'y'"),
  C('eval.and-empty', "'' && 'y'"),
  C('eval.nullish-empty', "'' ?? 'fallback'"),
  C('eval.nullish-missing', "missing ?? 'fallback'", 'stock'),
  C('eval.and-shortcircuit', '0 && missing.thing', 'stock'),
  C('eval.template-count', '`${count(items)} ${plural(count(items), "one", "many")}`', 'stock'),
  C('eval.template-missing', '`${missing}`', 'stock'),
  C('eval.macro-chain', 'items.filter(x, x.ok).map(x, x.n)', 'stock'),
  C('eval.macro-scope', 'items.map(y, x)', 'stock'),
  C('eval.exists', 'items.exists(x, x.n == 2)', 'stock'),
  C('eval.find-member', 'items.find(x, x.n == 2).n', 'stock'),
  C('eval.map-object', '{ a: 1 }.map(x, x.a)'),
  C('eval.distinct-kinds', 'distinct(found.map(r, r.__subjectClass), placements.map(p, p.nodeType))', 'distinct'),
  C('eval.distinct-records', 'distinct(a, b).map(r, r.v)', 'distinct'),
  C('eval.distinct-mixed', 'distinct(nothing, [1, 1, 2])', 'stock'),
  C('eval.distinct-none', 'distinct()'),
  C('eval.where-contains', "filter(items, { name: { contains: 'AN' } }).count()", 'where'),
  C('eval.where-or', "filter(items, { OR: [{ name: 'Bob' }, { name: 'Anna' }] }).count()", 'where'),
  C('eval.where-exists', 'find(items, { tags: { exists: false } }).name', 'where'),
  C('eval.where-miss', "find(items, { name: 'Zed' }).name", 'where'),
  C('eval.where-range', "filter(events, { startDate: { gte: '2026-09-15', lt: '2026-10-01' } }).map(e, e.id)", 'where'),
  C('eval.where-numeric', 'filter(events, { seats: { gt: 5 } }).map(e, e.id)', 'where'),
  // `month: 8` is the numeric edge — `new Date(8)` lands in January 1970 only under the pinned
  // TZ=UTC. The ISO cases are the explicit spellings: mid-month parses to August under any zone,
  // and a local-time noon never date-shifts at all. All use past months, so `isToday` can never
  // flip a vector when the calendar catches up.
  C('eval.host-source', 'calendarMonth({ month: 8 })'),
  C('eval.host-source-month-iso', "calendarMonth({ month: '2025-08-15' })"),
  C('eval.host-source-month-noon', "calendarMonth({ month: '2025-08-01T12:00:00' })"),
  C('eval.host-source-month-offset', "calendarMonth({ month: '2025-08-15', offset: 3, weekStartsOn: 1 })"),

  /* --- the real environment's root rules, each under a callback context ------------------- */
  C('env.local-accessor', 'local.page + 1', 'callback'),
  C('env.local-undeclared', 'local.nope', 'callback'),
  C('env.callback-member', 'event.detail.key', 'callback'),
  C('env.callback-fn-read', 'event.save', 'callback'),
  C('env.callback-raw', 'event', 'callback'),
  C('env.arg-fallback', 'arg.id', 'callback'),
  C('env.arg-direct', 'arg.id', 'stock'),
  C('env.result-root', 'result.id', 'callback'),
  C('env.result-fn', 'result.done', 'callback'),
  C('env.dollar-key-skipped', '$item.role', 'callback'),
  C('env.context-key', 'item.role', 'callback'),
  C('env.function-global', 'clock', 'callback'),
  C('env.object-global', 'me.did', 'callback'),
  C('env.store-member', 'counter.value', 'callback'),
  C('env.local-with-callback', "local.dirty ? 'd' : event.id", 'callback'),

  /* --- systematic: operators the corpus must pin ---------------------------------------- */
  C('op.mod', '7 % 3'),
  C('op.mod-zero', '7 % 0'),
  C('op.div', '7 / 2'),
  C('op.div-zero', '7 / 0'),
  C('op.div-zero-string', "'x' / 0"),
  C('op.mul', '3 * 4'),
  C('op.mul-string', "'3' * '4'"),
  C('op.sub', '10 - 4'),
  C('op.sub-string', "'10' - 4"),
  C('op.add-nums', '1 + 2'),
  C('op.add-strings', "'a' + 'b'"),
  C('op.add-bool', 'true + 1'),
  C('op.add-undef', 'missing + 1', 'stock'),
  C('op.lt', '1 < 2'),
  C('op.lt-strings', "'b' < 'a'"),
  C('op.lte', '2 <= 2'),
  C('op.gt', '3 > 2'),
  C('op.gte', '2 >= 3'),
  C('op.eq-null', 'null == null'),
  C('op.eq-null-undef', 'null == missing', 'stock'),
  C('op.eq-coerce', "1 == '1'"),
  C('op.neq', "1 != '1'"),
  C('op.neq-obj', '{a:1} != {a:1}'),
  C('op.eq-obj', 'item == item', 'stock'),
  C('op.in-arr', "'a' in ['a','b']"),
  C('op.in-obj', "'a' in {a:1}"),
  C('op.in-num', '1 in [1,2]'),
  C('op.in-undef', "'a' in missing", 'stock'),
  C('op.not', '!false'),
  C('op.not-num', '!0'),
  C('op.not-str', "!''"),
  C('op.neg', '-5'),
  C('op.neg-str', "-'3'"),
  C('op.neg-undef', '-missing', 'stock'),
  C('op.cond', 'true ? 1 : 2'),
  C('op.cond-false', 'false ? 1 : 2'),
  C('op.cond-nested', 'missing ? 1 : 0 ? 2 : 3', 'stock'),
  C('op.template-parts', "`a${1}b${'x'}c`"),
  C('op.template-list', '`${[1,2]}`'),
  C('op.template-bool', '`${true}`'),
  C('op.list', "[1, 'x', [2]]"),
  C('op.object', "{ a: 1, 'b c': [true] }"),
  C('op.index-num', '[7,8,9][1]'),
  C('op.index-neg', '[7,8,9][-1]'),
  C('op.index-str', "'abc'[1]"),
  C('op.index-str-key', "{ 'x-y': 5 }['x-y']"),
  C('op.index-undef', 'missing[0]', 'stock'),
  C('op.member-proto', 'a.__proto__'),
  C('op.index-proto', "a['constructor']"),
  C('op.object-proto', '{ __proto__: 1 }'),
  C(
    'op.too-deep',
    '(((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((a))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))',
  ),
  C('op.member-str-length', "'abc'.length"),
  C('op.member-num', 'item.n.toString', 'stock'),
  C('op.member-deep-miss', 'item.a.b.c.d', 'stock'),
  C('op.call-unknown', 'notAFunction(1)'),
  C('op.call-receiver', "first(list, {x:'a'}).count()", 'stock'),
  C('op.macro-find-miss', 'items.find(x, x.n == 9)', 'stock'),
  C('op.macro-exists-false', 'items.exists(x, x.n == 9)', 'stock'),
  C('op.macro-nonlist-find', 'missing.find(x, x)', 'stock'),
  C('op.macro-nonlist-exists', 'missing.exists(x, x)', 'stock'),
  C('op.macro-map-num', '(5).map(x, x)'),
  C('op.and-list', '[1] && [2]'),
  C('op.or-obj', '{a:1} || false'),
  C('op.nullish-zero', '0 ?? 9'),
  C('op.nullish-null', 'null ?? 9'),
  C('op.nullish-false', 'false ?? 9'),
  C('op.eq-bool', 'true == true'),
  C('op.eq-arr', '[1] == [1]'),
  C('op.mixed-chain', '1 + 2 * 3 - 4 / 2 % 3'),
  C('op.parens-num', '(1 + 2) * 3'),
  C('op.not-eq', "!('a' == 'a')"),
  C('op.cond-cond', "1 ? 2 ? 'a' : 'b' : 'c'"),
  C('op.big-or', "false || false || 'x'"),
  C('op.big-and', "true && 1 && 'x'"),

  /* --- the bundle corpus --------------------------------------------------------------- */
  ...BUNDLE_EXPRESSIONS.map((source, i) => C(`bundle.${String(i).padStart(3, '0')}`, source, 'stock')),
];

/* Extra named environments the ported cases need. */
Object.assign(EXPRESSION_ENVS, {
  keyed: {
    stores: {
      store: {
        byId: {
          $namespace: {
            'we://a-call': { targets: ['we://a-call'], canExtract: true },
            'we://another': { targets: ['we://another'], canExtract: true },
            empty: { targets: ['empty'], canExtract: false },
          },
        },
      },
    },
    context: { item: { id: 'we://another' } },
  },
  where: {
    context: {
      items: [{ name: 'Anna', tags: ['a'] }, { name: 'Bob' }],
      events: [
        { id: 'a', startDate: '2026-09-14', seats: 4 },
        { id: 'b', startDate: '2026-09-30T18:00', seats: '12' },
        { id: 'c', startDate: '2026-10-02', seats: 20 },
      ],
    },
  },
  distinct: {
    context: {
      found: [{ __subjectClass: 'TaskBlock' }, { __subjectClass: 'EventBlock' }, { __subjectClass: 'TaskBlock' }],
      placements: [{ nodeType: 'NoteBlock' }, { nodeType: 'EventBlock' }],
      a: [{ id: 1, v: 'x' }],
      b: [
        { id: 1, v: 'y' },
        { id: 2, v: 'z' },
      ],
      nothing: { $undefined: true },
    },
  },
});
