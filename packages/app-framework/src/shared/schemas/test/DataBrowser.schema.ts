/**
 * Data Browser Template
 *
 * Hierarchical data browser exercising nested $each, $query, $map with
 * complex select, and $pick — tokens not covered by the Token Showcase.
 *
 * Tokens exercised:
 *   nested $each (categories → items), $query (with perspectiveStore),
 *   $map (complex select), $pick, $store, $action, $concat, $if, $not,
 *   $eq, $and, $arg, web components
 *
 * Data source: testStore.categories (nested signal data) + $query against
 * testStore.perspective (AD4M test perspective, available after init)
 */
import type { TemplateSchema } from '@we/schema-shared';

// ---------------------------------------------------------------------------
// Sidebar — nested $each (categories → items), $arg (search)
// ---------------------------------------------------------------------------
const sidebarSearch = {
  type: 'Row',
  props: { p: '300', style: { 'border-bottom': '1px solid var(--we-color-neutral-200)' } },
  children: [
    // $arg: search input extracts value from native event
    {
      type: 'input',
      props: {
        placeholder: 'Search...',
        style: {
          width: '100%',
          padding: '6px 10px',
          border: '1px solid var(--we-color-neutral-300)',
          'border-radius': '4px',
          'font-size': '13px',
        },
        onInput: { $action: 'testStore.setSearch', args: ['$arg.target.value'] },
      },
    },
  ],
};

const sidebarContent = {
  type: 'Column',
  props: { style: { flex: '1', overflow: 'auto' }, gap: '100' },
  children: [
    // Outer $each — iterate categories
    {
      type: '$each',
      props: { items: { $store: 'testStore.categories' }, as: 'category' },
      children: [
        {
          type: 'Column',
          props: { style: { 'border-bottom': '1px solid var(--we-color-neutral-100)' } },
          children: [
            // Category header
            {
              type: 'Row',
              props: { px: '300', py: '200', gap: '200', ay: 'center', bg: 'neutral-50' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '200', fontWeight: '700', color: 'neutral-500' },
                  children: ['$category.name'],
                },
                { type: 'div', props: { style: { flex: '1' } } },
                {
                  type: 'we-text',
                  props: { fontSize: '200', color: 'neutral-400' },
                  children: [{ $concat: ['(', '$category.count', ')'] }],
                },
              ],
            },
            // Inner $each — iterate items within each category (NESTED $each)
            {
              type: '$each',
              props: { items: '$category.items', as: 'catItem' },
              children: [
                {
                  type: 'Row',
                  props: {
                    px: '300',
                    py: '200',
                    gap: '200',
                    ay: 'center',
                    cursor: 'pointer',
                    // $eq: highlight selected item
                    bg: {
                      $if: {
                        condition: { $eq: ['$catItem.id', { $store: 'testStore.selectedItemId' }] },
                        then: 'primary-50',
                        else: 'neutral-0',
                      },
                    },
                    onClick: { $action: 'testStore.selectItem', args: ['$catItem.id'] },
                  },
                  children: [
                    { type: 'we-text', props: { fontSize: '300' }, children: ['$catItem.name'] },
                    { type: 'div', props: { style: { flex: '1' } } },
                    // Status dot
                    {
                      type: 'we-text',
                      props: {
                        fontSize: '200',
                        color: {
                          $if: {
                            condition: { $eq: ['$catItem.status', 'active'] },
                            then: 'success-500',
                            else: {
                              $if: {
                                condition: { $eq: ['$catItem.status', 'draft'] },
                                then: 'warning-500',
                                else: 'neutral-400',
                              },
                            },
                          },
                        },
                      },
                      children: ['●'],
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
};

const sidebar = {
  type: 'Column',
  props: {
    bg: 'neutral-0',
    style: { width: '260px', 'border-right': '1px solid var(--we-color-neutral-200)', height: '100%' },
  },
  children: [
    // Sidebar title
    {
      type: 'Row',
      props: {
        p: '300',
        ay: 'center',
        gap: '200',
        bg: 'neutral-0',
        style: { 'border-bottom': '1px solid var(--we-color-neutral-200)' },
      },
      children: [
        { type: 'we-icon', props: { name: 'tree-structure', size: 18, color: 'neutral-600' } },
        { type: 'we-text', props: { fontSize: '400', fontWeight: '700' }, children: ['Categories'] },
      ],
    },
    sidebarSearch,
    sidebarContent,
  ],
};

// ---------------------------------------------------------------------------
// Detail panel — $pick, $map (complex select), $if/$not, $and
// ---------------------------------------------------------------------------
const detailHeader = {
  type: 'Column',
  props: { gap: '200', style: { 'border-bottom': '1px solid var(--we-color-neutral-200)' }, pb: '400' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '600', fontWeight: '700' },
      children: [{ $store: 'testStore.selectedItem.name' }],
    },
    // $concat: build subtitle from item fields
    {
      type: 'we-text',
      props: { fontSize: '300', color: 'neutral-500' },
      children: [
        {
          $concat: [{ $store: 'testStore.selectedItem.category' }, ' · ', { $store: 'testStore.selectedItem.status' }],
        },
      ],
    },
  ],
};

const detailProperties = {
  type: 'Column',
  props: { gap: '100' },
  children: [
    { type: 'we-text', props: { fontSize: '300', fontWeight: '700', color: 'neutral-500' }, children: ['Properties'] },
    // $map with complex select: transform raw properties into display-ready rows
    {
      type: '$each',
      props: {
        items: {
          $map: {
            items: { $store: 'testStore.selectedItemProperties' },
            select: {
              label: '$item.key',
              detail: { $concat: ['$item.value'] },
            },
          },
        },
        as: 'row',
      },
      children: [
        {
          type: 'Row',
          props: { py: '200', gap: '200', style: { 'border-bottom': '1px solid var(--we-color-neutral-50)' } },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '300', fontWeight: '600', color: 'neutral-500', style: { 'min-width': '80px' } },
              children: ['$row.label'],
            },
            { type: 'we-text', props: { fontSize: '300' }, children: ['$row.detail'] },
          ],
        },
      ],
    },
  ],
};

// $pick: extract summary subset for a compact display badge
const detailSummaryBadge = {
  type: 'Row',
  props: {
    p: '200',
    r: '200',
    gap: '200',
    bg: 'neutral-50',
    ay: 'center',
    // $pick: extract just name + status from selected item (exercises the token)
    _summary: { $pick: { from: { $store: 'testStore.selectedItem' }, props: ['name', 'status'] } },
  },
  children: [
    { type: 'we-icon', props: { name: 'info', size: 14, color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { fontSize: '200', color: 'neutral-500' },
      children: [{ $concat: ['Viewing: ', { $store: 'testStore.selectedItem.name' }] }],
    },
  ],
};

const detailActions = {
  type: 'Row',
  props: { gap: '200', pt: '300', style: { 'border-top': '1px solid var(--we-color-neutral-200)' } },
  children: [
    // $and: show delete only if item is archived
    {
      type: '$if',
      props: {
        condition: {
          $and: [
            { $store: 'testStore.selectedItem' },
            { $eq: [{ $store: 'testStore.selectedItem.status' }, 'archived'] },
          ],
        },
        then: {
          type: 'we-button',
          props: { variant: 'danger', onClick: { $action: 'testStore.removeSelectedItem' } },
          children: [{ type: 'we-icon', props: { name: 'trash' } }, 'Delete'],
        },
      },
    },
  ],
};

const detailView = {
  type: 'Column',
  props: { gap: '400' },
  children: [detailHeader, detailSummaryBadge, detailProperties, detailActions],
};

const detailPlaceholder = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', style: { flex: '1' }, gap: '200' },
  children: [
    { type: 'we-icon', props: { name: 'cursor-click', size: 32, color: 'neutral-300' } },
    { type: 'we-text', props: { fontSize: '400', color: 'neutral-400' }, children: ['Select an item to view details'] },
  ],
};

const detailPanel = {
  type: 'Column',
  props: { style: { flex: '1', overflow: 'auto' } },
  children: [
    // Main detail area
    {
      type: 'Column',
      props: { p: '500', style: { flex: '1' } },
      children: [
        { type: '$if', props: { condition: { $store: 'testStore.selectedItem' }, then: detailView } },
        { type: '$if', props: { condition: { $not: { $store: 'testStore.selectedItem' } }, then: detailPlaceholder } },
      ],
    },
    // $query section — items from AD4M test perspective
    {
      type: 'Column',
      props: { p: '400', bg: 'neutral-50', style: { 'border-top': '1px solid var(--we-color-neutral-200)' } },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', pb: '200' },
          children: [
            { type: 'we-icon', props: { name: 'database', size: 14, color: 'neutral-500' } },
            {
              type: 'we-text',
              props: { fontSize: '300', fontWeight: '700', color: 'neutral-500' },
              children: ['$query (AD4M perspective)'],
            },
          ],
        },
        // $query: reactive subscription against testStore.perspective
        {
          type: '$each',
          props: {
            items: { $query: { model: 'TestItem', perspectiveStore: 'testStore.perspective', subscribe: true } },
            as: 'queryItem',
          },
          children: [
            {
              type: 'Row',
              props: { py: '100', gap: '200', ay: 'center' },
              children: [
                { type: 'we-text', props: { fontSize: '200' }, children: ['$queryItem.name'] },
                { type: 'we-text', props: { fontSize: '200', color: 'neutral-400' }, children: ['$queryItem.status'] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Full template
// ---------------------------------------------------------------------------
export const dataBrowserTemplate: TemplateSchema = {
  meta: {
    name: 'Data Browser',
    description: 'Nested data browser with $query, nested $each, $map, $pick',
    icon: 'tree-structure',
  },
  type: 'Row',
  props: { height: '100%', width: '100%' },
  children: [sidebar, detailPanel],
  // Minimal routes
  routes: [
    { path: '/', type: 'Column' },
    { path: '*', type: 'Column' },
  ],
};
