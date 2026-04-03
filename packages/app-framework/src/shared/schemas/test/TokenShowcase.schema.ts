/**
 * Token Showcase Template
 *
 * A dashboard-style template that exercises the broadest set of schema tokens
 * in a single practical layout. Every implemented token appears at least once.
 *
 * Tokens exercised:
 *   $store, $action, $concat, $if (prop + node), $each, $map, $eq, $ne,
 *   $not, $and, $or, $arg, theme overrides, web components (we-text, we-button, we-icon)
 *
 * Data source: testStore (plain signals, works immediately — no AD4M dependency)
 */
import type { TemplateSchema } from '@we/schema-shared';

// ---------------------------------------------------------------------------
// Header bar — $concat, $store
// ---------------------------------------------------------------------------
const header = {
  type: 'Row',
  props: {
    p: '500',
    gap: '400',
    ay: 'center',
    bg: 'primary-50',
    style: { 'border-bottom': '1px solid var(--we-color-primary-100)' },
  },
  children: [
    // $concat: compose title from store values
    {
      type: 'we-text',
      props: { fontSize: '700', fontWeight: '700' },
      children: [{ $concat: ['Token Showcase — ', { $store: 'testStore.itemCount' }, ' items'] }],
    },
    { type: 'div', props: { style: { flex: '1' } } },
    // $store: display current route path
    {
      type: 'we-text',
      props: { fontSize: '300', color: 'neutral-400' },
      children: [{ $concat: ['Route: ', { $store: 'routeStore.currentPath' }] }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Filter bar — $eq (prop-level $if), $action, $arg
// ---------------------------------------------------------------------------
function filterButton(label: string, filter: string) {
  return {
    type: 'we-button',
    props: {
      // $if (prop-level): conditionally set variant based on active filter via $eq
      variant: {
        $if: {
          condition: { $eq: [{ $store: 'testStore.activeFilter' }, filter] },
          then: 'primary',
          else: 'ghost',
        },
      },
      onClick: { $action: 'testStore.setFilter', args: [filter] },
    },
    children: [label],
  };
}

const filterBar = {
  type: 'Row',
  props: {
    px: '500',
    py: '300',
    gap: '300',
    ay: 'center',
    bg: 'neutral-50',
    style: { 'border-bottom': '1px solid var(--we-color-neutral-200)' },
  },
  children: [
    { type: 'we-text', props: { fontSize: '400', fontWeight: '600', color: 'neutral-600' }, children: ['Filter:'] },
    filterButton('All', 'all'),
    filterButton('Active', 'active'),
    filterButton('Draft', 'draft'),
    filterButton('Archived', 'archived'),
    { type: 'div', props: { style: { flex: '1' } } },
    // $arg: extract value from native input event
    {
      type: 'input',
      props: {
        placeholder: 'Search items...',
        style: {
          padding: '6px 12px',
          border: '1px solid var(--we-color-neutral-300)',
          'border-radius': '6px',
          'font-size': '14px',
          width: '200px',
        },
        onInput: { $action: 'testStore.setSearch', args: ['$arg.target.value'] },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Item card — $each, $item references, $eq (selected highlight), $if (node-level)
// ---------------------------------------------------------------------------
const itemCard = {
  type: 'Column',
  props: {
    p: '400',
    gap: '200',
    r: '200',
    cursor: 'pointer',
    // $eq: highlight selected item
    bg: {
      $if: {
        condition: { $eq: ['$item.id', { $store: 'testStore.selectedItemId' }] },
        then: 'primary-50',
        else: 'neutral-0',
      },
    },
    style: { border: '1px solid var(--we-color-neutral-200)', transition: 'background 0.15s' },
    onClick: { $action: 'testStore.selectItem', args: ['$item.id'] },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        // web component with $item context reference
        { type: 'we-text', props: { fontSize: '400', fontWeight: '600' }, children: ['$item.name'] },
        { type: 'div', props: { style: { flex: '1' } } },
        // Status badge with conditional color
        {
          type: 'we-text',
          props: {
            fontSize: '200',
            fontWeight: '600',
            color: {
              $if: {
                condition: { $eq: ['$item.status', 'active'] },
                then: 'success-600',
                else: {
                  $if: { condition: { $eq: ['$item.status', 'draft'] }, then: 'warning-600', else: 'neutral-400' },
                },
              },
            },
          },
          children: ['$item.status'],
        },
      ],
    },
    // $if (node-level): show description only if non-empty
    {
      type: '$if',
      props: {
        condition: '$item.description',
        then: { type: 'we-text', props: { fontSize: '300', color: 'neutral-500' }, children: ['$item.description'] },
      },
    },
    // $concat: combine category + priority
    {
      type: 'we-text',
      props: { fontSize: '200', color: 'neutral-400' },
      children: [{ $concat: ['$item.category', ' · Priority ', '$item.priority'] }],
    },
  ],
};

const itemList = {
  type: 'Column',
  props: { p: '400', gap: '300', style: { flex: '1', overflow: 'auto' } },
  children: [
    // $each: iterate filtered items
    { type: '$each', props: { items: { $store: 'testStore.filteredItems' } }, children: [itemCard] },
    // $not + $if (node-level): empty state when no items match
    {
      type: '$if',
      props: {
        condition: { $not: { $store: 'testStore.hasFilteredItems' } },
        then: {
          type: 'Column',
          props: { ax: 'center', ay: 'center', p: '600', gap: '300' },
          children: [
            { type: 'we-icon', props: { name: 'magnifying-glass', size: 48, color: 'neutral-300' } },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-400' },
              children: ['No items match your filters'],
            },
          ],
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Detail panel — $if/$not (selected state), $map, $and, $or
// ---------------------------------------------------------------------------
const detailView = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    // Header
    {
      type: 'we-text',
      props: { fontSize: '600', fontWeight: '700' },
      children: [{ $store: 'testStore.selectedItem.name' }],
    },
    {
      type: 'we-text',
      props: { fontSize: '400', color: 'neutral-600' },
      children: [{ $store: 'testStore.selectedItem.description' }],
    },
    // Divider
    { type: 'div', props: { style: { height: '1px', background: 'var(--we-color-neutral-200)' } } },
    // $map: transform selectedItemProperties into display rows
    {
      type: '$each',
      props: {
        items: {
          $map: {
            items: { $store: 'testStore.selectedItemProperties' },
            select: { label: '$item.key', value: '$item.value' },
          },
        },
        as: 'prop',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '200', py: '100' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '300', fontWeight: '600', color: 'neutral-500', style: { 'min-width': '80px' } },
              children: ['$prop.label'],
            },
            { type: 'we-text', props: { fontSize: '300' }, children: ['$prop.value'] },
          ],
        },
      ],
    },
    // $and: show delete button only when item is selected AND archived
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
          children: [{ type: 'we-icon', props: { name: 'trash' } }, 'Delete Archived Item'],
        },
      },
    },
    // $or: show warning when status is draft OR archived
    {
      type: '$if',
      props: {
        condition: {
          $or: [
            { $eq: [{ $store: 'testStore.selectedItem.status' }, 'draft'] },
            { $eq: [{ $store: 'testStore.selectedItem.status' }, 'archived'] },
          ],
        },
        then: {
          type: 'Row',
          props: { p: '300', bg: 'warning-50', r: '200', gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'warning', color: 'warning-600' } },
            {
              type: 'we-text',
              props: { fontSize: '300', color: 'warning-700' },
              children: ['This item is not active'],
            },
          ],
        },
      },
    },
  ],
};

const detailPanel = {
  type: 'Column',
  props: {
    p: '500',
    bg: 'neutral-0',
    style: { width: '320px', 'border-left': '1px solid var(--we-color-neutral-200)', overflow: 'auto' },
  },
  children: [
    // $if: show detail when item selected
    { type: '$if', props: { condition: { $store: 'testStore.selectedItem' }, then: detailView } },
    // $not: placeholder when nothing selected
    {
      type: '$if',
      props: {
        condition: { $not: { $store: 'testStore.selectedItem' } },
        then: {
          type: 'Column',
          props: { ax: 'center', ay: 'center', style: { flex: '1' }, gap: '200' },
          children: [
            { type: 'we-icon', props: { name: 'cursor-click', size: 32, color: 'neutral-300' } },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-400' },
              children: ['Select an item to view details'],
            },
          ],
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Footer — $concat stats, $ne, $action
// ---------------------------------------------------------------------------
const footer = {
  type: 'Row',
  props: {
    px: '500',
    py: '300',
    gap: '400',
    bg: 'neutral-50',
    ay: 'center',
    style: { 'border-top': '1px solid var(--we-color-neutral-200)' },
  },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '300', color: 'neutral-500' },
      children: [{ $concat: ['Total: ', { $store: 'testStore.itemCount' }, ' items'] }],
    },
    // $ne: show filtered count indicator only when filter is NOT 'all'
    {
      type: '$if',
      props: {
        condition: { $ne: [{ $store: 'testStore.activeFilter' }, 'all'] },
        then: {
          type: 'we-text',
          props: { fontSize: '300', color: 'primary-500', fontWeight: '600' },
          children: [{ $concat: ['Showing: ', { $store: 'testStore.filteredItemCount' }] }],
        },
      },
    },
    { type: 'div', props: { style: { flex: '1' } } },
    // $action: add new item
    {
      type: 'we-button',
      props: { variant: 'ghost', onClick: { $action: 'testStore.addItem' } },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add Item'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Full template
// ---------------------------------------------------------------------------
export const tokenShowcaseTemplate: TemplateSchema = {
  meta: {
    name: 'Token Showcase',
    description: 'Dashboard exercising all schema tokens',
    icon: 'test-tube',
  },
  // Theme overrides — scoped CSS variable customization
  theme: { primaryHue: 220, saturation: '80%' },
  type: 'Column',
  props: { height: '100%', width: '100%', bg: 'neutral-50' },
  children: [
    header,
    filterBar,
    {
      type: 'Row',
      props: { style: { flex: '1', overflow: 'hidden' } },
      children: [itemList, detailPanel],
    },
    footer,
  ],
  // Minimal routes — template content is in the layout, not in routes
  routes: [
    { path: '/', type: 'Column' },
    { path: '*', type: 'Column' },
  ],
};
