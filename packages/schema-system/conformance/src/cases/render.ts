/**
 * Renderer vector inputs: a template, the data it reads, and a script of events — run through the
 * real renderer, mounted on jsdom, and recorded as a renderer-neutral tree after every step, with the
 * actions the step fired, in order.
 *
 * What a case may supply:
 *
 * - `template` — the root node, `routes` included. Routed templates render under a router whose
 *   address starts at `start` (default `/`); everything else renders the root on its own.
 * - `data` — store members the template reads, as `{ store: { member: value } }`. Held reactively:
 *   a `data` step changes one and the template follows.
 * - `actions` — store methods the template calls, as `{ 'store.method': outcome }`. Every call is
 *   recorded; `outcome` says what it answers: `{ resolve: v }` a promise resolving `v`, `{ reject: m }`
 *   one rejecting with an `Error(m)`, `{ returns: v }` a plain value. `gated` names the ones the host
 *   refuses to run without a gesture — they go through the host's real gate.
 * - `params` — the URL query parameters at mount, for `syncParam`.
 * - `storage` — device storage at mount, for `persist`.
 * - `identities` — the profiles the host can answer for `$agent`, by DID.
 *
 * Steps (`steps`), each one recorded:
 *
 * - `{ op: 'click', target }` — a press on the element whose `data-case` is `target`. A gesture.
 * - `{ op: 'input', target, value }` — typing: the element's `value` set and an `input` event. A gesture.
 * - `{ op: 'emit', target, event, detail? }` — a custom event the element fires by itself. Not a
 *   gesture, unless `event` is one of the activation events (`change`, `input`, …).
 * - `{ op: 'navigate', to }` — the router moves to `to`.
 * - `{ op: 'data', store, member, value }` — a store member changes.
 *
 * The first entry of a vector's `expect` is the tree as mounted, before any step.
 *
 * Case ids are append-only: a case is never renamed or reused, so a renderer's known-gap list keeps
 * meaning what it said.
 */
import type { SchemaNode } from '@we/schema-shared';

export type RenderOutcome = { resolve?: unknown; reject?: string; returns?: unknown };

export type RenderStep =
  | { op: 'click'; target: string }
  | { op: 'input'; target: string; value: string }
  | { op: 'emit'; target: string; event: string; detail?: unknown }
  | { op: 'navigate'; to: string }
  | { op: 'data'; store: string; member: string; value: unknown };

export interface RenderCase {
  id: string;
  /** What the case pins, for the failure message and the reader of the vectors. */
  note: string;
  template: SchemaNode;
  data?: Record<string, Record<string, unknown>>;
  actions?: Record<string, RenderOutcome>;
  gated?: string[];
  params?: Record<string, string>;
  storage?: Record<string, string>;
  /** Profiles the host knows, by DID, for `$agent`. */
  identities?: Record<string, Record<string, unknown>>;
  start?: string;
  steps?: RenderStep[];
}

const C = (
  id: string,
  note: string,
  template: SchemaNode,
  rest: Omit<RenderCase, 'id' | 'note' | 'template'> = {},
): RenderCase => ({ id, note, template, ...rest });

const text = (...children: SchemaNode['children'] & unknown[]): SchemaNode => ({ type: 'we-text', children });
const button = (target: string, onClick: NonNullable<SchemaNode['props']>[string], label = target): SchemaNode => ({
  type: 'we-button',
  props: { 'data-case': target, onClick },
  children: [label],
});

export const RENDER_CASES: RenderCase[] = [
  /* ── node structure ─────────────────────────────────────────────────────────────────────── */
  C('render.node.component', 'a registered component mounts with its resolved props', {
    type: 'Column',
    props: { gap: '300', label: 'Hello' },
  }),
  C('render.node.custom-element', 'a custom element is mounted by its tag, its props set as properties', {
    type: 'we-text',
    props: { variant: 'heading-sm', truncate: true },
    children: ['Title'],
  }),
  C('render.node.native', 'a native element from the allowlist mounts with its props as attributes', {
    type: 'div',
    props: { class: 'box', title: 'tip' },
    children: [{ type: 'span', children: ['inner'] }],
  }),
  C('render.node.text-children', 'string children are text, kept in order around nodes', {
    type: 'Row',
    children: ['before ', { type: 'we-icon', props: { name: 'star' } }, ' after'],
  }),
  C(
    'render.node.expression-child',
    'an expression in children renders as text; an absent value renders nothing',
    { type: 'Row', children: [{ $: 'app.title' }, ' | ', { $: 'app.missing' }, ' | ', { $: 'app.count + 1' }] },
    { data: { app: { title: 'Board', count: 2 } } },
  ),
  C('render.node.fragment', 'a node with no type renders its children with no element of its own', {
    children: [text('one'), text('two')],
  }),
  C('render.node.nested', 'children nest to any depth', {
    type: 'Column',
    children: [{ type: 'Row', children: [{ type: 'Card', children: [text('deep')] }] }],
  }),
  C('render.node.slots', 'a named slot renders its node into the component, beside its children', {
    type: 'Card',
    slots: { header: text('Header'), footer: { type: 'Row', children: [text('Footer')] } },
    children: [text('Body')],
  }),
  C('render.node.slot-attribute', "`slot` puts a node into a web component's named slot", {
    type: 'we-tabs',
    children: [{ type: 'we-tab', slot: 'nav', props: { key: 'a' }, children: ['A'] }, text('panel')],
  }),
  C(
    'render.node.reactive-prop',
    'a prop bound to an expression follows the data it reads',
    { type: 'we-text', props: { variant: { $: "app.big ? 'heading-lg' : 'body'" } }, children: [{ $: 'app.title' }] },
    {
      data: { app: { big: false, title: 'Small' } },
      steps: [
        { op: 'data', store: 'app', member: 'big', value: true },
        { op: 'data', store: 'app', member: 'title', value: 'Large' },
      ],
    },
  ),
  C('render.node.ref', 'a $ref renders the definition it names, as if written in place', {
    type: 'Column',
    $defs: { d1: { type: 'Card', children: [text('Shared')] } },
    children: [
      { type: '$ref', props: { def: 'd1' } },
      { type: '$ref', props: { def: 'd1' } },
    ],
  }),
  C('render.node.ref-nested', 'a definition may use another definition', {
    type: 'Column',
    $defs: {
      d1: { type: 'Row', children: [{ type: '$ref', props: { def: 'd2' } }, text('outer')] },
      d2: text('inner'),
    },
    children: [{ type: '$ref', props: { def: 'd1' } }],
  }),
  C('render.node.ref-missing', 'a $ref naming no definition renders an empty Column, not a crash', {
    type: 'Column',
    $defs: { d1: text('defined') },
    children: [{ type: '$ref', props: { def: 'nope' } }, text('after')],
  }),
  C('render.node.ref-cycle', 'a definition reaching itself renders an empty Column where the cycle closes', {
    type: 'Column',
    $defs: { d1: { type: 'Row', children: [{ type: '$ref', props: { def: 'd1' } }] } },
    children: [{ type: '$ref', props: { def: 'd1' } }],
  }),
  C(
    'render.node.prop-node-is-data',
    'a node held in an ordinary prop is handed to the component as data; only $if renders a prop',
    { type: 'Card', props: { front: text('front face') } },
  ),

  /* ── $each ──────────────────────────────────────────────────────────────────────────────── */
  C(
    'render.each.items',
    '$each renders its first child once per item, the item bound under `as`',
    {
      type: 'Column',
      children: [
        {
          type: '$each',
          props: { items: { $: 'app.rows' }, as: 'row' },
          children: [text({ $: 'row.name' })],
        },
      ],
    },
    {
      data: {
        app: {
          rows: [
            { id: 'a', name: 'Ann' },
            { id: 'b', name: 'Bo' },
          ],
        },
      },
    },
  ),
  C('render.each.default-as', 'without `as` the item is `item`', {
    type: '$each',
    props: { items: { $: "['x', 'y']" } },
    children: [text({ $: 'item' })],
  }),
  C(
    'render.each.index-prev',
    'each row gets its position as `index` and the row before as `prev`, absent on the first',
    {
      type: '$each',
      props: { items: { $: 'app.rows' }, as: 'm' },
      children: [text({ $: '`${index}:${m.author}:${prev ? prev.author : "-"}:${m.author == prev.author}`' })],
    },
    {
      data: {
        app: {
          rows: [
            { id: '1', author: 'ann' },
            { id: '2', author: 'ann' },
            { id: '3', author: 'bo' },
          ],
        },
      },
    },
  ),
  C('render.each.prev-plain', 'rows with no id of their own get `index` and `prev` the same way', {
    type: '$each',
    props: { items: { $: "['a', 'a', 'b']" } },
    children: [text({ $: '`${index}:${item}:${prev ?? "-"}`' })],
  }),
  C(
    'render.each.empty',
    'an empty list renders nothing; a value that is not a list renders as an empty list',
    {
      type: 'Column',
      children: [
        { type: '$each', props: { items: { $: 'app.none' } }, children: [text('never')] },
        { type: '$each', props: { items: { $: 'app.notAList' } }, children: [text('never')] },
        text('end'),
      ],
    },
    { data: { app: { none: [], notAList: 'abc' } } },
  ),
  C('render.each.only-first-child', "only $each's first child is the row; the rest are not rendered", {
    type: '$each',
    props: { items: { $: '[1, 2]' } },
    children: [text({ $: 'item' }), text('ignored')],
  }),
  C(
    'render.each.nested',
    'a nested $each shadows `item`, `index` and `prev`; the outer row stays reachable by its name',
    {
      type: '$each',
      props: { items: { $: 'app.groups' }, as: 'g' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'g.items' } },
          children: [text({ $: '`${g.name}/${index}/${item}`' })],
        },
      ],
    },
    {
      data: {
        app: {
          groups: [
            { id: 'g1', name: 'A', items: ['x', 'y'] },
            { id: 'g2', name: 'B', items: ['z'] },
          ],
        },
      },
    },
  ),
  C(
    'render.each.live',
    'the rows follow the list: an added, removed or changed row is drawn as the list now is',
    { type: '$each', props: { items: { $: 'app.rows' } }, children: [text({ $: 'item.name' })] },
    {
      data: { app: { rows: [{ id: 'a', name: 'Ann' }] } },
      steps: [
        {
          op: 'data',
          store: 'app',
          member: 'rows',
          value: [
            { id: 'a', name: 'Ann' },
            { id: 'b', name: 'Bo' },
          ],
        },
        { op: 'data', store: 'app', member: 'rows', value: [{ id: 'b', name: 'Bob' }] },
      ],
    },
  ),
  C(
    'render.each.comprehension',
    'items may be any expression producing a list',
    {
      type: '$each',
      props: { items: { $: 'app.rows.filter(r, r.done).map(r, r.name)' } },
      children: [text({ $: 'item' })],
    },
    {
      data: {
        app: {
          rows: [
            { name: 'a', done: true },
            { name: 'b', done: false },
            { name: 'c', done: true },
          ],
        },
      },
    },
  ),

  /* ── $if ────────────────────────────────────────────────────────────────────────────────── */
  C(
    'render.if.then',
    'a truthy condition renders `then`',
    { type: '$if', props: { condition: { $: 'app.on' }, then: text('yes'), else: text('no') } },
    { data: { app: { on: true } } },
  ),
  C(
    'render.if.else',
    'a falsy condition renders `else`',
    { type: '$if', props: { condition: { $: 'app.on' }, then: text('yes'), else: text('no') } },
    { data: { app: { on: false } } },
  ),
  C(
    'render.if.no-else',
    'a falsy condition with no `else` renders nothing',
    {
      type: 'Row',
      children: [{ type: '$if', props: { condition: { $: 'app.on' }, then: text('yes') } }, text('after')],
    },
    { data: { app: { on: 0 } } },
  ),
  C(
    'render.if.toggles',
    'the branch follows the condition',
    { type: '$if', props: { condition: { $: 'app.n > 1' }, then: text('many'), else: text('few') } },
    {
      data: { app: { n: 1 } },
      steps: [
        { op: 'data', store: 'app', member: 'n', value: 5 },
        { op: 'data', store: 'app', member: 'n', value: 0 },
      ],
    },
  ),
  C(
    'render.if.absent',
    'an absent value is falsy, as are 0, the empty string and the empty list is not',
    {
      type: 'Column',
      children: [
        { type: '$if', props: { condition: { $: 'app.missing' }, then: text('missing'), else: text('no missing') } },
        { type: '$if', props: { condition: { $: 'app.zero' }, then: text('zero'), else: text('no zero') } },
        { type: '$if', props: { condition: { $: 'app.blank' }, then: text('blank'), else: text('no blank') } },
        {
          type: '$if',
          props: { condition: { $: 'app.list' }, then: text('empty list is truthy'), else: text('no list') },
        },
      ],
    },
    { data: { app: { zero: 0, blank: '', list: [] } } },
  ),
  C('render.if.literal', 'a literal condition is used as it is', {
    type: '$if',
    props: { condition: true, then: text('literal true') },
  }),
  C('render.if.children-ignored', 'a $if renders its branches only; children written on it are not rendered', {
    type: '$if',
    props: { condition: true, then: text('branch') },
    children: [text('child')],
  }),

  /* ── $single, $agent-free scope nodes ───────────────────────────────────────────────────── */
  C(
    'render.single.no-backend',
    '$single renders nothing until its query has an answer — with no data source, nothing',
    {
      type: 'Column',
      children: [
        { type: '$single', props: { item: { $query: { entity: 'Post' } }, as: 'p' }, children: [text('found')] },
        text('after'),
      ],
    },
  ),

  /* ── $routes ────────────────────────────────────────────────────────────────────────────── */
  C(
    'render.routes.outlet',
    'the route matching the address renders at the $routes outlet, inside the root',
    {
      type: 'Column',
      children: [text('chrome'), { type: '$routes' }],
      routes: [
        { path: '/', type: 'Column', children: [text('home')] },
        { path: '/about', type: 'Column', children: [text('about')] },
      ],
    },
    {
      steps: [
        { op: 'navigate', to: '/about' },
        { op: 'navigate', to: '/' },
      ],
    },
  ),
  C(
    'render.routes.start',
    'the address a template opens on picks its route',
    {
      type: 'Column',
      children: [{ type: '$routes' }],
      routes: [
        { path: '/', type: 'Column', children: [text('home')] },
        { path: '/settings', type: 'Column', children: [text('settings')] },
      ],
    },
    { start: '/settings' },
  ),
  C(
    'render.routes.params',
    "a route's `:param` is read through routeStore.params",
    {
      type: 'Column',
      children: [{ type: '$routes' }],
      routes: [
        { path: '/', type: 'Column', children: [text('list')] },
        { path: '/post/:postId', type: 'Column', children: [text({ $: "'post ' + routeStore.params.postId" })] },
      ],
    },
    { start: '/post/42', steps: [{ op: 'navigate', to: '/post/7' }] },
  ),
  C(
    'render.routes.nested',
    'a route with routes is a layout: its own $routes outlet holds the child route',
    {
      type: 'Column',
      children: [{ type: '$routes' }],
      routes: [
        {
          path: '/board',
          type: 'Column',
          children: [text('board chrome'), { type: '$routes' }],
          routes: [
            { path: '/', type: 'Row', children: [text('columns')] },
            { path: '/card/:cardId', type: 'Row', children: [text({ $: "'card ' + routeStore.params.cardId" })] },
          ],
        },
      ],
    },
    { start: '/board', steps: [{ op: 'navigate', to: '/board/card/3' }] },
  ),
  C(
    'render.routes.outlet-in-if',
    'an outlet behind a $if renders its route once the gate opens',
    {
      type: 'Column',
      children: [
        { type: '$if', props: { condition: { $: 'app.ready' }, then: { type: '$routes' }, else: text('loading') } },
      ],
      routes: [{ path: '/', type: 'Column', children: [text('routed')] }],
    },
    { data: { app: { ready: false } }, steps: [{ op: 'data', store: 'app', member: 'ready', value: true }] },
  ),
  C(
    'render.routes.no-match',
    'an address matching no route renders nothing at the outlet',
    {
      type: 'Column',
      children: [text('chrome'), { type: '$routes' }],
      routes: [{ path: '/', type: 'Column', children: [text('home')] }],
    },
    { start: '/nowhere' },
  ),

  /* ── handlers ───────────────────────────────────────────────────────────────────────────── */
  C(
    'render.handler.invoke',
    '$invoke calls the store method with exactly its args, resolved when it fires',
    {
      type: 'Column',
      children: [button('save', { $invoke: 'act.save', args: ['draft', { $: 'app.id' }, { n: 1 }] })],
    },
    {
      data: { app: { id: 'r1' } },
      actions: { 'act.save': { returns: true } },
      steps: [{ op: 'click', target: 'save' }],
    },
  ),
  C(
    'render.handler.invoke-no-args',
    '$invoke without args calls the method with none — the event is not passed on',
    { type: 'Column', children: [button('go', { $invoke: 'act.go' })] },
    { actions: { 'act.go': { returns: null } }, steps: [{ op: 'click', target: 'go' }] },
  ),
  C(
    'render.handler.invoke-event-detail',
    'an arg reading `event` is the value the handler received',
    {
      type: 'we-select',
      props: { 'data-case': 'pick', onChange: { $invoke: 'act.pick', args: [{ $: 'event.detail' }] } },
    },
    {
      actions: { 'act.pick': { returns: null } },
      steps: [{ op: 'emit', target: 'pick', event: 'change', detail: 'b' }],
    },
  ),
  C(
    'render.handler.on-success',
    "onSuccess runs after the method's promise resolves, with `result` its value",
    {
      type: 'Column',
      $localState: { saved: { type: 'string', initial: '' } },
      children: [
        button('save', {
          $invoke: 'act.save',
          onSuccess: [
            { $setLocal: 'saved', value: { $: 'result' } },
            { $invoke: 'act.after', args: [{ $: 'result' }] },
          ],
          onError: [{ $invoke: 'act.failed' }],
          onFinally: [{ $invoke: 'act.done' }],
        }),
        text({ $: "'saved:' + local.saved" }),
      ],
    },
    {
      actions: {
        'act.save': { resolve: 'new-id' },
        'act.after': { returns: null },
        'act.failed': { returns: null },
        'act.done': { returns: null },
      },
      steps: [{ op: 'click', target: 'save' }],
    },
  ),
  C(
    'render.handler.on-error',
    'onError runs after a rejection, with `result` the error; onFinally runs either way',
    {
      type: 'Column',
      $localState: { error: { type: 'string', initial: '' } },
      children: [
        button('save', {
          $invoke: 'act.save',
          onSuccess: [{ $invoke: 'act.after' }],
          onError: [{ $setLocal: 'error', value: { $: 'result.message' } }],
          onFinally: [{ $invoke: 'act.done' }],
        }),
        text({ $: "'error:' + local.error" }),
      ],
    },
    {
      actions: { 'act.save': { reject: 'refused' }, 'act.after': { returns: null }, 'act.done': { returns: null } },
      steps: [{ op: 'click', target: 'save' }],
    },
  ),
  C(
    'render.handler.sync-lifecycle',
    'a method that returns a plain value runs no lifecycle callback',
    {
      type: 'Column',
      children: [button('go', { $invoke: 'act.go', onSuccess: [{ $invoke: 'act.after' }] })],
    },
    { actions: { 'act.go': { returns: 5 }, 'act.after': { returns: null } }, steps: [{ op: 'click', target: 'go' }] },
  ),
  C(
    'render.handler.array',
    'a handler list runs each entry in order',
    {
      type: 'Column',
      $localState: { n: { type: 'number', initial: 0 } },
      children: [
        button('go', [
          { $invoke: 'act.first' },
          { $setLocal: 'n', value: { $: 'local.n + 10' } },
          { $invoke: 'act.second', args: [{ $: 'local.n' }] },
        ]),
        text({ $: 'local.n' }),
      ],
    },
    {
      actions: { 'act.first': { returns: null }, 'act.second': { returns: null } },
      steps: [{ op: 'click', target: 'go' }],
    },
  ),
  C(
    'render.handler.missing-method',
    '$invoke naming a method the stores do not have does nothing, and nothing breaks',
    {
      type: 'Column',
      children: [button('go', [{ $invoke: 'act.nothing' }, { $invoke: 'act.real' }]), text('still here')],
    },
    { actions: { 'act.real': { returns: null } }, steps: [{ op: 'click', target: 'go' }] },
  ),
  C(
    'render.handler.set-local',
    '$setLocal writes a literal or what an expression computes when it fires',
    {
      type: 'Column',
      $localState: { label: { type: 'string', initial: 'start' }, page: { type: 'number', initial: 1 } },
      children: [
        button('literal', { $setLocal: 'label', value: 'clicked' }),
        button('next', { $setLocal: 'page', value: { $: 'local.page + 1' } }),
        text({ $: '`${local.label} ${local.page}`' }),
      ],
    },
    {
      steps: [
        { op: 'click', target: 'literal' },
        { op: 'click', target: 'next' },
        { op: 'click', target: 'next' },
      ],
    },
  ),
  C(
    'render.handler.set-local-event',
    '$setLocal reading `event` takes the value typed',
    {
      type: 'Column',
      $localState: { q: { type: 'string', initial: '' } },
      children: [
        { type: 'input', props: { 'data-case': 'q', onInput: { $setLocal: 'q', value: { $: 'event.target.value' } } } },
        text({ $: "'q=' + local.q" }),
      ],
    },
    { steps: [{ op: 'input', target: 'q', value: 'hello' }] },
  ),
  C(
    'render.handler.set-local-merge',
    '$setLocal with `merge` shallow-merges into an object field',
    {
      type: 'Column',
      $localState: { place: { type: 'object', initial: { city: 'Oslo', country: 'NO' } } },
      children: [
        button('move', { $setLocal: 'place', merge: { city: 'Bergen' } }),
        text({ $: '`${local.place.city}, ${local.place.country}`' }),
      ],
    },
    { steps: [{ op: 'click', target: 'move' }] },
  ),
  C(
    'render.handler.toggle-local',
    '$toggleLocal flips a boolean field',
    {
      type: 'Column',
      $localState: { open: { type: 'boolean', initial: false } },
      children: [
        button('toggle', { $toggleLocal: 'open' }),
        { type: '$if', props: { condition: { $: 'local.open' }, then: text('open'), else: text('closed') } },
      ],
    },
    {
      steps: [
        { op: 'click', target: 'toggle' },
        { op: 'click', target: 'toggle' },
      ],
    },
  ),
  C(
    'render.handler.toggle-local-in',
    '$toggleLocalIn adds a value to a list field, or takes it out when it is there',
    {
      type: 'Column',
      $localState: { picked: { type: 'array', initial: ['a'] } },
      children: [
        button('b', { $toggleLocalIn: 'picked', value: 'b' }),
        button('a', { $toggleLocalIn: 'picked', value: 'a' }),
        text({ $: "join(local.picked, ',')" }),
      ],
    },
    {
      steps: [
        { op: 'click', target: 'b' },
        { op: 'click', target: 'a' },
        { op: 'click', target: 'b' },
      ],
    },
  ),
  C(
    'render.handler.toggle-local-in-rows',
    'per-row state: each row toggles its own id in one list and reads it back with `in`',
    {
      type: 'Column',
      $localState: { open: { type: 'array', initial: [] } },
      children: [
        {
          type: '$each',
          props: { items: { $: 'app.rows' }, as: 'row' },
          children: [
            {
              type: 'Row',
              children: [
                {
                  type: 'we-button',
                  props: {
                    'data-case': { $: "'row-' + row.id" },
                    onClick: { $toggleLocalIn: 'open', value: { $: 'row.id' } },
                  },
                  children: [{ $: 'row.id' }],
                },
                { type: '$if', props: { condition: { $: 'row.id in local.open' }, then: text('open') } },
              ],
            },
          ],
        },
      ],
    },
    { data: { app: { rows: [{ id: 'r1' }, { id: 'r2' }] } }, steps: [{ op: 'click', target: 'row-r2' }] },
  ),
  C(
    'render.handler.call-local',
    '$callLocal on a field holding no function does nothing; a store method read as a value is nothing, so it cannot arm one',
    {
      type: 'Column',
      $localState: { onConfirm: { type: 'function', initial: null } },
      children: [
        button('arm', { $setLocal: 'onConfirm', value: { $: 'act.confirm' } }),
        button('confirm', { $callLocal: 'onConfirm' }),
        text({ $: "local.onConfirm ? 'armed' : 'empty'" }),
      ],
    },
    {
      actions: { 'act.confirm': { returns: null } },
      steps: [
        { op: 'click', target: 'confirm' },
        { op: 'click', target: 'arm' },
        { op: 'click', target: 'confirm' },
      ],
    },
  ),
  C(
    'render.handler.reset-local',
    '$resetLocal on $scope puts every field of the scope back to its initial value',
    {
      type: 'Column',
      $localState: { a: { type: 'string', initial: 'a0' }, b: { type: 'number', initial: 0 } },
      children: [
        button('change', [
          { $setLocal: 'a', value: 'a1' },
          { $setLocal: 'b', value: 9 },
        ]),
        button('reset', { $resetLocal: '$scope' }),
        text({ $: '`${local.a} ${local.b}`' }),
      ],
    },
    {
      steps: [
        { op: 'click', target: 'change' },
        { op: 'click', target: 'reset' },
      ],
    },
  ),
  C(
    'render.handler.if-then',
    'a handler-position $if runs `then` when its condition holds as the event fires',
    {
      type: 'Column',
      $localState: { armed: { type: 'boolean', initial: false } },
      children: [
        button('arm', { $toggleLocal: 'armed' }),
        button('go', {
          $if: { condition: { $: 'local.armed' }, then: { $invoke: 'act.yes' }, else: { $invoke: 'act.no' } },
        }),
      ],
    },
    {
      actions: { 'act.yes': { returns: null }, 'act.no': { returns: null } },
      steps: [
        { op: 'click', target: 'go' },
        { op: 'click', target: 'arm' },
        { op: 'click', target: 'go' },
      ],
    },
  ),
  C(
    'render.handler.if-event',
    "a handler-position $if's condition may read the event",
    {
      type: 'we-select',
      props: {
        'data-case': 'pick',
        onChange: { $if: { condition: { $: "event.detail == 'b'" }, then: { $invoke: 'act.b' } } },
      },
    },
    {
      actions: { 'act.b': { returns: null } },
      steps: [
        { op: 'emit', target: 'pick', event: 'change', detail: 'a' },
        { op: 'emit', target: 'pick', event: 'change', detail: 'b' },
      ],
    },
  ),

  /* ── $localState ────────────────────────────────────────────────────────────────────────── */
  C('render.local.initial', 'each field starts at its declared initial value', {
    type: 'Column',
    $localState: {
      s: { type: 'string', initial: 'text' },
      n: { type: 'number', initial: 3 },
      b: { type: 'boolean', initial: true },
      o: { type: 'object', initial: { k: 'v' } },
      l: { type: 'array', initial: [1, 2] },
    },
    children: [text({ $: '`${local.s} ${local.n} ${local.b} ${local.o.k} ${count(local.l)}`' })],
  }),
  C(
    'render.local.initial-expression',
    'an initial value may be an expression, resolved against the stores at mount',
    {
      type: 'Column',
      $localState: { name: { type: 'string', initial: { $: 'app.name' } } },
      children: [text({ $: 'local.name' })],
    },
    { data: { app: { name: 'From the store' } } },
  ),
  C('render.local.shadowing', 'an inner scope sees the outer fields; a field of the same name shadows', {
    type: 'Column',
    $localState: { a: { type: 'string', initial: 'outer-a' }, b: { type: 'string', initial: 'outer-b' } },
    children: [
      text({ $: '`${local.a} ${local.b}`' }),
      {
        type: 'Row',
        $localState: { a: { type: 'string', initial: 'inner-a' } },
        children: [text({ $: '`${local.a} ${local.b}`' })],
      },
    ],
  }),
  C(
    'render.local.per-row',
    'a $localState inside a $each row is that row’s own',
    {
      type: '$each',
      props: { items: { $: "['x', 'y']" } },
      children: [
        {
          type: 'Row',
          $localState: { on: { type: 'boolean', initial: false } },
          children: [
            {
              type: 'we-button',
              props: { 'data-case': { $: "'btn-' + item" }, onClick: { $toggleLocal: 'on' } },
              children: [{ $: 'item' }],
            },
            text({ $: "local.on ? 'on' : 'off'" }),
          ],
        },
      ],
    },
    { steps: [{ op: 'click', target: 'btn-y' }] },
  ),
  C(
    'render.local.sync-param-read',
    'a syncParam field starts from the URL parameter when there is one',
    {
      type: 'Column',
      $localState: { sort: { type: 'string', initial: 'new', syncParam: 'sort' } },
      children: [text({ $: 'local.sort' })],
    },
    { params: { sort: 'top' } },
  ),
  C(
    'render.local.sync-param-write',
    'writing a syncParam field writes the parameter; back at the initial value it is removed',
    {
      type: 'Column',
      $localState: { sort: { type: 'string', initial: 'new', syncParam: { name: 'sort', push: true } } },
      children: [
        button('top', { $setLocal: 'sort', value: 'top' }),
        button('new', { $setLocal: 'sort', value: 'new' }),
        text({ $: 'local.sort' }),
      ],
    },
    {
      steps: [
        { op: 'click', target: 'top' },
        { op: 'click', target: 'new' },
      ],
    },
  ),
  C(
    'render.local.persist',
    'a persist field starts from device storage and writes back to it; $resetLocal clears it',
    {
      type: 'Column',
      $localState: { density: { type: 'string', initial: 'cosy', persist: 'cards.density' } },
      children: [
        button('compact', { $setLocal: 'density', value: 'compact' }),
        button('reset', { $resetLocal: '$scope' }),
        text({ $: 'local.density' }),
      ],
    },
    {
      storage: { 'we-local:cards.density': '"roomy"' },
      steps: [
        { op: 'click', target: 'compact' },
        { op: 'click', target: 'reset' },
      ],
    },
  ),
  C(
    'render.local.precedence',
    'URL parameter over stored value over initial',
    {
      type: 'Column',
      $localState: { view: { type: 'string', initial: 'grid', syncParam: 'view', persist: 'cards.view' } },
      children: [text({ $: 'local.view' })],
    },
    { params: { view: 'list' }, storage: { 'we-local:cards.view': '"table"' } },
  ),
  C(
    'render.local.validation',
    'error() shows a rule’s message once the field is touched; formValid() is every rule passing',
    {
      type: 'Column',
      $localState: {
        email: {
          type: 'string',
          initial: '',
          validate: [
            { rule: 'required', message: 'Required' },
            { rule: 'pattern', value: '^[^@]+@[^@]+$', message: 'Not an email' },
          ],
        },
      },
      children: [
        {
          type: 'input',
          props: { 'data-case': 'email', onInput: { $setLocal: 'email', value: { $: 'event.target.value' } } },
        },
        button('submit', [
          { $touch: '$all' },
          { $if: { condition: { $: 'formValid()' }, then: { $invoke: 'act.submit', args: [{ $: 'local.email' }] } } },
        ]),
        text({ $: "'error:' + error('email') + ' valid:' + formValid()" }),
      ],
    },
    {
      actions: { 'act.submit': { returns: null } },
      steps: [
        { op: 'click', target: 'submit' },
        { op: 'input', target: 'email', value: 'nope' },
        { op: 'input', target: 'email', value: 'a@b.c' },
        { op: 'click', target: 'submit' },
      ],
    },
  ),

  /* ── the other block-level types ────────────────────────────────────────────────────────── */
  C(
    'render.animate.condition',
    '$animate keeps its one child mounted whatever its condition; only the transition follows it',
    {
      type: '$animate',
      props: { condition: { $: 'app.open' } },
      children: [{ type: 'Row', $localState: { n: { type: 'number', initial: 0 } }, children: [text('kept')] }],
    },
    { data: { app: { open: false } }, steps: [{ op: 'data', store: 'app', member: 'open', value: true }] },
  ),
  C('render.animate.mount', '$animate with no trigger renders its child', {
    type: '$animate',
    props: {},
    children: [text('animated')],
  }),
  C('render.surface.scope', '$surface binds the box it draws under `as` for its children to read', {
    type: '$surface',
    props: { as: 'pane' },
    children: [text({ $: "pane ? 'has a surface' : 'none'" })],
  }),
  C(
    'render.agent.profile',
    '$agent binds the profile of the person `did` names, once it has arrived, under `as`',
    {
      type: 'Column',
      children: [
        { type: '$agent', props: { did: { $: 'app.author' }, as: 'who' }, children: [text({ $: 'who.name' })] },
        { type: '$agent', props: { did: 'did:unknown' }, children: [text('never')] },
        text('after'),
      ],
    },
    { data: { app: { author: 'did:ann' } }, identities: { 'did:ann': { did: 'did:ann', name: 'Ann' } } },
  ),
  C('render.panels.outlet', 'a $panels outlet is handed to the host as a lane, its props untouched', {
    type: 'Column',
    children: [{ type: '$panels', props: { lane: 'left', direction: 'column' } }],
  }),
  C('render.slot.in-template', 'a $slot in a template (not module chrome) is not resolved and shows the marker', {
    type: 'Column',
    children: [{ type: '$slot', props: { anchor: 'call-controls' } }],
  }),

  /* ── degradation ────────────────────────────────────────────────────────────────────────── */
  C(
    'render.degrade.unknown-component',
    'an unknown component renders the missing-component marker, and its siblings render',
    {
      type: 'Column',
      children: [text('before'), { type: 'NoSuchWidget', props: { a: 1 }, children: [text('lost')] }, text('after')],
    },
  ),
  C(
    'render.degrade.unknown-element',
    'an unknown custom element is mounted as an element with no definition — blank, not a marker',
    { type: 'Column', children: [{ type: 'we-no-such-element', children: ['inside'] }] },
  ),
  C('render.degrade.unknown-part', 'a part no module publishes resolves to a frame naming it, with nothing inside', {
    type: 'Column',
    children: [{ type: '$part', props: { id: 'nomodule.panel' } }, text('after')],
  }),
  C('render.degrade.part-no-id', 'a $part with no id resolves to nothing', {
    type: 'Column',
    children: [{ type: '$part', props: {} }, text('after')],
  }),
  C(
    'render.degrade.failing-expression',
    'an expression reading something absent gives nothing rather than an error',
    { type: 'Row', children: [text({ $: 'app.deep.path.here' }), text({ $: 'nope.thing' }), text('ok')] },
    { data: { app: {} } },
  ),

  /* ── safety refusals ────────────────────────────────────────────────────────────────────── */
  C('render.safety.javascript-href', 'a javascript: URL is refused, literal or computed; an ordinary one stays', {
    type: 'Column',
    children: [
      { type: 'a', props: { href: 'javascript:alert(1)' }, children: ['literal'] },
      { type: 'a', props: { href: { $: "'JavaScript:' + 'void(0)'" } }, children: ['computed'] },
      { type: 'we-link', props: { href: ' javascript:alert(1)' }, children: ['element'] },
      { type: 'a', props: { href: 'https://example.org/' }, children: ['fine'] },
    ],
  }),
  C('render.safety.srcdoc', 'srcdoc is refused on any element', {
    type: 'Column',
    children: [
      { type: 'we-iframe', props: { srcdoc: '<script>alert(1)</script>', title: 'kept' } },
      { type: 'div', props: { srcdoc: '<b>x</b>', class: 'kept' } },
    ],
  }),
  C('render.safety.native-tags', 'script, iframe and svg are refused as native tags: nothing is mounted', {
    type: 'Column',
    children: [
      { type: 'script', children: ['alert(1)'] },
      { type: 'iframe', props: { src: 'https://example.org/' } },
      { type: 'svg', children: [{ type: 'circle' }] },
      text('after'),
    ],
  }),
  C(
    'render.safety.gesture-refused',
    'a write wired to an event nobody causes does not run; the same write on a press does',
    {
      type: 'Column',
      children: [
        {
          type: 'we-image',
          props: {
            'data-case': 'img',
            onLoad: [{ $invoke: 'act.loaded' }, { $invoke: 'record.create', args: ['Post', { title: 'on load' }] }],
          },
        },
        button('press', { $invoke: 'record.create', args: ['Post', { title: 'on press' }] }),
      ],
    },
    {
      actions: { 'act.loaded': { returns: null }, 'record.create': { returns: 'id' } },
      gated: ['record.create'],
      steps: [
        { op: 'emit', target: 'img', event: 'load' },
        { op: 'click', target: 'press' },
      ],
    },
  ),
  C(
    'render.safety.gesture-continuation',
    'onSuccess counts as part of the press that started it, so a write there runs',
    {
      type: 'Column',
      children: [
        button('press', {
          $invoke: 'act.lookup',
          onSuccess: [{ $invoke: 'record.create', args: ['Post', { title: { $: 'result' } }] }],
        }),
      ],
    },
    {
      actions: { 'act.lookup': { resolve: 'found' }, 'record.create': { returns: 'id' } },
      gated: ['record.create'],
      steps: [{ op: 'click', target: 'press' }],
    },
  ),
];
