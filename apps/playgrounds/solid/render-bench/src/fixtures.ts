/**
 * Benchmark fixtures — the single definition of what gets rendered.
 *
 * Shared by the browser harness (`main.tsx`) and the headless benchmarks (`bench/`), so the two
 * cannot drift. They previously lived in two places and cross-referencing them was only valid by
 * convention.
 *
 * The ladder fixtures (`wcCards` plus the hand-written controls in `controls.tsx`) must all render
 * identical content. That equivalence is what makes the comparison mean anything, and it is
 * asserted in `tests/ladder.test.tsx` rather than left to reviewer discipline.
 */
import type { SchemaNode } from '@we/schema-shared';

/** Values the fixtures read through expressions. Plain data — this harness has no backend. */
export const benchStore = {
  stringValue: 'hello',
  numberValue: 42,
  boolTrue: true,
  boolFalse: false,
  counter: 0,
  fruits: [
    { name: 'Apple', color: 'red', emoji: '🍎' },
    { name: 'Banana', color: 'yellow', emoji: '🍌' },
    { name: 'Cherry', color: 'red', emoji: '🍒' },
    { name: 'Grape', color: 'purple', emoji: '🍇' },
  ],
  list100: Array.from({ length: 100 }, (_, i) => ({
    name: `Item ${i + 1}`,
    category: `Category ${String.fromCharCode(65 + (i % 5))}`,
  })),
  groups: Array.from({ length: 10 }, (_, g) => ({
    name: `Group ${g + 1}`,
    items: Array.from({ length: 10 }, (_, i) => ({
      label: `Item ${g * 10 + i + 1}`,
      detail: `detail-${g}-${i}`,
    })),
  })),
};

/**
 * Cards in each ladder rung. Shared with `controls.tsx` so the four rungs cannot drift in size.
 *
 * 400 rather than 100 because `total` is bounded below by the frame the double-`rAF` waits for
 * (~32ms on a 60Hz display). At 100 cards, three of the four rungs finished inside that budget and
 * reported identical totals despite one of them doing 17ms of JS work — the column could not
 * differentiate them at all. At 400 every rung clears the floor, so `total` means something again.
 */
export const LADDER_COUNT = 400;

/**
 * Posts in each realistic-ladder rung. 50 × 16 nodes ≈ 800 nodes, comparable in size to the simple
 * ladder's 400 × 3, so the two are measuring the same amount of work in different shapes.
 */
export const REALISTIC_COUNT = 50;

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const grid = (min: string, gap: string) => ({
  display: 'grid',
  'grid-template-columns': `repeat(auto-fill, minmax(${min}, 1fr))`,
  gap,
});

// ---------------------------------------------------------------------------
// Card factories
// ---------------------------------------------------------------------------

/** All-static props, no tokens — isolates the cost of walking and mounting. */
export function staticCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '300', gap: '200', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
    children: [
      { type: 'we-text', props: { text: `Card ${id}`, fontSize: '400', fontWeight: '600', color: 'neutral-800' } },
      { type: 'we-text', props: { text: `Description for card number ${id}`, fontSize: '300', color: 'neutral-600' } },
      { type: 'we-text', props: { text: `Detail line ${id}`, fontSize: '200', color: 'neutral-400' } },
    ],
  };
}

/** One or two store reads / interpolations per card. */
export function tokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '300', gap: '200', bg: 'neutral-0', r: '300' },
    children: [
      {
        type: 'we-text',
        props: { fontSize: '400', fontWeight: '600', color: 'neutral-800' },
        children: [{ $: `\`Card \${benchStore.stringValue} #${id}\`` }],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '300',
          color: { $: "benchStore.boolTrue ? 'neutral-600' : 'danger-600'" },
        },
        children: [{ $: '`Count: ${benchStore.numberValue}`' }],
      },
    ],
  };
}

/** Deeply composed expressions — a ternary over a conjunction of comparisons. */
export function heavyTokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      r: '300',
      bg: { $: "benchStore.stringValue == 'hello' && !benchStore.boolFalse ? 'neutral-0' : 'danger-50'" },
    },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          fontWeight: '600',
          color: {
            $: "benchStore.numberValue == 42 || benchStore.stringValue != 'goodbye' ? 'primary-700' : 'danger-700'",
          },
        },
        children: [{ $: `\`Heavy #${id} — \${benchStore.boolTrue ? benchStore.stringValue : 'fallback'}\`` }],
      },
      {
        type: 'we-text',
        props: { fontSize: '300', color: 'neutral-500' },
        children: [{ $: "`Status: ${benchStore.boolTrue && !benchStore.boolFalse ? 'active' : 'inactive'}`" }],
      },
    ],
  };
}

/**
 * The ladder fixture: one Column + a we-text + a we-button.
 *
 * `controls.tsx` reimplements exactly this three ways (raw DOM, plain Solid, hand-written Solid +
 * design system). Change one, change all four.
 */
export function wcCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '200', gap: '200', bg: 'neutral-0', r: '200' },
    children: [
      { type: 'we-text', props: { text: `WC ${id}`, fontSize: '300', color: 'neutral-700' } },
      { type: 'we-button', props: { text: `Action ${id}`, variant: 'outline', size: 'sm' } },
    ],
  };
}

/**
 * Per-post content for the realistic ladder. Varied deliberately: names, body lengths and badge
 * variants all differ, so the fixture is not 400 copies of one string.
 */
export const POST_AUTHORS = ['Ada Lovelace', 'Bo', 'Grace Hopper', 'Kai', 'Margaret Hamilton'];
export const POST_BADGES = ['primary', 'success', 'warning', 'neutral'];
export const POST_BODIES = [
  'A short note.',
  'Something a little longer, with enough text to wrap onto a second line in most layouts.',
  'A middling amount of body copy — more than a sentence, less than an essay.',
  'One line.',
];

export function postContent(id: number) {
  return {
    author: POST_AUTHORS[id % POST_AUTHORS.length],
    initials: POST_AUTHORS[id % POST_AUTHORS.length].slice(0, 2),
    time: `${(id % 23) + 1}h ago`,
    badge: POST_BADGES[id % POST_BADGES.length],
    badgeLabel: id % 3 === 0 ? 'New' : 'Updated',
    title: `Post ${id} — ${POST_AUTHORS[id % POST_AUTHORS.length].split(' ')[0]}'s update`,
    body: POST_BODIES[id % POST_BODIES.length],
    likes: `${(id * 7) % 140}`,
    comments: `${(id * 3) % 40}`,
  };
}

/**
 * A realistic feed post: 16 nodes, four component types, three levels of nesting, and content that
 * varies per card.
 *
 * The simple ladder card (`wcCard`) is one Column wrapping a text and a button — clean for isolating
 * layer costs, but a fair reviewer can object that layer attribution on trivial uniform content may
 * not generalise. This exists to answer that: the same four rungs, measured on something shaped like
 * a page someone would actually build.
 *
 * `controls.tsx` reimplements this exactly. Change one, change all of them —
 * `tests/ladder.test.tsx` will fail if they diverge.
 */
export function realisticCard(id: number): SchemaNode {
  const c = postContent(id);
  return {
    type: 'Column',
    props: { p: '300', gap: '200', bg: 'neutral-0', r: '300', border: '1px solid neutral-200' },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: 'we-avatar', props: { initials: c.initials, size: 'sm' } },
          {
            type: 'Column',
            props: { gap: '0' },
            children: [
              { type: 'we-text', props: { text: c.author, fontWeight: '600', color: 'neutral-800' } },
              { type: 'we-text', props: { text: c.time, fontSize: '200', color: 'neutral-400' } },
            ],
          },
          { type: 'we-badge', props: { variant: c.badge, size: 'sm' }, children: [c.badgeLabel] },
        ],
      },
      { type: 'we-text', props: { text: c.title, fontSize: '400', fontWeight: '600', color: 'neutral-900' } },
      { type: 'we-text', props: { text: c.body, fontSize: '300', color: 'neutral-600' } },
      {
        type: 'Row',
        props: { gap: '300', ay: 'center' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm' },
            children: [{ type: 'we-icon', props: { name: 'heart' } }],
          },
          { type: 'we-text', props: { text: c.likes, fontSize: '200', color: 'neutral-500' } },
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm' },
            children: [{ type: 'we-icon', props: { name: 'chat-circle' } }],
          },
          { type: 'we-text', props: { text: c.comments, fontSize: '200', color: 'neutral-500' } },
        ],
      },
    ],
  };
}

/** Column/Row only — no custom elements, so it isolates the Solid-component path. */
export function solidCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '200', gap: '100', bg: 'neutral-0', r: '200', border: '1px solid neutral-100' },
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

/** 100 nodes all bound to one store value — the fixture the update benchmark mutates. */
export function boundCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '200', gap: '100', bg: 'neutral-0', r: '200' },
    children: [
      { type: 'we-text', props: { fontSize: '200', color: 'neutral-500' }, children: [`Cell ${id}`] },
      {
        type: 'we-text',
        props: { fontWeight: '600', color: 'primary-700' },
        children: [{ $: '`#${benchStore.counter}`' }],
      },
    ],
  };
}

function deepNest(depth: number, current = 0): SchemaNode {
  const child: SchemaNode =
    current >= depth
      ? { type: 'we-text', props: { text: `Depth ${current}`, fontSize: '200', color: 'primary-600' } }
      : deepNest(depth, current + 1);
  return {
    type: current % 2 === 0 ? 'Column' : 'Row',
    props: { p: '100', gap: '100', ...(current === 0 ? { bg: 'neutral-0', r: '300' } : {}) },
    children: [{ type: 'we-text', props: { text: `Level ${current}`, fontSize: '200', color: 'neutral-400' } }, child],
  };
}

/** Wrap cards in a grid container. */
export function cardGrid(count: number, factory: (id: number) => SchemaNode, min = '150px', gap = '6px'): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '200', styles: grid(min, gap) },
    children: range(count).map(factory),
  };
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export type Fixture = {
  key: string;
  label: string;
  /** Schema tree, or `null` for the hand-written controls, which render a component instead. */
  node: SchemaNode | null;
  /** Registry key of a control component to render instead of a schema tree. */
  control?: string;
  /** Measure a reactive update burst after mount sampling. */
  measuresUpdate?: boolean;
  /** Part of a like-for-like ladder: 'simple' (one Column + text + button) or 'realistic'
   *  (page-shaped posts). Reporting both shows whether the layer costs hold as content gets more
   *  complex, or only isolate cleanly on trivial uniform content. */
  ladder?: 'simple' | 'realistic';
};

export const fixtures: Fixture[] = [
  { key: 'minimal', label: 'Minimal — measurement floor', node: { type: 'we-text', props: { text: 'One node.' } } },

  // --- The ladder: identical content, four ways -----------------------------
  { key: 'raw-dom', label: `Raw DOM (${LADDER_COUNT})`, node: null, control: 'RawDomCards', ladder: 'simple' },
  {
    key: 'plain-solid',
    label: `Plain Solid (${LADDER_COUNT})`,
    node: null,
    control: 'PlainSolidCards',
    ladder: 'simple',
  },
  {
    key: 'hand-written',
    label: `Solid + design system (${LADDER_COUNT})`,
    node: null,
    control: 'HandWrittenCards',
    ladder: 'simple',
  },
  {
    key: 'hand-written-prop',
    label: `Solid + design system, prop: (${LADDER_COUNT})`,
    node: null,
    control: 'HandWrittenCardsPropBound',
    ladder: 'simple',
  },
  { key: 'schema', label: `WE templates (${LADDER_COUNT})`, node: cardGrid(LADDER_COUNT, wcCard), ladder: 'simple' },

  // --- The realistic ladder: same rungs, page-shaped content ----------------
  {
    key: 'r-hand-written',
    label: `Solid + design system (${REALISTIC_COUNT} posts)`,
    node: null,
    control: 'RealisticCards',
    ladder: 'realistic',
  },
  {
    key: 'r-hand-written-prop',
    label: `Solid + design system, prop: (${REALISTIC_COUNT} posts)`,
    node: null,
    control: 'RealisticCardsPropBound',
    ladder: 'realistic',
  },
  {
    key: 'r-schema',
    label: `WE templates (${REALISTIC_COUNT} posts)`,
    node: {
      type: 'Column',
      props: {
        gap: '200',
        styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' },
      },
      children: Array.from({ length: REALISTIC_COUNT }, (_, i) => realisticCard(i + 1)),
    },
    ladder: 'realistic',
  },

  // --- Renderer scaling and feature cost ------------------------------------
  { key: 'static-small', label: 'Static 50', node: cardGrid(50, staticCard, '200px', '8px') },
  { key: 'static-large', label: 'Static 200', node: cardGrid(200, staticCard, '180px', '8px') },
  { key: 'static-extreme', label: 'Static 1000', node: cardGrid(1000, staticCard, '180px', '8px') },
  { key: 'tokens-light', label: 'Tokens light (50)', node: cardGrid(50, tokenCard, '200px', '8px') },
  { key: 'tokens-heavy', label: 'Tokens heavy (50)', node: cardGrid(50, heavyTokenCard, '220px', '8px') },
  { key: 'solid-components', label: 'Solid components (100)', node: cardGrid(100, solidCard) },
  { key: 'deep-nesting', label: 'Deep nesting (30)', node: deepNest(30) },
  {
    key: 'each-flat',
    label: '$each flat (100)',
    node: {
      type: 'Column',
      props: { gap: '200', styles: grid('200px', '8px') },
      children: [
        {
          type: '$each',
          props: { items: { $: 'benchStore.list100' } },
          children: [
            {
              type: 'Column',
              props: { p: '300', gap: '100', bg: 'neutral-0', r: '300' },
              children: [
                { type: 'we-text', props: { color: 'neutral-700' }, children: [{ $: 'item.name' }] },
                {
                  type: 'we-text',
                  props: { fontSize: '200', color: 'neutral-400' },
                  children: [{ $: 'item.category' }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    key: 'each-nested',
    label: 'Nested $each (10×10)',
    node: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'benchStore.groups' }, as: 'group' },
          children: [
            {
              type: 'Column',
              props: { p: '300', gap: '200', bg: 'neutral-0', r: '300' },
              children: [
                {
                  type: 'we-text',
                  props: { fontWeight: '600', color: 'neutral-700', fontSize: '400' },
                  children: [{ $: 'group.name' }],
                },
                {
                  type: '$each',
                  props: { items: { $: 'group.items' }, as: 'sub' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', pl: '300', ay: 'center' },
                      children: [
                        { type: 'we-text', props: { fontSize: '300' }, children: [{ $: 'sub.label' }] },
                        {
                          type: 'we-text',
                          props: { fontSize: '200', color: 'neutral-400' },
                          children: [{ $: 'sub.detail' }],
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
  },
  { key: 'update-perf', label: 'Reactive update (100)', node: cardGrid(100, boundCard), measuresUpdate: true },
];
