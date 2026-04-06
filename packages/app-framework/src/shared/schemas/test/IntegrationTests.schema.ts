/**
 * Integration Tests Template
 *
 * Visual test suite exercising every schema token. Each section describes
 * what it tests and shows a pass/fail indicator where self-verifiable,
 * or a visual confirmation area for interactive/structural tests.
 *
 * Tokens covered:
 *   $store, $concat, $action, $arg, $eq, $ne, $not, $and, $or,
 *   $if (prop + node), $each, nested $each, $map, $pick, $query,
 *   theme overrides, web components, children token resolution
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
    props: { gap: '300', p: '400', bg: 'neutral-0', r: '400' },
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
          then: { type: 'we-text', props: { color: 'success-600' }, children: ['✓'] },
          else: { type: 'we-text', props: { color: 'danger-600' }, children: ['✗'] },
        },
      },
      { type: 'we-text', props: { style: { 'min-width': '140px' } }, children: [label] },
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
          then: { type: 'we-text', props: { color: 'success-600' }, children: ['✓'] },
          else: { type: 'we-text', props: { color: 'danger-600' }, children: ['✗'] },
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
      { type: 'we-text', props: { color: 'primary-500' }, children: ['⟳'] },
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
]);

const orTest = section('$or', 'Logical OR', [
  boolCheck('$or(false, true) → true', { $or: [{ $store: 'testStore.boolFalse' }, { $store: 'testStore.boolTrue' }] }),
  boolCheck('$or(false, false) → false (inverted)', {
    $not: { $or: [{ $store: 'testStore.boolFalse' }, { $store: 'testStore.boolFalse' }] },
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
    props: { gap: '200' },
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

const queryTest = section('$query', 'Reactive AD4M perspective subscription', [
  {
    type: 'we-text',
    props: { color: 'neutral-400' },
    children: ['Subscribes to TestItem models in __we_test__ perspective (requires AD4M):'],
  },
  {
    type: 'we-text',
    props: { color: 'neutral-600' },
    children: ['Expect 3 rows: Alpha (active), Beta (draft), Gamma (active)'],
  },
  {
    type: '$if',
    props: {
      condition: { $store: 'testStore.perspective' },
      then: {
        type: 'Column',
        props: { gap: '200' },
        children: [
          {
            type: '$each',
            props: {
              items: { $query: { model: 'TestItem', perspectiveStore: 'testStore.perspective', subscribe: true } },
              as: 'q',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', p: '200', bg: 'neutral-50', r: '300' },
                children: [
                  { type: 'we-text', children: ['$q.name'] },
                  { type: 'we-text', props: { color: 'neutral-400' }, children: ['$q.status'] },
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

const themeTest: SchemaNode = {
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
          children: ['Theme'],
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

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const header: SchemaNode = {
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
};

// ---------------------------------------------------------------------------
// Full template
// ---------------------------------------------------------------------------

export const integrationTestsTemplate: TemplateSchema = {
  meta: {
    name: 'Integration Tests',
    description: 'Visual test suite for all schema tokens',
    icon: 'test-tube',
  },
  type: 'Column',
  props: { minHeight: '100%', width: '100%', p: '500', bg: 'neutral-50' },
  children: [
    header,
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
        nestedEachTest,
        mapTest,

        groupHeading('Advanced'),
        pickTest,
        queryTest,
        childrenTokenTest,
        themeTest,
      ],
    },
  ],
  routes: [
    { path: '/', type: 'Column' },
    { path: '*', type: 'Column' },
  ],
};
