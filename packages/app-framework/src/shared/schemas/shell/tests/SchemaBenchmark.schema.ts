/**
 * Schema Benchmark Template
 *
 * Performance benchmark suite for measuring schema renderer speed.
 * Each route stress-tests a different aspect of the rendering pipeline
 * and displays the measured render time.
 *
 * Routes:
 *   /                  — dashboard with results summary
 *   /static-small      — 50 static nodes (baseline)
 *   /static-large      — 200+ static nodes (scaling test)
 *   /tokens-light      — 50 nodes with 1-2 $store reads each
 *   /tokens-heavy      — 50 nodes with deeply composed tokens
 *   /each-flat         — $each with 100 items
 *   /each-nested       — nested $each (10 groups × 10 items)
 *   /web-components    — 100 web component nodes (we-text, we-button)
 *   /solid-components  — 100 Solid component nodes (Column, Row)
 *   /deep-nesting      — 30-level deep nesting
 *   /mixed-realistic   — ~70-node dashboard with representative token mix
 *
 * Timing: BenchmarkTimer component at end of each route captures
 * render time via onMount+rAF, passing it back via onComplete.
 */
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

/** Base path when mounted under the testing template */
export const benchmarkBasePath = '/benchmarks';

// ---------------------------------------------------------------------------
// Helpers — generate benchmark content programmatically
// ---------------------------------------------------------------------------

/** Timer placed at the end of each benchmark route.
 *  Records performance.now() at creation, measures to paint-complete via onMount+rAF. */
function timer(label: string): SchemaNode {
  return {
    type: 'BenchmarkTimer',
    props: {
      label,
      onComplete: { $action: 'testStore.benchRecordRender' },
    },
  };
}

/** Threshold-based color token: green < 100ms, warning 100-300ms, danger > 300ms */
function benchColor(storePath: string, shade: string): Record<string, unknown> {
  return {
    $if: {
      condition: { $lt: [{ $store: storePath }, 50] },
      then: `success-${shade}`,
      else: {
        $if: {
          condition: { $lt: [{ $store: storePath }, 150] },
          then: `warning-${shade}`,
          else: `danger-${shade}`,
        },
      },
    },
  };
}

/** A static card with N text props — no tokens */
function staticCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      bg: 'neutral-0',
      r: '300',
      border: '1px solid neutral-200',
    },
    children: [
      { type: 'we-text', props: { text: `Card ${id}`, fontSize: '400', fontWeight: '600', color: 'neutral-800' } },
      { type: 'we-text', props: { text: `Description for card number ${id}`, fontSize: '300', color: 'neutral-600' } },
      { type: 'we-text', props: { text: `Detail line ${id}`, fontSize: '200', color: 'neutral-400' } },
    ],
  };
}

/** A card that reads from $store for its values */
function tokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      bg: 'neutral-0',
      r: '300',
    },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          fontWeight: '600',
          color: 'neutral-800',
        },
        children: [{ $concat: ['Card ', { $store: 'testStore.stringValue' }, ` #${id}`] }],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '300',
          color: {
            $if: {
              condition: { $store: 'testStore.boolTrue' },
              then: 'neutral-600',
              else: 'danger-600',
            },
          },
        },
        children: [{ $concat: ['Count: ', { $store: 'testStore.numberValue' }] }],
      },
    ],
  };
}

/** A card with deeply composed tokens — $if($and($eq($store,…), $not(…))) */
function heavyTokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      bg: {
        $if: {
          condition: {
            $and: [
              { $eq: [{ $store: 'testStore.stringValue' }, 'hello'] },
              { $not: { $store: 'testStore.boolFalse' } },
            ],
          },
          then: 'neutral-0',
          else: 'danger-50',
        },
      },
      r: '300',
    },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          fontWeight: '600',
          color: {
            $if: {
              condition: {
                $or: [
                  { $eq: [{ $store: 'testStore.numberValue' }, 42] },
                  { $ne: [{ $store: 'testStore.stringValue' }, 'goodbye'] },
                ],
              },
              then: 'primary-700',
              else: 'danger-700',
            },
          },
        },
        children: [
          {
            $concat: [
              'Heavy #',
              `${id}`,
              ' — ',
              {
                $if: {
                  condition: { $store: 'testStore.boolTrue' },
                  then: { $store: 'testStore.stringValue' },
                  else: 'fallback',
                },
              },
            ],
          },
        ],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '300',
          color: 'neutral-500',
        },
        children: [
          {
            $concat: [
              'Status: ',
              {
                $if: {
                  condition: { $and: [{ $store: 'testStore.boolTrue' }, { $not: { $store: 'testStore.boolFalse' } }] },
                  then: 'active',
                  else: 'inactive',
                },
              },
              ' | Count: ',
              { $store: 'testStore.numberValue' },
            ],
          },
        ],
      },
    ],
  };
}

/** Build N levels of nesting: Column → Row → Column → Row → ... */
function deepNest(depth: number, current: number = 0): SchemaNode {
  const isColumn = current % 2 === 0;
  const child: SchemaNode =
    current >= depth
      ? { type: 'we-text', props: { text: `Depth ${current}`, fontSize: '200', color: 'primary-600' } }
      : deepNest(depth, current + 1);

  return {
    type: isColumn ? 'Column' : 'Row',
    props: { p: '100', gap: '100', ...(current === 0 ? { bg: 'neutral-0', r: '300' } : {}) },
    children: [{ type: 'we-text', props: { text: `Level ${current}`, fontSize: '200', color: 'neutral-400' } }, child],
  };
}

/** A static web component card (we-text, we-button) */
function wcCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '200', gap: '200', bg: 'neutral-0', r: '200' },
    children: [
      { type: 'we-text', props: { text: `WC ${id}`, fontSize: '300', color: 'neutral-700' } },
      { type: 'we-button', props: { text: `Action ${id}`, variant: 'outline', size: 'sm' } },
    ],
  };
}

/** A static Solid component card (Column, Row — no web components) */
function solidCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '200',
      gap: '100',
      bg: 'neutral-0',
      r: '200',
      border: '1px solid neutral-100',
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: 'Column', props: { width: '8px', height: '8px', r: 'full', bg: 'primary-400' } },
          {
            type: 'Column',
            children: [{ type: 'we-text', props: { text: `Solid ${id}`, fontSize: '300', color: 'neutral-700' } }],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Generate route content
// ---------------------------------------------------------------------------

function generateCards(count: number, factory: (id: number) => SchemaNode): SchemaNode[] {
  return Array.from({ length: count }, (_, i) => factory(i + 1));
}

/** Build a full benchmark route: Column wrapper + back button + timer + content */
function benchRoute(path: string, title: string, children: SchemaNode[]) {
  return {
    path,
    type: 'Column',
    props: { width: '100%', height: '100%', gap: '300', bg: 'neutral-50', overflow: 'auto' },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', pb: '300' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              onClick: { $action: 'routeStore.navigate', args: [benchmarkBasePath] },
            },
            children: [{ type: 'we-icon', props: { name: 'arrow-left', size: 'sm' } }],
          },
          { type: 'we-text', props: { text: title, fontSize: '600', fontWeight: '600', color: 'neutral-800' } },
        ],
      },
      // Last render time display
      {
        type: '$if',
        props: {
          condition: { $store: 'testStore.benchLastRender' },
          then: {
            type: 'Row',
            props: {
              gap: '200',
              ay: 'center',
              p: '200',
              bg: benchColor('testStore.benchLastRender', '100'),
              r: '300',
              mb: '300',
            },
            children: [
              {
                type: 'we-icon',
                props: { name: 'clock', color: benchColor('testStore.benchLastRender', '600'), size: 'sm' },
              },
              {
                type: 'we-text',
                props: { color: benchColor('testStore.benchLastRender', '700') },
                children: ['Render time:'],
              },
              {
                type: 'we-text',
                props: { color: benchColor('testStore.benchLastRender', '700'), fontWeight: '700' },
                children: [{ $concat: [{ $store: 'testStore.benchLastRender' }, 'ms'] }],
              },
            ],
          },
        },
      },
      ...children,
      timer(path.slice(1)),
    ],
  };
}

// ---------------------------------------------------------------------------
// Route: Static Small (50 cards)
// ---------------------------------------------------------------------------
const staticSmallRoute = benchRoute('/static-small', 'Static Small — 50 nodes', [
  {
    type: 'we-text',
    props: { text: '50 static cards, all string props, zero tokens', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
    },
    children: generateCards(50, staticCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Static Large (200 cards)
// ---------------------------------------------------------------------------
const staticLargeRoute = benchRoute('/static-large', 'Static Large — 200 nodes', [
  {
    type: 'we-text',
    props: {
      text: '200 static cards — tests scaling of static prop overhead',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' },
    },
    children: generateCards(200, staticCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Static Extreme (1000 cards)
// ---------------------------------------------------------------------------
const staticExtremeRoute = benchRoute('/static-extreme', 'Static Extreme — 1000 nodes', [
  {
    type: 'we-text',
    props: {
      text: '1000 static cards — tests scaling of static prop overhead',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' },
    },
    children: generateCards(1000, staticCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Tokens Light (50 cards with $store reads)
// ---------------------------------------------------------------------------
const tokensLightRoute = benchRoute('/tokens-light', 'Tokens Light — $store reads', [
  {
    type: 'we-text',
    props: { text: '50 cards each with 1-2 $store and $concat tokens', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
    },
    children: generateCards(50, tokenCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Tokens Heavy (50 cards with deeply composed tokens)
// ---------------------------------------------------------------------------
const tokensHeavyRoute = benchRoute('/tokens-heavy', 'Tokens Heavy — deep composition', [
  {
    type: 'we-text',
    props: {
      text: '50 cards each with $if($and($eq($store,…), $not(…))) chains',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' },
    },
    children: generateCards(50, heavyTokenCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: $each Flat (100 items)
// ---------------------------------------------------------------------------
const eachFlatRoute = benchRoute('/each-flat', '$each Flat — 100 items', [
  {
    type: 'we-text',
    props: { text: 'Single $each loop rendering 100 simple cards', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
    },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.benchList100' } },
        children: [
          {
            type: 'Column',
            props: { p: '300', gap: '100', bg: 'neutral-0', r: '300' },
            children: [
              { type: 'we-text', props: { color: 'neutral-700' }, children: ['$item.name'] },
              { type: 'we-text', props: { fontSize: '200', color: 'neutral-400' }, children: ['$item.category'] },
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Route: $each Nested (10 groups × 10 items)
// ---------------------------------------------------------------------------
const eachNestedRoute = benchRoute('/each-nested', 'Nested $each — 10×10', [
  {
    type: 'we-text',
    props: { text: '10 groups with 10 items each — tests context spreading', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.benchGroups' }, as: 'group' },
        children: [
          {
            type: 'Column',
            props: { p: '300', gap: '200', bg: 'neutral-0', r: '300' },
            children: [
              {
                type: 'we-text',
                props: { fontWeight: '600', color: 'neutral-700', fontSize: '400' },
                children: ['$group.name'],
              },
              {
                type: '$each',
                props: { items: '$group.items', as: 'sub' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', pl: '300', ay: 'center' },
                    children: [
                      { type: 'we-text', props: { color: 'neutral-400' }, children: ['•'] },
                      { type: 'we-text', props: { fontSize: '300' }, children: ['$sub.label'] },
                      {
                        type: 'we-text',
                        props: { fontSize: '200', color: 'neutral-400' },
                        children: ['$sub.detail'],
                      },
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
// Route: Web Components (100 we-text + we-button)
// ---------------------------------------------------------------------------
const wcRoute = benchRoute('/web-components', 'Web Components — 100 nodes', [
  {
    type: 'we-text',
    props: {
      text: '100 we-text + we-button pairs — isolates per-prop createEffect overhead',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' },
    },
    children: generateCards(100, wcCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Solid Components (100 Column + Row)
// ---------------------------------------------------------------------------
const solidRoute = benchRoute('/solid-components', 'Solid Components — 100 nodes', [
  {
    type: 'we-text',
    props: {
      text: '100 Column + Row nodes — same layout, reactive spread path',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' },
    },
    children: generateCards(100, solidCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Deep Nesting (30 levels)
// ---------------------------------------------------------------------------
const deepNestRoute = benchRoute('/deep-nesting', 'Deep Nesting — 30 levels', [
  {
    type: 'we-text',
    props: { text: 'Column → Row → Column chain, 30 levels deep', fontSize: '300', color: 'neutral-500' },
  },
  deepNest(30),
]);

// ---------------------------------------------------------------------------
// Route: Mixed Realistic (~70 nodes, representative token mix)
// ---------------------------------------------------------------------------
const mixedRealisticRoute = benchRoute('/mixed-realistic', 'Mixed Realistic — ~70 nodes', [
  {
    type: 'we-text',
    props: { text: 'Dashboard-like layout with representative token mix', fontSize: '300', color: 'neutral-500' },
  },
  // Welcome header with $store
  {
    type: 'Column',
    props: { width: '100%', p: '400', gap: '200', bg: 'neutral-0', r: '400' },
    children: [
      {
        type: 'we-text',
        props: { fontSize: '700', fontWeight: '600', color: 'neutral-900' },
        children: [{ $concat: ['Welcome, ', { $store: 'testStore.stringValue' }] }],
      },
      {
        type: 'we-text',
        props: { fontSize: '400', color: 'neutral-600' },
        children: [{ $concat: ['Counter: ', { $store: 'testStore.counter' }] }],
      },
    ],
  },
  // Stat cards — 4 static cards
  {
    type: 'Row',
    props: { width: '100%', gap: '300', wrap: true },
    children: [
      ...[
        { label: 'Active Spaces', value: '12', change: '+2 this week', color: 'primary-500' },
        { label: 'Messages', value: '24', change: '5 unread', color: 'blue-500' },
        { label: 'Quests', value: '7', change: '3 due', color: 'green-500' },
        { label: 'Notifications', value: '18', change: 'New today', color: 'orange-500' },
      ].map((stat) => ({
        type: 'Column',
        props: {
          flex: '1',
          minWidth: '160px',
          p: '400',
          gap: '200',
          bg: 'neutral-0',
          r: '400',
          borderLeft: `4px solid ${stat.color}`,
        },
        children: [
          { type: 'we-text', props: { text: stat.label, fontSize: '300', color: 'neutral-600' } },
          { type: 'we-text', props: { text: stat.value, fontSize: '800', fontWeight: '700', color: 'neutral-900' } },
          { type: 'we-text', props: { text: stat.change, fontSize: '300', color: stat.color } },
        ],
      })),
    ],
  },
  // Two column layout
  {
    type: 'Row',
    props: { width: '100%', gap: '400', ax: 'start' },
    children: [
      // Left — activity list with $each
      {
        type: 'Column',
        props: { flex: '2', gap: '300' },
        children: [
          {
            type: 'we-text',
            props: { text: 'Recent Activity', fontWeight: '600', color: 'neutral-800' },
          },
          {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: '$each',
                props: { items: { $store: 'testStore.fruits' } },
                children: [
                  {
                    type: 'Row',
                    props: { p: '300', gap: '300', bg: 'neutral-0', r: '300', ay: 'center' },
                    children: [
                      { type: 'we-text', children: ['$item.emoji'] },
                      {
                        type: 'Column',
                        props: { flex: '1', gap: '100' },
                        children: [
                          {
                            type: 'we-text',
                            props: { color: 'neutral-800' },
                            children: ['$item.name'],
                          },
                          {
                            type: 'we-text',
                            props: { fontSize: '200', color: 'neutral-500' },
                            children: ['$item.color'],
                          },
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
      // Right — quick actions + conditional content
      {
        type: 'Column',
        props: { flex: '1', gap: '300' },
        children: [
          {
            type: 'we-text',
            props: { text: 'Quick Actions', fontWeight: '600', color: 'neutral-800' },
          },
          {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: 'we-button',
                props: {
                  text: 'Toggle State',
                  variant: 'primary',
                  width: '100%',
                  onClick: { $action: 'testStore.toggle' },
                },
              },
              {
                type: 'we-button',
                props: {
                  text: 'Increment Counter',
                  variant: 'secondary',
                  width: '100%',
                  onClick: { $action: 'testStore.increment' },
                },
              },
              { type: 'we-button', props: { text: 'Action Three', variant: 'outline', width: '100%' } },
              { type: 'we-button', props: { text: 'Action Four', variant: 'ghost', width: '100%' } },
            ],
          },
          // Conditional section
          {
            type: '$if',
            props: {
              condition: { $store: 'testStore.toggleValue' },
              then: {
                type: 'Column',
                props: { p: '300', gap: '200', bg: 'success-50', r: '300' },
                children: [
                  { type: 'we-text', props: { fontWeight: '600', color: 'success-700' }, children: ['Toggle is ON'] },
                  {
                    type: 'we-text',
                    props: { fontSize: '300', color: 'success-600' },
                    children: ['This section appears conditionally'],
                  },
                ],
              },
              else: {
                type: 'Column',
                props: { p: '300', gap: '200', bg: 'neutral-100', r: '300' },
                children: [
                  {
                    type: 'we-text',
                    props: { fontWeight: '600', color: 'neutral-600' },
                    children: ['Toggle is OFF'],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '300', color: 'neutral-500' },
                    children: ['Toggle the state to show content'],
                  },
                ],
              },
            },
          },
          // Events list — static
          {
            type: 'Column',
            props: { gap: '300', pt: '200' },
            children: [
              {
                type: 'we-text',
                props: { text: 'Upcoming', fontWeight: '600', color: 'neutral-800' },
              },
              ...['Team Standup — 10:00 AM', 'Design Review — 2:00 PM', 'Sprint Planning — Friday'].map((event) => ({
                type: 'Column',
                props: { p: '300', bg: 'neutral-0', r: '300' },
                children: [{ type: 'we-text', props: { text: event, fontSize: '300', color: 'neutral-700' } }],
              })),
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Dashboard route — results summary + navigation
// ---------------------------------------------------------------------------
const benchmarkRoutes = [
  { path: '/static-small', key: 'static-small', label: 'Static Small (50)', nav: `${benchmarkBasePath}/static-small` },
  { path: '/static-large', key: 'static-large', label: 'Static Large (200)', nav: `${benchmarkBasePath}/static-large` },
  {
    path: '/static-extreme',
    key: 'static-extreme',
    label: 'Static Extreme (1000)',
    nav: `${benchmarkBasePath}/static-extreme`,
  },
  { path: '/tokens-light', key: 'tokens-light', label: 'Tokens Light', nav: `${benchmarkBasePath}/tokens-light` },
  { path: '/tokens-heavy', key: 'tokens-heavy', label: 'Tokens Heavy', nav: `${benchmarkBasePath}/tokens-heavy` },
  { path: '/each-flat', key: 'each-flat', label: '$each Flat (100)', nav: `${benchmarkBasePath}/each-flat` },
  { path: '/each-nested', key: 'each-nested', label: 'Nested $each (10×10)', nav: `${benchmarkBasePath}/each-nested` },
  {
    path: '/web-components',
    key: 'web-components',
    label: 'Web Components (100)',
    nav: `${benchmarkBasePath}/web-components`,
  },
  {
    path: '/solid-components',
    key: 'solid-components',
    label: 'Solid Components (100)',
    nav: `${benchmarkBasePath}/solid-components`,
  },
  { path: '/deep-nesting', key: 'deep-nesting', label: 'Deep Nesting (30)', nav: `${benchmarkBasePath}/deep-nesting` },
  {
    path: '/mixed-realistic',
    key: 'mixed-realistic',
    label: 'Mixed Realistic',
    nav: `${benchmarkBasePath}/mixed-realistic`,
  },
];

const dashboardRoute = {
  path: '/',
  type: 'Column',
  props: { width: '100%', height: '100%', gap: '400', bg: 'neutral-50', overflow: 'auto' },
  children: [
    // Header
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'we-text',
          props: { fontSize: '700', fontWeight: '700', color: 'primary-800' },
          children: ['Renderer Benchmarks'],
        },
        {
          type: 'we-text',
          props: { color: 'neutral-600' },
          children: ['Click a benchmark to run it. Times are measured from navigation to paint-complete.'],
        },
        // Action buttons
        {
          type: 'Row',
          props: { gap: '200', py: '200' },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Run All',
                variant: 'primary',
                gradient: true,
                onClick: { $action: 'testStore.benchRunAll' },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Clear All Results',
                variant: 'secondary',
                onClick: { $action: 'testStore.benchClearResults' },
              },
            },
          ],
        },
        { type: 'we-divider' },
      ],
    },
    // Benchmark navigation grid
    {
      type: 'Column',
      props: {
        gap: '200',
        styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' },
      },
      children: benchmarkRoutes.map((route) => ({
        type: 'Column',
        props: {
          p: '400',
          gap: '200',
          bg: 'neutral-0',
          r: '400',
          cursor: 'pointer',
          border: '1px solid neutral-200',
          hoverProps: { bg: 'primary-25', borderColor: 'primary-300' },
          onClick: { $action: 'routeStore.navigate', args: [route.nav] },
        },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center', ax: 'between', width: '100%' },
            children: [
              { type: 'we-text', props: { text: route.label, fontWeight: '600', color: 'neutral-800' } },
              {
                type: 'we-button',
                props: {
                  text: 'Run',
                  variant: 'primary',
                  size: 'sm',
                  onClick: { $action: 'routeStore.navigate', args: [route.nav] },
                },
              },
            ],
          },
          { type: 'we-text', props: { text: route.path, fontSize: '300', color: 'neutral-400' } },
          // Show last result for this route
          {
            type: '$if',
            props: {
              condition: { $store: `testStore.benchResults.${route.key}` },
              then: {
                type: 'Row',
                props: { gap: '200', ay: 'center', pt: '100' },
                children: [
                  {
                    type: 'we-text',
                    props: {
                      fontSize: '300',
                      fontWeight: '600',
                      color: benchColor(`testStore.benchResults.${route.key}`, '500'),
                    },
                    children: ['Last run:'],
                  },
                  {
                    type: 'we-text',
                    props: {
                      fontSize: '300',
                      fontWeight: '700',
                      color: benchColor(`testStore.benchResults.${route.key}`, '500'),
                    },
                    children: [{ $concat: [{ $store: `testStore.benchResults.${route.key}` }, 'ms'] }],
                  },
                ],
              },
            },
          },
        ],
      })),
    },
  ],
};

// ---------------------------------------------------------------------------
// Full template export
// ---------------------------------------------------------------------------
export const schemaBenchmarkTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Benchmark',
    description: 'Performance benchmark suite for schema renderer',
    icon: 'timer',
    stores: ['testStore'],
    components: ['BenchmarkTimer'],
  },
  type: 'Column',
  props: { width: '100%', height: '100%' },
  children: [{ type: '$routes' }],
  routes: [
    dashboardRoute,
    staticSmallRoute,
    staticLargeRoute,
    staticExtremeRoute,
    tokensLightRoute,
    tokensHeavyRoute,
    eachFlatRoute,
    eachNestedRoute,
    wcRoute,
    solidRoute,
    deepNestRoute,
    mixedRealisticRoute,
    {
      path: '*',
      type: 'Column',
      props: { p: '500' },
      children: [{ type: 'we-text', props: { text: 'Benchmark route not found' } }],
    },
  ],
};
