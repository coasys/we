/**
 * Schema Queries Test Page
 *
 * One page that exercises every distinct `$query` shape the app uses, against a deterministic
 * `TestItem`/`TestChild` dataset. Its purpose: verify the QueryIR routing (seed.features.useQueryIR)
 * against the REAL AD4M backend — flip the flag, reload, and every section should render identically,
 * with only the Flux drill-down logging a fallback.
 *
 * Seed (click "Seed known data" first): Alpha (2 children, 1 mine) · Beta (0) · Gamma (1, mine).
 */
import type { SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A labeled test block: heading + expectation + rendered results. */
function section(title: string, expectation: string, body: SchemaNode): SchemaNode {
  return {
    type: 'Column',
    props: { bg: 'neutral-0', border: '1px solid neutral-200', r: '400', p: '400', gap: '200' },
    children: [
      { type: 'we-text', props: { variant: 'heading-sm' }, children: [title] },
      { type: 'we-text', props: { variant: 'footnote', color: 'neutral-500' }, children: [expectation] },
      { type: 'we-divider' },
      body,
    ],
  };
}

/** A left label + the query's matched TestItems as name tags. */
function labeledRow(label: string, query: SchemaProp): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '200', ay: 'center', wrap: true },
    children: [
      { type: 'we-text', props: { variant: 'label', color: 'neutral-400', width: '200px' }, children: [label] },
      {
        type: '$each',
        props: { items: query, as: 'item' },
        children: [{ type: 'we-tag', props: { variant: 'primary' }, children: ['$item.name'] }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

// Live toggle — flips the QueryIR routing at runtime (no reload); watch sections re-route.
const irToggle: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', wrap: true, bg: 'neutral-0', border: '1px solid neutral-200', r: '400', p: '300' },
  children: [
    {
      type: 'we-button',
      props: {
        variant: { $if: { condition: { $store: 'testStore.queryIRenabled' }, then: 'primary', else: 'secondary' } },
        onClick: { $action: 'testStore.toggleQueryIR' },
      },
      children: [
        {
          type: 'we-icon',
          props: {
            name: {
              $if: { condition: { $store: 'testStore.queryIRenabled' }, then: 'toggle-right', else: 'toggle-left' },
            },
          },
        },
        {
          $if: {
            condition: { $store: 'testStore.queryIRenabled' },
            then: 'QueryIR routing: ON',
            else: 'QueryIR routing: OFF',
          },
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'neutral-500' },
      children: ['Flip live — every section re-routes without a reload. Watch for anything that changes.'],
    },
  ],
};

const seedControls: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', wrap: true },
  children: [
    {
      type: 'we-button',
      props: { variant: 'primary', onClick: { $action: 'testStore.seedQueryData' } },
      children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }, 'Seed known data'],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'neutral-500' },
      children: ['Click first → Alpha (2 children, 1 mine) · Beta (0) · Gamma (1, mine)'],
    },
  ],
};

const filterSection = section(
  'Filter — eq / contains / OR',
  "status='active' → Alpha, Gamma   ·   name contains 'et' → Beta   ·   draft OR name~'lph' → Alpha, Beta",
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      labeledRow("status = 'active'", {
        $query: {
          model: 'TestItem',
          perspective: 'testStore.perspective',
          where: { status: 'active' },
          order: { name: 'asc' },
        },
      }),
      labeledRow("name contains 'et'", {
        $query: { model: 'TestItem', perspective: 'testStore.perspective', where: { name: { contains: 'et' } } },
      }),
      labeledRow("draft OR name~'lph'", {
        $query: {
          model: 'TestItem',
          perspective: 'testStore.perspective',
          where: { OR: [{ status: 'draft' }, { name: { contains: 'lph' } }] },
          order: { name: 'asc' },
        },
      }),
    ],
  },
);

const sortSection = section(
  'Sort — single-key asc / desc',
  'name asc → Alpha, Beta, Gamma   ·   name desc → Gamma, Beta, Alpha',
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      labeledRow('order name asc', {
        $query: { model: 'TestItem', perspective: 'testStore.perspective', order: { name: 'asc' } },
      }),
      labeledRow('order name desc', {
        $query: { model: 'TestItem', perspective: 'testStore.perspective', order: { name: 'desc' } },
      }),
    ],
  },
);

const pageSection = section(
  'Pagination — limit / offset',
  'name asc, limit 2 → Alpha, Beta   ·   +offset 1 → Beta, Gamma',
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      labeledRow('limit 2', {
        $query: { model: 'TestItem', perspective: 'testStore.perspective', order: { name: 'asc' }, limit: 2 },
      }),
      labeledRow('limit 2, offset 1', {
        $query: {
          model: 'TestItem',
          perspective: 'testStore.perspective',
          order: { name: 'asc' },
          limit: 2,
          offset: 1,
        },
      }),
    ],
  },
);

const projectionSection = section(
  'Projections — count / single / include (over the children relation)',
  '$childCount → Alpha 2, Beta 0, Gamma 1   ·   $myChild → Alpha & Gamma set, Beta —',
  {
    type: '$each',
    props: {
      as: 'item',
      items: {
        $query: {
          model: 'TestItem',
          perspective: 'testStore.perspective',
          order: { name: 'asc' },
          include: {
            children: true,
            $childCount: { from: 'children', count: true },
            $myChild: { from: 'children', where: { owner: { $store: 'testStore.queryOwner' } }, limit: 1 },
          },
        },
      },
    },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', wrap: true },
        children: [
          { type: 'we-text', props: { variant: 'label', width: '120px' }, children: ['$item.name'] },
          { type: 'we-tag', props: { variant: 'neutral' }, children: [{ $concat: ['count: ', '$item.$childCount'] }] },
          {
            type: 'we-tag',
            props: { variant: { $if: { condition: '$item.$myChild', then: 'success', else: 'neutral' } } },
            children: [
              {
                $if: {
                  condition: '$item.$myChild',
                  then: { $concat: ['mine: ', '$item.$myChild.label'] },
                  else: 'mine: —',
                },
              },
            ],
          },
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'neutral-400' },
            children: [{ $concat: ['include: ', { $count: { items: '$item.children' } }, ' hydrated'] }],
          },
        ],
      },
    ],
  },
);

const liveSection = section(
  'Live — subscription reacts to a create',
  'Click "Add item" → a new item appears below without a reload',
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      {
        type: 'we-button',
        props: { variant: 'secondary', onClick: { $action: 'testStore.createTestItem' } },
        children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add item'],
      },
      labeledRow('all, name asc', {
        $query: { model: 'TestItem', perspective: 'testStore.perspective', order: { name: 'asc' } },
      }),
    ],
  },
);

const notesSection = section('Not covered here — check on real screens', 'These need real data:', {
  type: 'Column',
  props: { gap: '100' },
  children: [
    {
      type: 'we-text',
      props: { variant: 'footnote' },
      children: ['• relation-path sort (location.country) → Spaces list'],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote' },
      children: ['• parent drill-down (should fall back) → Flux nested conversations'],
    },
  ],
});

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const schemaQueriesTemplate: TemplateSchema = {
  meta: {
    name: 'Queries',
    description: 'Exercises every $query shape through the QueryIR routing (seed.features.useQueryIR)',
    icon: 'magnifying-glass',
    stores: { testStore: {} },
  },
  type: 'Column',
  props: { width: '100%', bg: 'neutral-50', gap: '400', p: '400' },
  children: [
    {
      type: 'we-text',
      props: { variant: 'body', color: 'neutral-500' },
      children: [
        'Toggle seed.features.useQueryIR and reload — every section should render identically, and only the Flux drill-down should log a [query-ir] fallback.',
      ],
    },
    irToggle,
    seedControls,
    filterSection,
    sortSection,
    pageSection,
    projectionSection,
    liveSection,
    notesSection,
  ],
};
