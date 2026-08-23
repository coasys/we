import type { SchemaNode } from '@we/schema-shared';

/**
 * Which sections a space has, and which of them this agent bothers to see.
 *
 * Deliberately shaped like the Modules card beside it, down to the two switches per row and the
 * "For me" / "For everyone" captions — because it is the same question one tier up, and a page that
 * asked it twice in two different shapes would make the reader learn both. What differs is what
 * the answers mean: a module the community turns off is a capability nobody here runs, a section it
 * turns off is a page nobody here can navigate to.
 *
 * ## Why both answers on one row
 *
 * "The community removed this section" and "you hid it for yourself" are different situations with
 * different remedies, and one switch cannot tell them apart — it would sit in the "off" position for
 * two reasons and offer the same, wrong, fix for both. Side by side, the row says which.
 *
 * ## Why reordering lives here rather than in the nav
 *
 * Drag-to-reorder in the nav strip itself would be more direct, and wrong: the nav is what every
 * member sees, so a drag there is a community-wide change made by a gesture that reads as a personal
 * one. Here it sits under the heading that says who it affects, next to the switch that says the
 * same.
 */

/**
 * Why a section is not showing, when a switch alone would not say.
 *
 * The mirror of `moduleStatus`. Only one of the two cases needs saying — a section the community has
 * off is simply off, and the switch beside it already says so — but a section *you* hid inside a
 * space that still has it reads as a bug from the nav strip, where it is merely absent.
 */
const sectionStatus: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: ['$view.enabled', { $not: '$view.visible' }] },
    then: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: ['In this space, but hidden for you.'],
    },
    else: {
      type: '$if',
      props: {
        condition: { $not: '$view.enabled' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: ['Not in this space.'],
        },
      },
    },
  },
};

const sectionRow: SchemaNode = {
  type: 'Row',
  props: { ay: 'center', ax: 'between', gap: '300', py: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: '$if',
          props: {
            // The grab handle is only meaningful where a drag would change something everyone sees.
            condition: '$space.canAdminister',
            then: { type: 'we-icon', props: { name: 'dots-six-vertical', color: 'text-faint' } },
          },
        },
        { type: 'we-icon', props: { name: '$view.icon', size: '20px' } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['$view.name'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: ['$view.description'],
            },
            sectionStatus,
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '400', ay: 'center' },
      children: [
        {
          type: 'Column',
          props: { gap: '100', ax: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: ['For me'] },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                checked: '$view.visible',
                // Nothing to show yourself while the space does not have the section, so the control
                // cannot do what it appears to.
                disabled: { $not: '$view.enabled' },
                // Bare `$event.detail`: an operator object around it resolves at render time, before
                // the event exists. Same trap as the module switches.
                onChange: {
                  $action: 'spaceStore.setViewVisible',
                  args: ['$view.id', '$event.detail', '$space.uuid'],
                },
              },
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '100', ax: 'center' },
          children: [
            { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: ['For everyone'] },
            {
              type: 'we-switch',
              props: {
                size: 'sm',
                checked: '$view.enabled',
                disabled: { $not: '$space.canAdminister' },
                onChange: {
                  $action: 'spaceStore.setViewEnabled',
                  args: ['$view.id', '$event.detail', '$space.uuid'],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The draggable carrier.
 *
 * A native `div` rather than a component, because `we-sortable` reads a DOM *attribute* and the
 * renderer assigns a web component's props as properties — so `data-we-id` on anything else would
 * silently never exist. The explicit width matters too: this div is the box the drag geometry
 * measures.
 */
const draggableRow: SchemaNode = {
  type: 'div',
  props: { 'data-we-id': '$view.id', style: { width: '100%' } },
  children: [sectionRow],
};

export const spaceSectionsSection: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ['Sections'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [
            {
              $if: {
                condition: '$space.canAdminister',
                then: 'The pages this space has, in the order they appear. Drag to reorder. Only the right-hand switch affects other members.',
                else: 'The pages this space has. You can hide any of them for yourself; changing what everyone sees needs someone who administers the space.',
              },
            },
          ],
        },
      ],
    },
    {
      type: 'we-sortable',
      props: {
        // Locked for a member who may not administer the space: the rows are still readable and
        // their "For me" switch still works, but the order is not theirs to change.
        locked: { $not: '$space.canAdminister' },
        // `$arg.detail` is where we-sortable puts the reordered ids. The event is `reorder`, which
        // Solid reaches from `onReorder` by lowercasing.
        onReorder: { $action: 'spaceStore.reorderViews', args: ['$arg.detail', '$space.uuid'] },
      },
      children: [
        {
          type: '$each',
          props: { items: '$space.views', as: 'view' },
          children: [draggableRow],
        },
      ],
    },
  ],
};
