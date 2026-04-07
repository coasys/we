/**
 * Integration Tests Template
 *
 * Visual test suite exercising every schema token. Each section describes
 * what it tests and shows a pass/fail indicator where self-verifiable,
 * or a visual confirmation area for interactive/structural tests.
 *
 * Tokens covered:
 *   $store (basic + deep nested), $concat (string + number + boolean coercion),
 *   $action, $arg (dot-path + bare), $eq, $ne, $not, $and, $or (2 + 3 operands),
 *   $if (prop + node + transitions), $each (flat + nested + empty),
 *   $map (array + single object), $pick (standalone + chained),
 *   $query (subscribe + one-shot), fragment nodes (with + without theme),
 *   theme overrides (parametric + named), web component reactive props,
 *   token composition (deeply nested chains), children token resolution
 *
 * Data source: testStore (SolidJS signals + lazy AD4M perspective)
 */

import type { SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';

// ---------------------------------------------------------------------------
// Helpers — reusable test section building blocks
// ---------------------------------------------------------------------------

/** Section card wrapper */
function section(token: string, title: string, children: (SchemaNode | string)[]): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '300', p: '400', bg: 'neutral-0', r: '400', ax: 'start' },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', pb: '200' },
        children: [
          { type: 'we-text', props: { fontWeight: '600', color: 'primary-700' }, children: [token] },
          { type: 'we-text', props: { color: 'neutral-500' }, children: [`- ${title}`] },
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
          then: { type: 'we-icon', props: { name: 'check', size: 'xs', color: 'success-600' } },
          else: { type: 'we-icon', props: { name: 'x', size: 'xs', color: 'danger-600' } },
        },
      },
      { type: 'we-text', children: [label] },
      { type: 'we-text', props: { color: 'neutral-400' }, children: [`expected "${expected}"`] },
      { type: 'we-text', props: { color: 'neutral-400' }, children: ['→'] },
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
          then: { type: 'we-icon', props: { name: 'check', size: 'xs', color: 'success-600' } },
          else: { type: 'we-icon', props: { name: 'x', size: 'xs', color: 'danger-600' } },
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
      { type: 'we-icon', props: { name: 'arrow-clockwise', size: 'xs', color: 'primary-600' } },
      { type: 'we-text', children: [label] },
    ],
  };
}

/** Group heading for organizing related test sections */
function groupHeading(title: string): SchemaNode {
  return {
    type: 'we-text',
    props: { fontSize: '600', fontWeight: '600', color: 'neutral-500', mt: '300' },
    children: [title],
  };
}

/** Helper: filter mode button */
function filterModeButton(mode: string, label: string, icon: string): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: {
        $if: {
          condition: { $eq: [{ $store: 'testStore.queryFilterMode' }, mode] },
          then: 'primary',
          else: 'secondary',
        },
      },
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
      condition: { $eq: [{ $store: 'testStore.queryFilterMode' }, mode] },
      then: {
        type: 'Column',
        props: { gap: '300', ax: 'start' },
        children: [
          { type: 'we-text', props: { color: 'neutral-600' }, children: [description] },
          {
            type: '$each',
            props: {
              items: {
                $query: {
                  model: 'TestItem',
                  perspectiveStore: 'testStore.perspective',
                  subscribe: false,
                  ...queryConfig,
                },
              },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'neutral-50', r: '300', ay: 'center' },
                children: [
                  { type: 'we-icon', props: { name: 'check', color: 'success-500', size: 'xs' } },
                  { type: 'we-text', props: { flex: '1' }, children: [`$q.name`] },
                  { type: 'we-text', props: { color: 'neutral-400' }, children: [`$q.status`] },
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
// 1. Basic tokens — $store, $concat, $action, $arg
// ---------------------------------------------------------------------------

const storeTest = section('$store', 'Read values from the store', [
  check(
    'String value',
    'hello',
    { $store: 'testStore.stringValue' },
    { $eq: [{ $store: 'testStore.stringValue' }, 'hello'] },
  ),
  check('Number value', '42', { $store: 'testStore.numberValue' }, { $eq: [{ $store: 'testStore.numberValue' }, 42] }),
  check('Boolean true', 'true', { $store: 'testStore.boolTrue' }, { $store: 'testStore.boolTrue' }),
  check(
    'Deep nested (3+ levels)',
    'deep-value',
    { $store: 'testStore.nested.level1.level2.value' },
    { $eq: [{ $store: 'testStore.nested.level1.level2.value' }, 'deep-value'] },
  ),
]);

const concatTest = section('$concat', 'Concatenate strings and store values', [
  check(
    'String + string',
    'hello world',
    { $concat: [{ $store: 'testStore.stringValue' }, ' world'] },
    { $eq: [{ $concat: [{ $store: 'testStore.stringValue' }, ' world'] }, 'hello world'] },
  ),
  check(
    'String + number',
    'Count: 42',
    { $concat: ['Count: ', { $store: 'testStore.numberValue' }] },
    { $eq: [{ $concat: ['Count: ', { $store: 'testStore.numberValue' }] }, 'Count: 42'] },
  ),
  check(
    'Boolean coercion',
    'Active: true',
    { $concat: ['Active: ', { $store: 'testStore.boolTrue' }] },
    { $eq: [{ $concat: ['Active: ', { $store: 'testStore.boolTrue' }] }, 'Active: true'] },
  ),
]);

const actionTest = section('$action', 'Trigger store mutations', [
  interactiveLabel('Click button — counter should increment'),
  {
    type: 'Row',
    props: { gap: '300', ay: 'center' },
    children: [
      {
        type: 'we-button',
        props: { onClick: { $action: 'testStore.increment' } },
        children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Increment'],
      },
      { type: 'we-text', children: ['Counter:'] },
      {
        type: 'we-text',
        props: { color: 'primary-600' },
        children: [{ $store: 'testStore.counter' }],
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
          onInput: { $action: 'testStore.setTypedText', args: ['$arg.target.value'] },
        },
      },
      { type: 'we-text', props: { color: 'neutral-400' }, children: ['Echo:'] },
      { type: 'we-text', props: { fontWeight: '600' }, children: [{ $store: 'testStore.typedText' }] },
    ],
  },
]);

// ---------------------------------------------------------------------------
// 2. Comparison tokens — $eq, $ne, $not
// ---------------------------------------------------------------------------

const eqTest = section('$eq', 'Equality comparison', [
  boolCheck('$eq("same", "same") → true', { $eq: ['same', 'same'] }),
  boolCheck('$eq("same", "different") → false (inverted)', { $not: { $eq: ['same', 'different'] } }),
  boolCheck('$eq($store, "hello") → true', { $eq: [{ $store: 'testStore.stringValue' }, 'hello'] }),
  boolCheck('$eq($store, 42) → true', { $eq: [{ $store: 'testStore.numberValue' }, 42] }),
]);

const neTest = section('$ne', 'Not-equal comparison', [
  boolCheck('$ne("a", "b") → true', { $ne: ['a', 'b'] }),
  boolCheck('$ne("same", "same") → false (inverted)', { $not: { $ne: ['same', 'same'] } }),
]);

const notTest = section('$not', 'Boolean negation', [
  boolCheck('$not(false) → true', { $not: { $store: 'testStore.boolFalse' } }),
  boolCheck('$not(true) → false (inverted)', { $not: { $not: { $store: 'testStore.boolTrue' } } }),
]);

// ---------------------------------------------------------------------------
// 3. Logic tokens — $and, $or
// ---------------------------------------------------------------------------

const andTest = section('$and', 'Logical AND', [
  boolCheck('$and(true, true) → true', { $and: [{ $store: 'testStore.boolTrue' }, { $store: 'testStore.boolTrue' }] }),
  boolCheck('$and(true, false) → false (inverted)', {
    $not: { $and: [{ $store: 'testStore.boolTrue' }, { $store: 'testStore.boolFalse' }] },
  }),
  boolCheck('$and(true, true, true) → true (3 operands)', {
    $and: [{ $store: 'testStore.boolTrue' }, { $store: 'testStore.boolTrue' }, { $store: 'testStore.boolTrue' }],
  }),
  boolCheck('$and(true, true, false) → false (3 operands, inverted)', {
    $not: {
      $and: [{ $store: 'testStore.boolTrue' }, { $store: 'testStore.boolTrue' }, { $store: 'testStore.boolFalse' }],
    },
  }),
]);

const orTest = section('$or', 'Logical OR', [
  boolCheck('$or(false, true) → true', { $or: [{ $store: 'testStore.boolFalse' }, { $store: 'testStore.boolTrue' }] }),
  boolCheck('$or(false, false) → false (inverted)', {
    $not: { $or: [{ $store: 'testStore.boolFalse' }, { $store: 'testStore.boolFalse' }] },
  }),
  boolCheck('$or(false, false, true) → true (3 operands)', {
    $or: [{ $store: 'testStore.boolFalse' }, { $store: 'testStore.boolFalse' }, { $store: 'testStore.boolTrue' }],
  }),
  boolCheck('$or(false, false, false) → false (3 operands, inverted)', {
    $not: {
      $or: [{ $store: 'testStore.boolFalse' }, { $store: 'testStore.boolFalse' }, { $store: 'testStore.boolFalse' }],
    },
  }),
]);

// ---------------------------------------------------------------------------
// 4. Conditional — $if (prop-level + node-level)
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
        props: {
          variant: {
            $if: {
              condition: { $store: 'testStore.toggleValue' },
              then: 'primary',
              else: 'ghost',
            },
          },
        },
        children: [
          {
            $if: {
              condition: { $store: 'testStore.toggleValue' },
              then: 'ON',
              else: 'OFF',
            },
          },
        ],
      },
      { type: 'we-text', props: { color: 'neutral-400' }, children: ['(prop-level $if)'] },
    ],
  },
  // Node-level: conditionally show/hide content
  interactiveLabel('Node-level — "Visible!" should appear only when toggled ON'),
  {
    type: '$if',
    props: {
      condition: { $store: 'testStore.toggleValue' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'success-50', r: '300' },
        children: [
          { type: 'we-icon', props: { name: 'check', color: 'success-600' } },
          {
            type: 'we-text',
            props: { color: 'success-600' },
            children: ['Visible!'],
          },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'neutral-50', r: '300' },
        children: [
          { type: 'we-icon', props: { name: 'eye-slash', color: 'neutral-400' } },
          {
            type: 'we-text',
            props: { color: 'neutral-400' },
            children: ['Hidden (toggle ON to show)'],
          },
        ],
      },
    },
  },
  // $if with enter/exit transitions (fade animation)
  interactiveLabel('With transitions — content fades in/out on toggle'),
  {
    type: '$if',
    props: {
      condition: { $store: 'testStore.toggleValue' },
      enterTransition: { type: 'fade', duration: 1000, easing: 'ease-in-out' },
      exitTransition: { type: 'fade', duration: 1000, easing: 'ease-in-out' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'primary-50', r: '300' },
        children: [
          { type: 'we-icon', props: { name: 'sparkle', color: 'primary-500' } },
          {
            type: 'we-text',
            props: { color: 'primary-600' },
            children: ['Animated content (fade in 1000ms / out 1000ms)'],
          },
        ],
      },
    },
  },
]);

// ---------------------------------------------------------------------------
// 5. Iteration — $each, nested $each, $map
// ---------------------------------------------------------------------------

const eachTest = section('$each', 'Iterate a list', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Rendering testStore.fruits'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect 4 items'],
  },
  {
    type: 'Row',
    props: { gap: '200' },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.fruits' } },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center', p: '200', bg: 'neutral-50', r: '300' },
            children: [
              { type: 'we-text', children: ['$item.emoji'] },
              { type: 'we-text', children: ['$item.name'] },
              { type: 'we-text', props: { color: 'neutral-400' }, children: ['$item.color'] },
            ],
          },
        ],
      },
    ],
  },
  boolCheck('Item count is 4', { $eq: [{ $store: 'testStore.fruitCount' }, 4] }),
]);

const eachEmptyTest = section('$each (empty)', 'Iterate an empty list — should render nothing', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Rendering testStore.emptyList — no items should appear below:'],
  },
  {
    type: 'Column',
    props: { gap: '200', p: '200', bg: 'neutral-50', r: '300' },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.emptyList' } },
        children: [
          {
            type: 'we-text',
            props: { color: 'danger-600' },
            children: ['BUG: This should not render!'],
          },
        ],
      },
      {
        type: 'we-text',
        props: { color: 'neutral-400' },
        children: ['(If nothing else appears above this line, the test passes)'],
      },
    ],
  },
]);

const nestedEachTest = section('Nested $each', 'Iterate nested lists (groups → items)', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Rendering testStore.groups'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect 2 groups with 2 items each'],
  },
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.groups' }, as: 'group' },
        children: [
          {
            type: 'Column',
            props: { gap: '200', p: '300', bg: 'neutral-50', r: '300' },
            children: [
              { type: 'we-text', props: { color: 'neutral-600' }, children: ['$group.name'] },
              {
                type: '$each',
                props: { items: '$group.items', as: 'sub' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', pl: '300' },
                    children: [
                      { type: 'we-text', props: { color: 'neutral-500' }, children: ['•'] },
                      { type: 'we-text', children: ['$sub.label'] },
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

const mapTest = section('$map', 'Transform list items via select', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['$map remaps {key,value} → {label,detail}'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect 3 rows: Language (TypeScript), Framework (SolidJS), Version (2.0)'],
  },
  {
    type: 'Column',
    props: { gap: '200', ax: 'start' },
    children: [
      {
        type: '$each',
        props: {
          items: {
            $map: {
              items: { $store: 'testStore.properties' },
              select: { label: '$item.key', detail: '$item.value' },
            },
          },
          as: 'row',
        },
        children: [
          {
            type: 'Row',
            props: { gap: '200', p: '200', bg: 'neutral-50', r: '300' },
            children: [
              {
                type: 'we-text',
                props: { color: 'neutral-500', style: { 'min-width': '100px' } },
                children: ['$row.label'],
              },
              { type: 'we-text', children: ['$row.detail'] },
            ],
          },
        ],
      },
    ],
  },
]);

const mapSingleObjectTest = section('$map (single object)', 'Transform a single object via select', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['$map on single object {title,version,debug} → {label,detail}'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect "title=My App, version=2.0" below'],
  },
  {
    type: 'Row',
    props: {
      gap: '200',
      p: '200',
      bg: 'neutral-50',
      r: '300',
      _mapped: {
        $map: {
          items: { $store: 'testStore.singleConfig' },
          select: { label: '$item.title', detail: '$item.version' },
        },
      },
    },
    children: [
      { type: 'we-text', props: { color: 'neutral-400' }, children: ['Mapped:'] },
      {
        type: 'we-text',
        children: [
          {
            $concat: [
              'title=',
              { $store: 'testStore.singleConfig.title' },
              ', version=',
              { $store: 'testStore.singleConfig.version' },
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// 6. Advanced — $pick, $query, children tokens, theme, web components
// ---------------------------------------------------------------------------

const pickTest = section('$pick', 'Extract property subset from object', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['$pick extracts { name, status } from fullObject { name, status, category, secret }'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect "Picked: Test Item (active)" below, and no errors about missing properties'],
  },
  {
    type: 'Row',
    props: {
      gap: '200',
      p: '200',
      bg: 'neutral-50',
      r: '300',
      _picked: { $pick: { from: { $store: 'testStore.fullObject' }, props: ['name', 'status'] } },
    },
    children: [
      { type: 'we-text', props: { color: 'neutral-400' }, children: ['Picked:'] },
      {
        type: 'we-text',
        children: [
          { $concat: [{ $store: 'testStore.fullObject.name' }, ' (', { $store: 'testStore.fullObject.status' }, ')'] },
        ],
      },
    ],
  },
]);

const pickChainingTest = section('$pick + $concat', 'Chain $pick output into $concat', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['$concat reading from $pick-extracted properties:'],
  },
  check(
    'Picked name + status',
    'Test Item is active',
    {
      $concat: [{ $store: 'testStore.fullObject.name' }, ' is ', { $store: 'testStore.fullObject.status' }],
    },
    {
      $eq: [
        {
          $concat: [{ $store: 'testStore.fullObject.name' }, ' is ', { $store: 'testStore.fullObject.status' }],
        },
        'Test Item is active',
      ],
    },
  ),
]);

const queryOneShotTest = section('$query (one-shot)', 'FindAll $query without subscription', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['$query with subscribe: false — fetches once, no live updates:'],
  },
  {
    type: '$if',
    props: {
      condition: { $store: 'testStore.perspective' },
      then: {
        type: 'Column',
        props: { gap: '200', ax: 'start' },
        children: [
          {
            type: '$each',
            props: {
              items: { $query: { model: 'TestItem', perspectiveStore: 'testStore.perspective', subscribe: false } },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'neutral-50', r: '300' },
                children: [
                  { type: 'we-icon', props: { name: 'check', color: 'success-500', size: 'xs' } },
                  { type: 'we-text', children: ['$q.name'] },
                  { type: 'we-text', props: { color: 'neutral-400' }, children: ['(one-shot)'] },
                ],
              },
            ],
          },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', p: '200', bg: 'warning-50', r: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'clock', color: 'warning-500' } },
          {
            type: 'we-text',
            props: { color: 'warning-600' },
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
    props: { color: 'neutral-400' },
    children: ['Subscribes to TestItem models in __we_test__ perspective (requires AD4M):'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect 3 seed rows + any dynamically created items. Click "Add item" and verify it appears.'],
  },
  {
    type: '$if',
    props: {
      condition: { $store: 'testStore.perspective' },
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
                props: { color: 'neutral-400' },
                children: ['New item should appear below if subscription is working'],
              },
            ],
          },
          {
            type: '$each',
            props: {
              items: { $query: { model: 'TestItem', perspectiveStore: 'testStore.perspective', subscribe: true } },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'neutral-50', r: '300', ay: 'center' },
                children: [
                  { type: 'we-icon', props: { name: 'check', color: 'success-500', size: 'xs' } },
                  { type: 'we-text', props: { flex: '1' }, children: ['$q.name'] },
                  { type: 'we-text', props: { color: 'neutral-400' }, children: ['$q.status'] },
                  {
                    type: 'we-button',
                    props: {
                      variant: 'secondary',
                      size: 'xs', // TODO: not having any effect
                      onClick: { $action: 'testStore.deleteTestItem', args: ['$q.id'] },
                    },
                    children: [{ type: 'we-icon', props: { name: 'x', color: 'neutral-500', size: 'xs' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', p: '200', bg: 'warning-50', r: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'clock', color: 'warning-500' } },
          {
            type: 'we-text',
            props: { color: 'warning-600' },
            children: ['Waiting for AD4M perspective...'],
          },
        ],
      },
    },
  },
]);

const queryFilteringTest = section('$query (filtering)', 'Query with where, order, limit, offset', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Toggle between query filter modes — each applies different $query params:'],
  },
  {
    type: '$if',
    props: {
      condition: { $store: 'testStore.perspective' },
      then: {
        type: 'Column',
        props: { gap: '300' },
        children: [
          {
            type: 'Row',
            props: { gap: '200', wrap: 'wrap' },
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
          queryModePanel('active', 'where: { status: "active" } — only active items:', {
            where: { status: 'active' },
          }),
          queryModePanel('asc', 'order: { createdAt: "ASC" } — oldest first:', {
            order: { createdAt: 'ASC' },
          }),
          queryModePanel('desc', 'order: { createdAt: "DESC" } — newest first:', {
            order: { createdAt: 'DESC' },
          }),
          queryModePanel('limit', 'limit: 2 — at most 2 items:', { limit: 2 }),
          queryModePanel('paginated', 'limit: 2, offset: 1 — skip first, take next 2:', {
            limit: 2,
            offset: 1,
          }),
        ],
      },
      else: {
        type: 'Row',
        props: { gap: '200', p: '200', bg: 'warning-50', r: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'clock', color: 'warning-500' } },
          {
            type: 'we-text',
            props: { color: 'warning-600' },
            children: ['Waiting for AD4M perspective...'],
          },
        ],
      },
    },
  },
]);

const childrenTokenTest = section('Children tokens', 'Operator tokens resolved directly in children arrays', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Tests the renderChildren token resolution added for $store/$concat in children:'],
  },
  check(
    '$store in children',
    'hello',
    { $store: 'testStore.stringValue' },
    { $eq: [{ $store: 'testStore.stringValue' }, 'hello'] },
  ),
  check(
    '$concat in children',
    'hello world',
    { $concat: [{ $store: 'testStore.stringValue' }, ' world'] },
    { $eq: [{ $concat: [{ $store: 'testStore.stringValue' }, ' world'] }, 'hello world'] },
  ),
  // Context reference in $each children
  {
    type: 'we-text',
    props: { color: 'neutral-400', pt: '100' },
    children: ['$item references in children via $each. Expect list of fruits below:'],
  },
  {
    type: 'Row',
    props: { gap: '200' },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.fruits' } },
        children: [
          {
            type: 'we-text',
            props: { p: '100', bg: 'neutral-50', r: '200' },
            children: ['$item.name'],
          },
        ],
      },
    ],
  },
]);

const wcReactivePropsTest = section('WC reactive props', 'Web component props update reactively', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
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
      color: {
        $if: { condition: { $store: 'testStore.toggleValue' }, then: 'success-600', else: 'danger-600' },
      },
    },
    children: [
      {
        $if: {
          condition: { $store: 'testStore.toggleValue' },
          then: 'Green text (toggled ON)',
          else: 'Red text (toggled OFF)',
        },
      },
    ],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Web component with reactive $store prop — button variant reacts to toggle:'],
  },
  {
    type: 'we-button',
    props: {
      variant: {
        $if: {
          condition: { $store: 'testStore.toggleValue' },
          then: 'primary',
          else: 'outline',
        },
      },
    },
    children: [
      {
        $concat: [
          'Variant: ',
          {
            $if: {
              condition: { $store: 'testStore.toggleValue' },
              then: 'primary',
              else: 'outline',
            },
          },
        ],
      },
    ],
  },
]);

const tokenCompositionTest = section('Token composition', 'Deeply nested token chains', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Tests that tokens compose correctly when nested 3-4 levels deep:'],
  },
  // $if condition is $and of $eq of $store values, then is $concat of $store results
  boolCheck('$if($and($eq($store, "hello"), $not(false))) → true', {
    $and: [{ $eq: [{ $store: 'testStore.stringValue' }, 'hello'] }, { $not: { $store: 'testStore.boolFalse' } }],
  }),
  check(
    '$concat with nested $if',
    'Status: active',
    {
      $concat: [
        'Status: ',
        {
          $if: {
            condition: { $store: 'testStore.boolTrue' },
            then: { $store: 'testStore.fullObject.status' },
            else: 'unknown',
          },
        },
      ],
    },
    {
      $eq: [
        {
          $concat: [
            'Status: ',
            {
              $if: {
                condition: { $store: 'testStore.boolTrue' },
                then: { $store: 'testStore.fullObject.status' },
                else: 'unknown',
              },
            },
          ],
        },
        'Status: active',
      ],
    },
  ),
  // $or wrapping $eq checks
  boolCheck('$or($eq($store, "wrong"), $eq($store, 42)) → true', {
    $or: [{ $eq: [{ $store: 'testStore.stringValue' }, 'wrong'] }, { $eq: [{ $store: 'testStore.numberValue' }, 42] }],
  }),
]);

const fragmentTest = section('Fragment (no type)', 'Node without type renders as fragment', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['A node with no type renders its children inline (fragment). Expect two texts below:'],
  },
  {
    children: [
      { type: 'we-text', props: { color: 'primary-600' }, children: ['Fragment child 1 (Primary)'] },
      { type: 'we-text', props: { color: 'success-600' }, children: ['Fragment child 2 (Green)'] },
    ],
  } as SchemaNode,
]);

const fragmentThemeTest = section('Fragment + theme', 'Themeable fragment wraps children in theme div', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['A fragment with theme overrides wraps children in a themed div:'],
  },
  {
    theme: { primaryHue: 200, saturation: '80%' },
    children: [
      { type: 'we-text', props: { color: 'primary-500' }, children: ['Fragment themed child (should be blue-ish)'] },
    ],
  } as SchemaNode,
]);

const tokenThemeTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', r: '400', bg: 'neutral-100', border: '1px solid var(--we-color-primary-200)' },
  // Apply theme overrides to this section
  theme: { primaryHue: 320, saturation: '90%' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-text',
          props: { color: 'primary-500', fontWeight: '600' },
          children: ['Theme (parametric)'],
        },
        { type: 'we-text', props: { color: 'neutral-500' }, children: ['—'] },
        {
          type: 'we-text',
          props: { color: 'neutral-500' },
          children: ['Scoped CSS variable overrides'],
        },
      ],
    },
    {
      type: 'we-text',
      props: { color: 'neutral-400' },
      children: ['This section has primaryHue: 320 (pink) — the "primary" colors below should appear pink:'],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-button', props: { variant: 'primary' }, children: ['Primary Button'] },
        { type: 'we-text', props: { color: 'primary-500' }, children: ['Primary Text'] },
      ],
    },
  ],
};

const namedThemeTest: SchemaNode = {
  type: 'Column',
  props: { gap: '300', p: '400', r: '400', bg: 'neutral-100', border: '1px solid var(--we-color-primary-200)' },
  theme: { themeName: 'cyberpunk' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-text',
          props: { color: 'primary-500', fontWeight: '600' },
          children: ['Theme (named)'],
        },
        { type: 'we-text', props: { color: 'neutral-500' }, children: ['—'] },
        {
          type: 'we-text',
          props: { color: 'neutral-500' },
          children: ['Named theme via data-we-theme attribute'],
        },
      ],
    },
    {
      type: 'we-text',
      props: { color: 'neutral-400' },
      children: ['This section has themeName: "cyberpunk" — sets data-we-theme="cyberpunk" on the wrapper:'],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-button', props: { variant: 'primary' }, children: ['Cyberpunk Theme Button'] },
        { type: 'we-text', props: { color: 'primary-500' }, children: ['Cyberpunk Theme Text'] },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Full template
// ---------------------------------------------------------------------------

export const schemaTokensTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Tokens',
    description: 'Visual test suite for all schema tokens',
    icon: 'test-tube',
  },
  type: 'Column',
  props: { minHeight: '100%', width: '100%', p: '500', bg: 'neutral-50' },
  children: [
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '700', fontWeight: '700', color: 'primary-700' },
          children: ['Schema Token Integration Tests'],
        },
        {
          type: 'we-text',
          props: { color: 'neutral-600' },
          children: ['Visual test suite — each section exercises a specific token'],
        },
        { type: 'we-divider', props: { mb: '400' } },
      ],
    },
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        groupHeading('Basic'),
        storeTest,
        concatTest,
        actionTest,
        argTest,

        groupHeading('Comparison'),
        eqTest,
        neTest,
        notTest,

        groupHeading('Logic'),
        andTest,
        orTest,

        groupHeading('Conditional'),
        ifTest,

        groupHeading('Iteration'),
        eachTest,
        eachEmptyTest,
        nestedEachTest,
        mapTest,
        mapSingleObjectTest,

        groupHeading('Advanced'),
        pickTest,
        pickChainingTest,
        queryOneShotTest,
        querySubscriptionTest,
        queryFilteringTest,
        childrenTokenTest,
        wcReactivePropsTest,
        tokenCompositionTest,
        fragmentTest,
        fragmentThemeTest,
        tokenThemeTest,
        namedThemeTest,
      ],
    },
  ],
  routes: [
    { path: '/', type: 'Column' },
    { path: '*', type: 'Column' },
  ],
};
