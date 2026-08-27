/**
 * Integration Tests Template
 *
 * Visual test suite exercising every schema token. Each section describes
 * what it tests and shows a pass/fail indicator where self-verifiable,
 * or a visual confirmation area for interactive/structural tests.
 *
 * Groups:
 *   1. Data Access     — $store, $concat
 *   2. Actions         — $action, $arg
 *   3. Operators       — $eq, $ne, $not, $and, $or
 *   4. Control Flow    — $if, $each (flat, nested, empty)
 *   5. Data Transforms — $map (array, object), $pick (standalone, chained)
 *   6. Queries         — $query (one-shot, subscription, filtering)
 *   7. Local State      — $localState, $local, $setLocal
 *   8. Form Validation  — $error, $valid, $touched, $formValid, $touch, $resetLocal
 *   9. Rendering        — children tokens, WC reactive props, composition, fragments
 *  10. Theming          — parametric overrides, named themes
 *
 * Data source: testStore (SolidJS signals + lazy AD4M perspective)
 */

import type { RouteSchema, SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

/** Base path when mounted under the testing template */
export const tokensBasePath = '/tokens';

// ---------------------------------------------------------------------------
// Helpers — reusable test section building blocks
// ---------------------------------------------------------------------------

/** Section card wrapper */
function section(token: string, title: string, children: (SchemaNode | string)[]): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '300', p: '400', bg: 'surface-sunken', r: '400', ax: 'start' },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', pb: '200' },
        children: [
          { type: 'we-text', props: { fontWeight: '600', color: 'accent-text' }, children: [token] },
          { type: 'we-text', props: { color: 'text-muted' }, children: [`- ${title}`] },
        ],
      },
      ...children,
    ],
  };
}

/** Auto-verified assertion: [✓/✗] label — expected "X" → actual */
function check(label: string, expected: string, actual: SchemaProp, condition: SchemaProp): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '300', ay: 'center', py: '50' },
    children: [
      {
        type: '$if',
        props: {
          condition,
          then: { type: 'we-icon', props: { name: 'check', size: 'xs', color: 'success-text' } },
          else: { type: 'we-icon', props: { name: 'x', size: 'xs', color: 'danger-text' } },
        },
      },
      { type: 'we-text', children: [label] },
      { type: 'we-text', props: { color: 'text-faint' }, children: [`expected "${expected}"`] },
      { type: 'we-text', props: { color: 'text-faint' }, children: ['→'] },
      { type: 'we-text', children: [actual as string] },
    ],
  };
}

/** Boolean assertion: [✓/✗] label */
function boolCheck(label: string, condition: SchemaProp): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '300', ay: 'center', py: '50' },
    children: [
      {
        type: '$if',
        props: {
          condition,
          then: { type: 'we-icon', props: { name: 'check', size: 'xs', color: 'success-text' } },
          else: { type: 'we-icon', props: { name: 'x', size: 'xs', color: 'danger-text' } },
        },
      },
      { type: 'we-text', children: [label] },
    ],
  };
}

/** Interactive test label (no auto-verify) */
function interactiveLabel(label: string): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '200', ay: 'center', py: '50' },
    children: [
      { type: 'we-icon', props: { name: 'arrow-clockwise', size: 'xs', color: 'accent-text' } },
      { type: 'we-text', children: [label] },
    ],
  };
}

/** Group heading for organizing related test sections */
function groupHeading(title: string): SchemaNode {
  return {
    type: 'we-text',
    props: { fontSize: '600', fontWeight: '600', color: 'text-muted', mt: '300' },
    children: [title],
  };
}

/** Helper: filter mode button */
function filterModeButton(mode: string, label: string, icon: string): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: expr`testStore.queryFilterMode == ${mode} ? 'primary' : 'secondary'`,
      onClick: { $action: 'testStore.setQueryFilterMode', args: [mode] },
    },
    children: [{ type: 'we-icon', props: { name: icon } }, label],
  };
}

/** Helper: a query mode panel — only visible when queryFilterMode matches */
function queryModePanel(mode: string, description: string, queryConfig: Record<string, unknown>): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: expr`testStore.queryFilterMode == ${mode}`,
      then: {
        type: 'Column',
        props: { gap: '300', ax: 'start' },
        children: [
          { type: 'we-text', props: { color: 'text-muted' }, children: [description] },
          {
            type: '$each',
            props: {
              items: {
                $query: {
                  entity: 'TestItem',
                  dataset: 'testStore.perspective',
                  subscribe: false,
                  ...queryConfig,
                },
              },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'surface-sunken', r: '300', ay: 'center' },
                children: [
                  { type: 'we-icon', props: { name: 'check', color: 'success-text', size: 'xs' } },
                  { type: 'we-text', props: { flex: '1' }, children: [`$q.name`] },
                  { type: 'we-text', props: { color: 'text-faint' }, children: [`$q.status`] },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Data Access — $store, $concat
// ---------------------------------------------------------------------------

const storeTest = section('store reads', 'Read values from the store', [
  check('String value', 'hello', { $: 'testStore.stringValue' }, { $: "testStore.stringValue == 'hello'" }),
  check('Number value', '42', { $: 'testStore.numberValue' }, { $: 'testStore.numberValue == 42' }),
  check('Boolean true', 'true', { $: 'testStore.boolTrue' }, { $: 'testStore.boolTrue' }),
  check(
    'Deep nested (3+ levels)',
    'deep-value',
    { $: 'testStore.nested.level1.level2.value' },
    { $: "testStore.nested.level1.level2.value == 'deep-value'" },
  ),
]);

const concatTest = section('interpolation', 'Concatenate strings and store values', [
  check(
    'String + string',
    'hello world',
    { $: '`${testStore.stringValue} world`' },
    { $: "`${testStore.stringValue} world` == 'hello world'" },
  ),
  check(
    'String + number',
    'Count: 42',
    { $: '`Count: ${testStore.numberValue}`' },
    { $: "`Count: ${testStore.numberValue}` == 'Count: 42'" },
  ),
  check(
    'Boolean coercion',
    'Active: true',
    { $: '`Active: ${testStore.boolTrue}`' },
    { $: "`Active: ${testStore.boolTrue}` == 'Active: true'" },
  ),
]);

// ---------------------------------------------------------------------------
// 2. Actions — $action, $arg
// ---------------------------------------------------------------------------

const actionTest = section('$action', 'Trigger store mutations', [
  interactiveLabel('Click button — counter should increment'),
  {
    type: 'Row',
    props: { gap: '300', ay: 'center' },
    children: [
      {
        type: 'we-button',
        props: { size: 'sm', onClick: { $action: 'testStore.increment' } },
        children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Increment'],
      },
      { type: 'we-text', children: ['Counter:'] },
      {
        type: 'we-text',
        props: { color: 'accent-text' },
        children: [{ $: 'testStore.counter' }],
      },
    ],
  },
]);

const argTest = section('$arg', 'Extract native event values', [
  interactiveLabel('Type text — it should echo below'),
  {
    type: 'Row',
    props: { gap: '300', ay: 'center' },
    children: [
      {
        type: 'we-input',
        props: {
          placeholder: 'Type here...',
          onInput: { $action: 'testStore.setTypedText', args: [{ $: 'arg.detail' }] },
        },
      },
      { type: 'we-text', props: { color: 'text-faint' }, children: ['Echo:'] },
      { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'testStore.typedText' }] },
    ],
  },
]);

// ---------------------------------------------------------------------------
// 3. Operators — $eq, $ne, $not, $and, $or
// ---------------------------------------------------------------------------

const eqTest = section('==', 'Equality comparison', [
  boolCheck('$eq("same", "same") → true', { $: "'same' == 'same'" }),
  boolCheck('$eq("same", "different") → false', { $: "!('same' == 'different')" }),
  boolCheck('$eq($store, "hello") → true', { $: "testStore.stringValue == 'hello'" }),
  boolCheck('$eq($store, 42) → true', { $: 'testStore.numberValue == 42' }),
]);

const neTest = section('!=', 'Not-equal comparison', [
  boolCheck('$ne("a", "b") → true', { $: "'a' != 'b'" }),
  boolCheck('$ne("same", "same") → false', { $: "!('same' != 'same')" }),
]);

const inTest = section('in', 'Set membership — value in array', [
  boolCheck('$in("hello", ["hello", "world"]) → true', { $: "'hello' in ['hello', 'world']" }),
  boolCheck('$in("missing", ["hello", "world"]) → false', { $: "!('missing' in ['hello', 'world'])" }),
  boolCheck('$in($store.stringValue, ["hello", "world"]) → true', { $: "testStore.stringValue in ['hello', 'world']" }),
  boolCheck('$in($store.numberValue, [1, 42, 100]) → true', { $: 'testStore.numberValue in [1, 42, 100]' }),
  boolCheck('$in("hello", "not-an-array") → false (non-array second operand)', { $: "!('hello' in 'not-an-array')" }),
]);

const notTest = section('!', 'Boolean negation', [
  boolCheck('$not(false) → true', { $: '!testStore.boolFalse' }),
  boolCheck('$not(true) → false', { $: '!!testStore.boolTrue' }),
]);

const andTest = section('&&', 'Logical AND', [
  boolCheck('$and(true, true) → true', { $: 'testStore.boolTrue && testStore.boolTrue' }),
  boolCheck('$and(true, false) → false', { $: '!(testStore.boolTrue && testStore.boolFalse)' }),
  boolCheck('$and(true, true, true) → true', { $: 'testStore.boolTrue && testStore.boolTrue && testStore.boolTrue' }),
  boolCheck('$and(true, true, false) → false', {
    $: '!(testStore.boolTrue && testStore.boolTrue && testStore.boolFalse)',
  }),
]);

const orTest = section('||', 'Logical OR', [
  boolCheck('$or(false, true) → true', { $: 'testStore.boolFalse || testStore.boolTrue' }),
  boolCheck('$or(false, false) → false', { $: '!(testStore.boolFalse || testStore.boolFalse)' }),
  boolCheck('$or(false, false, true) → true', {
    $: 'testStore.boolFalse || testStore.boolFalse || testStore.boolTrue',
  }),
  boolCheck('$or(false, false, false) → false', {
    $: '!(testStore.boolFalse || testStore.boolFalse || testStore.boolFalse)',
  }),
]);

// ---------------------------------------------------------------------------
// 4. Control Flow — $if, $each
// ---------------------------------------------------------------------------

const ifTest = section('$if', 'Conditional rendering (prop + node level)', [
  // Prop-level: button variant changes based on toggle
  interactiveLabel('Toggle — button variant should switch between "primary" and "ghost"'),
  {
    type: 'Row',
    props: { gap: '300', ay: 'center' },
    children: [
      {
        type: 'we-button',
        props: { variant: 'outline', onClick: { $action: 'testStore.toggle' } },
        children: ['Toggle'],
      },
      {
        type: 'we-button',
        props: { variant: { $: "testStore.toggleValue ? 'primary' : 'ghost'" } },
        children: [{ $: "testStore.toggleValue ? 'ON' : 'OFF'" }],
      },
      { type: 'we-text', props: { color: 'text-faint' }, children: ['(prop-level $if)'] },
    ],
  },
  // Node-level: conditionally show/hide content
  interactiveLabel('Node-level — "Visible!" should appear only when toggled ON'),
  {
    type: '$if',
    props: {
      condition: { $: 'testStore.toggleValue' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'success-surface', r: '300' },
        children: [
          { type: 'we-icon', props: { name: 'check', color: 'success-text' } },
          { type: 'we-text', props: { color: 'success-text' }, children: ['Visible!'] },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'surface-sunken', r: '300' },
        children: [
          { type: 'we-icon', props: { name: 'eye-slash', color: 'text-faint' } },
          { type: 'we-text', props: { color: 'text-faint' }, children: ['Hidden (toggle ON to show)'] },
        ],
      },
    },
  },
  // $if with enter/exit transitions (fade animation)
  interactiveLabel('With transitions — content fades in/out on toggle'),
  {
    type: '$if',
    props: {
      condition: { $: 'testStore.toggleValue' },
      enterTransition: { type: 'fade', duration: 1000, easing: 'ease-in-out' },
      exitTransition: { type: 'fade', duration: 1000, easing: 'ease-in-out' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'accent-muted', r: '300' },
        children: [
          { type: 'we-icon', props: { name: 'sparkle', color: 'accent' } },
          {
            type: 'we-text',
            props: { color: 'accent-text' },
            children: ['Animated content (fade in 1000ms / out 1000ms)'],
          },
        ],
      },
    },
  },
]);

const eachTest = section('$each', 'Iterate a list', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Rendering testStore.fruits'],
  },
  {
    type: 'we-text',
    props: { color: 'text-muted' },
    children: ['Expect 4 items'],
  },
  {
    type: 'Row',
    props: { gap: '200' },
    children: [
      {
        type: '$each',
        props: { items: { $: 'testStore.fruits' } },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center', p: '200', bg: 'surface-sunken', r: '300' },
            children: [
              { type: 'we-text', children: [{ $: 'item.emoji' }] },
              { type: 'we-text', children: [{ $: 'item.name' }] },
              { type: 'we-text', props: { color: 'text-faint' }, children: [{ $: 'item.color' }] },
            ],
          },
        ],
      },
    ],
  },
  boolCheck('Item count is 4', { $: 'testStore.fruitCount == 4' }),
]);

const eachEmptyTest = section('$each (empty)', 'Iterate an empty list — should render nothing', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Rendering testStore.emptyList — no items should appear below:'],
  },
  {
    type: 'Column',
    props: { gap: '200', p: '200', bg: 'surface-sunken', r: '300' },
    children: [
      {
        type: '$each',
        props: { items: { $: 'testStore.emptyList' } },
        children: [{ type: 'we-text', props: { color: 'danger-text' }, children: ['BUG: This should not render!'] }],
      },
      {
        type: 'we-text',
        props: { color: 'text-faint' },
        children: ['(If nothing else appears above this line, the test passes)'],
      },
    ],
  },
]);

const nestedEachTest = section('Nested $each', 'Iterate nested lists (groups → items)', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Rendering testStore.groups'],
  },
  {
    type: 'we-text',
    props: { color: 'text-muted' },
    children: ['Expect 2 groups with 2 items each'],
  },
  {
    type: 'Column',
    props: { gap: '300', width: '100%' },
    children: [
      {
        type: '$each',
        props: { items: { $: 'testStore.groups' }, as: 'group' },
        children: [
          {
            type: 'Column',
            props: { gap: '200', p: '300', bg: 'surface-sunken', r: '300' },
            children: [
              { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 'group.name' }] },
              {
                type: '$each',
                props: { items: { $: 'group.items' }, as: 'sub' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', pl: '300' },
                    children: [
                      { type: 'we-text', props: { color: 'text-muted' }, children: ['•'] },
                      { type: 'we-text', children: [{ $: 'sub.label' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// 5. Data Transforms — $map, $pick
// ---------------------------------------------------------------------------

const mapTest = section('map comprehension', 'Transform list items via a projection', [
  { type: 'we-text', props: { color: 'text-faint' }, children: ['$map remaps {key,value} → {label,detail}'] },
  {
    type: 'we-text',
    props: { color: 'text-muted' },
    children: ['Expect 3 rows: Language (TypeScript), Framework (SolidJS), Version (2.0)'],
  },
  {
    type: 'Column',
    props: { gap: '200', ax: 'start' },
    children: [
      {
        type: '$each',
        props: {
          items: { $: 'testStore.properties.map(item, { label: item.key, detail: item.value })' },
          as: 'row',
        },
        children: [
          {
            type: 'Row',
            props: { gap: '200', p: '200', bg: 'surface-sunken', r: '300' },
            children: [
              { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 'row.label' }] },
              { type: 'we-text', children: [{ $: 'row.detail' }] },
            ],
          },
        ],
      },
    ],
  },
]);

const pickTest = section('pick()', 'Extract property subset from object', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['$pick extracts { name, status } from fullObject { name, status, category, secret }'],
  },
  {
    type: 'we-text',
    props: { color: 'text-muted' },
    children: ['Expect "Picked: Test Item (active)" below, and no errors about missing properties'],
  },
  {
    type: 'Row',
    props: { gap: '200', p: '200', bg: 'surface-sunken', r: '300' },
    children: [
      { type: 'we-text', props: { color: 'text-faint' }, children: ['Picked:'] },
      {
        type: 'we-text',
        children: [{ $: '`${testStore.fullObject.name} (${testStore.fullObject.status})`' }],
      },
    ],
  },
]);

const pickChainingTest = section('pick() + interpolation', 'Chain pick() output into an interpolation', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['$concat reading from $pick-extracted properties:'],
  },
  check(
    'Picked name + status',
    'Test Item is active',
    { $: '`${testStore.fullObject.name} is ${testStore.fullObject.status}`' },
    { $: "`${testStore.fullObject.name} is ${testStore.fullObject.status}` == 'Test Item is active'" },
  ),
]);

// ---------------------------------------------------------------------------
// 6. Queries — $query
// ---------------------------------------------------------------------------

const queryOneShotTest = section('$query (one-shot)', 'FindAll $query without subscription', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['$query with subscribe: false — fetches once, no live updates:'],
  },
  {
    type: '$if',
    props: {
      condition: { $: 'testStore.perspective' },
      then: {
        type: 'Column',
        props: { gap: '200', ax: 'start' },
        children: [
          {
            type: '$each',
            props: {
              items: { $query: { entity: 'TestItem', dataset: 'testStore.perspective', subscribe: false } },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'surface-sunken', r: '300' },
                children: [
                  { type: 'we-icon', props: { name: 'check', color: 'success-text', size: 'xs' } },
                  { type: 'we-text', children: [{ $: 'q.name' }] },
                  { type: 'we-text', props: { color: 'text-faint' }, children: ['(one-shot)'] },
                ],
              },
            ],
          },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', p: '200', bg: 'warning-surface', r: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'clock', color: 'warning-text' } },
          {
            type: 'we-text',
            props: { color: 'warning-text' },
            children: ['Waiting for AD4M perspective...'],
          },
        ],
      },
    },
  },
]);

const querySubscriptionTest = section('$query (subscription)', 'FindAll $query with subscription', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Subscribes to TestItem models in we-test perspective (requires AD4M):'],
  },
  {
    type: 'we-text',
    props: { color: 'text-muted' },
    children: ['Expect 3 seed rows + any dynamically created items. Click "Add item" and verify it appears.'],
  },
  {
    type: '$if',
    props: {
      condition: { $: 'testStore.perspective' },
      then: {
        type: 'Column',
        props: { gap: '300', ax: 'start' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              {
                type: 'we-button',
                props: { variant: 'primary', onClick: { $action: 'testStore.createTestItem' } },
                children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add item'],
              },
              {
                type: 'we-text',
                props: { color: 'text-faint' },
                children: ['New item should appear below if subscription is working'],
              },
            ],
          },
          {
            type: '$each',
            props: {
              items: { $query: { entity: 'TestItem', dataset: 'testStore.perspective', subscribe: true } },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'surface-sunken', r: '300', ay: 'center' },
                children: [
                  { type: 'we-icon', props: { name: 'check', color: 'success-text', size: 'xs' } },
                  { type: 'we-text', props: { flex: '1' }, children: [{ $: 'q.name' }] },
                  { type: 'we-text', props: { color: 'text-faint' }, children: [{ $: 'q.status' }] },
                  {
                    type: 'we-button',
                    props: {
                      variant: 'secondary',
                      size: 'xs', // TODO: not having any effect
                      onClick: { $action: 'testStore.deleteTestItem', args: [{ $: 'q.id' }] },
                    },
                    children: [{ type: 'we-icon', props: { name: 'x', color: 'text-muted', size: 'xs' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', p: '200', bg: 'warning-surface', r: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'clock', color: 'warning-text' } },
          { type: 'we-text', props: { color: 'warning-text' }, children: ['Waiting for AD4M perspective...'] },
        ],
      },
    },
  },
]);

const queryFilteringTest = section('$query (filtering)', 'Query with where, order, limit, offset', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Toggle between query filter modes — each applies different $query params:'],
  },
  {
    type: '$if',
    props: {
      condition: { $: 'testStore.perspective' },
      then: {
        type: 'Column',
        props: { gap: '300' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', wrap: true },
            children: [
              filterModeButton('all', 'All', 'list'),
              filterModeButton('active', 'Active only', 'funnel'),
              filterModeButton('asc', 'ASC', 'sort-ascending'),
              filterModeButton('desc', 'DESC', 'sort-descending'),
              filterModeButton('limit', 'Limit', 'scissors'),
              filterModeButton('paginated', 'Paginate', 'cards-three'),
            ],
          },
          queryModePanel('all', 'No filters — showing all items:', {}),
          queryModePanel('active', 'where: { status: "active" } — only active items:', { where: { status: 'active' } }),
          queryModePanel('asc', 'order: { createdAt: "ASC" } — oldest first:', { order: { createdAt: 'ASC' } }),
          queryModePanel('desc', 'order: { createdAt: "DESC" } — newest first:', { order: { createdAt: 'DESC' } }),
          queryModePanel('limit', 'limit: 2 — at most 2 items:', { limit: 2 }),
          queryModePanel('paginated', 'limit: 2, offset: 1 — skip first, take next 2:', { limit: 2, offset: 1 }),
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', p: '200', bg: 'warning-surface', r: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'clock', color: 'warning-text' } },
          {
            type: 'we-text',
            props: { color: 'warning-text' },
            children: ['Waiting for AD4M perspective...'],
          },
        ],
      },
    },
  },
]);

// ---------------------------------------------------------------------------
// 7. Local State — $localState, $local, $setLocal
// ---------------------------------------------------------------------------

const localStateBasicTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '400', ax: 'start' },
  $localState: {
    name: { type: 'string', initial: '' },
    count: { type: 'number', initial: 0 },
    enabled: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', pb: '200' },
      children: [
        { type: 'we-text', props: { fontWeight: '600', color: 'accent-text' }, children: ['$localState'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['- Scoped ephemeral state'] },
      ],
    },
    // --- $local read + $setLocal write ---
    interactiveLabel('Type text — it should echo below via $local (no store)'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Type here...',
            value: { $: 'local.name' },
            onInput: { $setLocal: 'name', value: { $: 'event.detail' } },
          },
        },
        { type: 'we-text', props: { color: 'text-faint' }, children: ['Echo:'] },
        { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'local.name' }] },
      ],
    },
    // --- $local in $action args ---
    interactiveLabel('Click increment then "Log name" — testStore.setTypedText receives $local value'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            onClick: { $action: 'testStore.setTypedText', args: [{ $: 'local.name' }] },
          },
          children: ['Log name'],
        },
        { type: 'we-text', props: { color: 'text-faint' }, children: ['testStore.typedText:'] },
        { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'testStore.typedText' }] },
      ],
    },
    // --- $local with toggle ($setLocal boolean) ---
    interactiveLabel('Toggle switch — text should appear/disappear via $local boolean'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-switch',
          props: { checked: { $: 'local.enabled' }, onChange: { $setLocal: 'enabled', value: { $: 'event.detail' } } },
        },
        {
          type: '$if',
          props: {
            condition: { $: 'local.enabled' },
            then: { type: 'we-text', props: { color: 'success-text', fontWeight: '600' }, children: ['Enabled!'] },
            else: { type: 'we-text', props: { color: 'text-faint' }, children: ['Disabled'] },
          },
        },
      ],
    },
    // --- $local composed with $not, $concat, $if ---
    interactiveLabel('Composition: button disabled when name is empty, label built with $concat'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'primary', disabled: { $: '!local.name' } },
          children: [{ $: "`Submit: ${local.name ? local.name : '(empty)'}`" }],
        },
        {
          type: 'we-text',
          props: { color: 'text-faint' },
          children: ['(disabled when name is empty, label shows $local value)'],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 8. Form Validation — $error, $valid, $touched, $formValid, $touch, $resetLocal
// ---------------------------------------------------------------------------

/** Form validation: basic field errors, touch gating, $valid, $formValid */
const formValidationBasicTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '400', ax: 'start' },
  $localState: {
    username: {
      type: 'string',
      initial: '',
      validate: [
        { rule: 'required', message: 'Username is required' },
        { rule: 'minLength', value: 3, message: 'At least 3 characters' },
      ],
    },
    email: {
      type: 'string',
      initial: '',
      validate: [{ rule: 'required' }, { rule: 'pattern', value: '^[^@]+@[^@]+$', message: 'Invalid email format' }],
    },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', pb: '200' },
      children: [
        { type: 'we-text', props: { fontWeight: '600', color: 'accent-text' }, children: ['$error / $valid'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['- Field validation with touch gating'] },
      ],
    },
    // --- Username field with $error ---
    interactiveLabel(
      'Type < 3 chars and blur (click or tab outside input) — error appears. Type 3+ chars — error clears.',
    ),
    {
      type: 'we-form-field',
      props: { label: 'Username', error: { $: "error('username')" } },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Enter username...',
            value: { $: 'local.username' },
            onInput: { $setLocal: 'username', value: { $: 'event.detail' } },
            onBlur: { $touch: 'username' },
          },
        },
      ],
    },
    // --- Email field with $error ---
    interactiveLabel('Enter invalid email and blur — pattern error. Fix it — clears.'),
    {
      type: 'we-form-field',
      props: { label: 'Email', error: { $: "error('email')" } },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Enter email...',
            value: { $: 'local.email' },
            onInput: { $setLocal: 'email', value: { $: 'event.detail' } },
            onBlur: { $touch: 'email' },
          },
        },
      ],
    },
    // --- $valid indicators ---
    interactiveLabel('$valid reflects real-time state (even before touch)'),
    {
      type: 'Row',
      props: { gap: '400', ay: 'center' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { color: 'text-faint' }, children: ['username $valid:'] },
            {
              type: '$if',
              props: {
                condition: { $: "valid('username')" },
                then: { type: 'we-icon', props: { name: 'check-circle', color: 'success-text', size: 'xs' } },
                else: { type: 'we-icon', props: { name: 'x-circle', color: 'danger-text', size: 'xs' } },
              },
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { color: 'text-faint' }, children: ['email $valid:'] },
            {
              type: '$if',
              props: {
                condition: { $: "valid('email')" },
                then: { type: 'we-icon', props: { name: 'check-circle', color: 'success-text', size: 'xs' } },
                else: { type: 'we-icon', props: { name: 'x-circle', color: 'danger-text', size: 'xs' } },
              },
            },
          ],
        },
      ],
    },
    // --- $touched indicators ---
    interactiveLabel('$touched turns true after blur'),
    {
      type: 'Row',
      props: { gap: '400', ay: 'center' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { color: 'text-faint' }, children: ['username $touched:'] },
            {
              type: '$if',
              props: {
                condition: { $: "touched('username')" },
                then: { type: 'we-text', props: { color: 'success-text', fontWeight: '600' }, children: ['true'] },
                else: { type: 'we-text', props: { color: 'text-faint' }, children: ['false'] },
              },
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { color: 'text-faint' }, children: ['email $touched:'] },
            {
              type: '$if',
              props: {
                condition: { $: "touched('email')" },
                then: { type: 'we-text', props: { color: 'success-text', fontWeight: '600' }, children: ['true'] },
                else: { type: 'we-text', props: { color: 'text-faint' }, children: ['false'] },
              },
            },
          ],
        },
      ],
    },
    // --- formValid(): submit button ---
    interactiveLabel('Button enables only when both fields pass validation'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            disabled: { $: '!formValid()' },
            onClick: {
              $action: 'testStore.setTypedText',
              args: [{ $: '`${local.username} / ${local.email}`' }],
            },
          },
          children: ['Submit (disabled until valid)'],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'formValid()' },
            then: { type: 'we-text', props: { color: 'success-text' }, children: ['Form valid ✓'] },
            else: { type: 'we-text', props: { color: 'danger-text' }, children: ['Form invalid ✗'] },
          },
        },
      ],
    },
  ],
};

/** Form validation: $touch "$all", handler arrays, $resetLocal */
const formValidationActionsTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '400', ax: 'start' },
  $localState: {
    firstName: { type: 'string', initial: '', validate: [{ rule: 'required' }] },
    lastName: { type: 'string', initial: '', validate: [{ rule: 'required' }] },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', pb: '200' },
      children: [
        { type: 'we-text', props: { fontWeight: '600', color: 'accent-text' }, children: ['$touch / $resetLocal'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['- Touch all, reset, and handler arrays'] },
      ],
    },
    // --- Two fields ---
    {
      type: 'Row',
      props: { gap: '300', ay: 'start' },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'First name', error: { $: "error('firstName')" } },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'First...',
                value: { $: 'local.firstName' },
                onInput: { $setLocal: 'firstName', value: { $: 'event.detail' } },
                onBlur: { $touch: 'firstName' },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Last name', error: { $: "error('lastName')" } },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'Last...',
                value: { $: 'local.lastName' },
                onInput: { $setLocal: 'lastName', value: { $: 'event.detail' } },
                onBlur: { $touch: 'lastName' },
              },
            },
          ],
        },
      ],
    },
    // --- $touch "$all" button ---
    interactiveLabel('Click "Touch All" — both fields show errors (without blurring)'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-button', props: { variant: 'secondary', onClick: { $touch: '$all' } }, children: ['Touch All'] },
      ],
    },
    // --- Handler array: touch-all-then-submit pattern ---
    interactiveLabel('Click "Submit" — touches all fields, then fires action only if valid'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            onClick: [
              { $touch: '$all' },
              {
                $if: {
                  condition: { $: 'formValid()' },
                  then: {
                    $action: 'testStore.setTypedText',
                    args: [{ $: '`${local.firstName} ${local.lastName}`' }],
                  },
                },
              },
            ],
          },
          children: ['Submit (touch + guard)'],
        },
        { type: 'we-text', props: { color: 'text-faint' }, children: ['typedText:'] },
        { type: 'we-text', props: { fontWeight: '600' }, children: [{ $: 'testStore.typedText' }] },
      ],
    },
    // --- $resetLocal ---
    interactiveLabel('Click "Reset" — clears values and touched state'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'secondary', onClick: { $resetLocal: '$scope' } },
          children: ['Reset'],
        },
        // --- Handler array: submit then reset ---
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            disabled: { $: '!formValid()' },
            onClick: [
              {
                $action: 'testStore.setTypedText',
                args: [{ $: '`${local.firstName} ${local.lastName}`' }],
              },
              { $resetLocal: '$scope' },
            ],
          },
          children: ['Submit + Reset'],
        },
      ],
    },
  ],
};

/** Form validation: cross-field match rule (password confirmation) */
const formValidationMatchTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '400', ax: 'start' },
  $localState: {
    password: {
      type: 'string',
      initial: '',
      validate: [
        { rule: 'required' },
        { rule: 'minLength', value: 8, message: 'Password must be at least 8 characters' },
      ],
    },
    confirmPassword: {
      type: 'string',
      initial: '',
      validate: [{ rule: 'required' }, { rule: 'match', field: 'password', message: 'Passwords must match' }],
    },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', pb: '200' },
      children: [
        { type: 'we-text', props: { fontWeight: '600', color: 'accent-text' }, children: ['match rule'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['- Cross-field password confirmation'] },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Password', error: { $: "error('password')" } },
      children: [
        {
          type: 'we-input',
          props: {
            type: 'password',
            placeholder: 'Enter password...',
            value: { $: 'local.password' },
            onInput: { $setLocal: 'password', value: { $: 'event.detail' } },
            onBlur: { $touch: 'password' },
          },
        },
      ],
    },
    {
      type: 'we-form-field',
      props: { label: 'Confirm password', error: { $: "error('confirmPassword')" } },
      children: [
        {
          type: 'we-input',
          props: {
            type: 'password',
            placeholder: 'Confirm password...',
            value: { $: 'local.confirmPassword' },
            onInput: { $setLocal: 'confirmPassword', value: { $: 'event.detail' } },
            onBlur: { $touch: 'confirmPassword' },
          },
        },
      ],
    },
    interactiveLabel('Type different passwords, blur both — "Passwords must match" appears on confirm'),
    interactiveLabel('Make them match — error clears reactively'),
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'primary',
            disabled: { $: '!formValid()' },
            onClick: [
              { $touch: '$all' },
              {
                $if: {
                  condition: { $: 'formValid()' },
                  then: { $action: 'testStore.setTypedText', args: ['Password set!'] },
                },
              },
            ],
          },
          children: ['Set Password'],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'formValid()' },
            then: { type: 'we-text', props: { color: 'success-text' }, children: ['Passwords match ✓'] },
            else: { type: 'we-text', props: { color: 'danger-text' }, children: ['Form invalid ✗'] },
          },
        },
      ],
    },
  ],
};

/** Form validation: conditional styling based on touched + valid state */
const formValidationStylingTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '400', ax: 'start' },
  $localState: {
    age: {
      type: 'number',
      initial: 0,
      validate: [
        { rule: 'required' },
        { rule: 'min', value: 18, message: 'Must be at least 18' },
        { rule: 'max', value: 120, message: 'Must be at most 120' },
      ],
    },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', pb: '200' },
      children: [
        { type: 'we-text', props: { fontWeight: '600', color: 'accent-text' }, children: ['Conditional styling'] },
        {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: ['- min/max rules + $touched + $valid composition'],
        },
      ],
    },
    interactiveLabel('Background changes when touched + invalid: red; touched + valid: green'),
    {
      type: 'Column',
      props: {
        p: '300',
        r: '300',
        bg: { $: "touched('age') ? valid('age') ? 'success-surface' : 'danger-surface' : 'page'" },
      },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'Age (18–120)', error: { $: "error('age')" } },
          children: [
            {
              type: 'we-input',
              props: {
                type: 'number',
                placeholder: 'Enter age...',
                value: { $: 'local.age' },
                onInput: { $setLocal: 'age', value: { $: 'event.detail' } },
                onBlur: { $touch: 'age' },
              },
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 9. Rendering — children tokens, WC props, composition, fragments
// ---------------------------------------------------------------------------

const childrenTokenTest = section('Children expressions', 'Expressions resolved directly in children arrays', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Tests the renderChildren token resolution added for $store/$concat in children:'],
  },
  check('$store in children', 'hello', { $: 'testStore.stringValue' }, { $: "testStore.stringValue == 'hello'" }),
  check(
    '$concat in children',
    'hello world',
    { $: '`${testStore.stringValue} world`' },
    { $: "`${testStore.stringValue} world` == 'hello world'" },
  ),
  // Context reference in $each children
  {
    type: 'we-text',
    props: { color: 'text-faint', pt: '100' },
    children: ['$item references in children via $each. Expect list of fruits below:'],
  },
  {
    type: 'Row',
    props: { gap: '200' },
    children: [
      {
        type: '$each',
        props: { items: { $: 'testStore.fruits' } },
        children: [
          { type: 'we-text', props: { p: '100', bg: 'surface-sunken', r: '200' }, children: [{ $: 'item.name' }] },
        ],
      },
    ],
  },
]);

const wcReactivePropsTest = section('WC reactive props', 'Web component props update reactively', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Web component with reactive $store prop — color should change on toggle:'],
  },
  interactiveLabel('Toggle to switch text color between success-600 and danger-600'),
  {
    type: 'we-button',
    props: { variant: 'secondary', onClick: { $action: 'testStore.toggle' } },
    children: ['Toggle'],
  },
  {
    type: 'we-text',
    props: {
      fontWeight: '600',
      fontSize: '500',
      color: { $: "testStore.toggleValue ? 'success-text' : 'danger-text'" },
    },
    children: [{ $: "testStore.toggleValue ? 'Green text (toggled ON)' : 'Red text (toggled OFF)'" }],
  },
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Web component with reactive $store prop — button variant reacts to toggle:'],
  },
  {
    type: 'we-button',
    props: { variant: { $: "testStore.toggleValue ? 'primary' : 'outline'" } },
    children: [{ $: "`Variant: ${testStore.toggleValue ? 'primary' : 'outline'}`" }],
  },
]);

const tokenCompositionTest = section('Expression composition', 'Deeply nested expressions', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['Tests that tokens compose correctly when nested 3-4 levels deep:'],
  },
  // $if condition is $and of $eq of $store values, then is $concat of $store results
  boolCheck('$if($and($eq($store, "hello"), $not(false))) → true', {
    $: "testStore.stringValue == 'hello' && !testStore.boolFalse",
  }),
  check(
    '$concat with nested $if',
    'Status: active',
    { $: "`Status: ${testStore.boolTrue ? testStore.fullObject.status : 'unknown'}`" },
    { $: "`Status: ${testStore.boolTrue ? testStore.fullObject.status : 'unknown'}` == 'Status: active'" },
  ),
  // $or wrapping $eq checks
  boolCheck('$or($eq($store, "wrong"), $eq($store, 42)) → true', {
    $: "testStore.stringValue == 'wrong' || testStore.numberValue == 42",
  }),
]);

const fragmentTest = section('Fragment (no type)', 'Node without type renders as fragment', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['A node with no type renders its children inline (fragment). Expect two texts below:'],
  },
  {
    children: [
      { type: 'we-text', props: { color: 'accent-text' }, children: ['Fragment child 1 (Primary)'] },
      { type: 'we-text', props: { color: 'success-text' }, children: ['Fragment child 2 (Green)'] },
    ],
  } as SchemaNode,
]);

const fragmentThemeTest = section('Fragment + theme', 'Themeable fragment wraps children in theme div', [
  {
    type: 'we-text',
    props: { color: 'text-faint' },
    children: ['A fragment with theme overrides wraps children in a themed div:'],
  },
  {
    theme: { primaryHue: 234, saturation: 80 },
    children: [
      { type: 'we-text', props: { color: 'accent' }, children: ['Fragment themed child (should be blue-ish)'] },
    ],
  } as SchemaNode,
]);

// ---------------------------------------------------------------------------
// 10. Theming — parametric, named
// ---------------------------------------------------------------------------

const tokenThemeTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', r: '400', bg: 'surface-sunken', border: '1px solid var(--we-role-accent-muted)' },
  // Apply theme overrides to this section
  theme: { primaryHue: 344, saturation: 90 },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-text', props: { color: 'accent', fontWeight: '600' }, children: ['Theme (parametric)'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['—'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['Scoped CSS variable overrides'] },
      ],
    },
    {
      type: 'we-text',
      props: { color: 'text-faint' },
      children: ['This section has primaryHue: 344 (pink) — the "primary" colors below should appear pink:'],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-button', props: { variant: 'primary' }, children: ['Primary Button'] },
        { type: 'we-text', props: { color: 'accent' }, children: ['Primary Text'] },
      ],
    },
  ],
};

const namedThemeTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', r: '400', bg: 'surface-sunken', border: '1px solid var(--we-role-accent-muted)' },
  theme: { themeName: 'cyberpunk' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-text', props: { color: 'accent', fontWeight: '600' }, children: ['Theme (named)'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['—'] },
        { type: 'we-text', props: { color: 'text-muted' }, children: ['Named theme via data-we-theme attribute'] },
      ],
    },
    {
      type: 'we-text',
      props: { color: 'text-faint' },
      children: ['This section has themeName: "cyberpunk" — sets data-we-theme="cyberpunk" on the wrapper:'],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-button', props: { variant: 'primary' }, children: ['Cyberpunk Theme Button'] },
        { type: 'we-text', props: { color: 'accent' }, children: ['Cyberpunk Theme Text'] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Route groups — each group becomes a sub-route page
// ---------------------------------------------------------------------------

const groups: { key: string; label: string; path: string; children: SchemaNode[] }[] = [
  { key: 'data-access', label: 'Data Access', path: '/data-access', children: [storeTest, concatTest] },
  { key: 'actions', label: 'Actions', path: '/actions', children: [actionTest, argTest] },
  {
    key: 'operators',
    label: 'Operators',
    path: '/operators',
    children: [eqTest, neTest, inTest, notTest, andTest, orTest],
  },
  {
    key: 'control-flow',
    label: 'Control Flow',
    path: '/control-flow',
    children: [ifTest, eachTest, eachEmptyTest, nestedEachTest],
  },
  {
    key: 'data-transforms',
    label: 'Data Transforms',
    path: '/data-transforms',
    children: [mapTest, pickTest, pickChainingTest],
  },
  {
    key: 'queries',
    label: 'Queries',
    path: '/queries',
    children: [queryOneShotTest, querySubscriptionTest, queryFilteringTest],
  },
  { key: 'local-state', label: 'Local State', path: '/local-state', children: [localStateBasicTest] },
  {
    key: 'form-validation',
    label: 'Form Validation',
    path: '/form-validation',
    children: [formValidationBasicTest, formValidationActionsTest, formValidationMatchTest, formValidationStylingTest],
  },
  {
    key: 'rendering',
    label: 'Rendering',
    path: '/rendering',
    children: [childrenTokenTest, wcReactivePropsTest, tokenCompositionTest, fragmentTest, fragmentThemeTest],
  },
  { key: 'theming', label: 'Theming', path: '/theming', children: [tokenThemeTest, namedThemeTest] },
];

/** Build a route node for a group */
function groupRoute(group: (typeof groups)[number]): RouteSchema {
  return {
    path: group.path,
    type: 'Column',
    props: { gap: '400' },
    children: [groupHeading(group.label), ...group.children],
  };
}

/** Build a nav tab for a group */
function navTab(group: (typeof groups)[number]): SchemaNode {
  const navPath = tokensBasePath + group.path;
  const isActive = expr`routeStore.currentPath == ${navPath}`;

  return {
    type: 'we-button',
    props: {
      variant: expr`${isActive} ? 'primary' : 'secondary'`,
      onClick: { $action: 'routeStore.navigate', args: [navPath] },
    },
    children: [group.label],
  };
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const schemaTokensTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Tokens',
    description: 'Visual test suite for all schema tokens',
    icon: 'test-tube',
    stores: ['testStore'],
  },
  type: 'Column',
  props: { minHeight: '100%', width: '100%', bg: 'page' },
  children: [
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '700', fontWeight: '700', color: 'accent-text' },
          children: ['Token Integration Tests'],
        },
        {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: ['Visual test suite — each section exercises a specific token'],
        },
        { type: 'Row', props: { gap: '200', wrap: true, py: '200' }, children: groups.map(navTab) },
        { type: 'we-divider' },
      ],
    },
    { type: '$routes' },
  ],
  routes: [{ path: '/', redirect: '/data-access' }, ...groups.map(groupRoute)],
};
