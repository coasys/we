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
 * One case only, and it is the one the layout cannot state for itself: a section the space *has*
 * that this agent has hidden. Its row sits above the divider with every other section the space has,
 * so without a word it reads as a section that should be in the nav and is not.
 *
 * The other case needs nothing — a section the space does not have is under a heading that says so.
 */
const sectionStatus: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'view.enabled && !view.visible' },
    then: {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: ['In this space, but hidden for you.'],
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
            // Only meaningful where a drag would change something everyone sees.
            condition: '$space.canAdminister',
            then: {
              /*
                A native carrier for `data-we-handle`, with a focusable control inside.

                Two reasons it is not just an icon. `we-sortable` reads the attribute from the DOM,
                and a web component's props are assigned as properties — so the attribute on a
                `we-icon` would silently never exist. And without any handle at all the whole row is
                the grab area, which is wrong here: the row ends in two switches, so a press meant
                for one of them would start a drag, and a Space keypress would pick the row up
                rather than toggle.

                The button is what keeps the keyboard path open — Space on a focused handle picks
                the row up, exactly as it does on a plain item.
              */
              type: 'div',
              props: { 'data-we-handle': '', style: { display: 'flex', cursor: 'grab' } },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'bare',
                    title: 'Reorder',
                    /*
                      Stated on the button, not only on the carrier around it.

                      `we-button` carries `cursor: 'pointer'` in its default props, and the pointer
                      is over the button — so the carrier's `grab` was being answered by the hand
                      the button asks for. An explicit prop beats a default.

                      `:active` is exactly the span of a grab: held down is held on to. This is the
                      same grab → grabbing pair `we-move-handle` gives the panels, said in DS props
                      because this grip is a button rather than that primitive — `we-move-handle`
                      reports pointer movement of its own, which is a second claim on a press that
                      `we-sortable` is already handling.
                    */
                    cursor: 'grab',
                    activeProps: { cursor: 'grabbing' },
                  },
                  children: [{ type: 'we-icon', props: { name: 'dots-six-vertical', color: 'text-faint' } }],
                },
              ],
            },
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
                disabled: { $: '!view.enabled' },
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
                disabled: { $: '!space.canAdminister' },
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

/**
 * What to say when the space's interface has no sections at all.
 *
 * A shell with a route table of its own — any of the showcase templates — is a legitimate design,
 * not an omission: a Discord-shaped space has channels, not sections. Saying so beats showing
 * switches that write a setting nothing reads, which would teach the reader something false about
 * the space.
 */
const noSectionsNotice: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'label' }, children: ['Sections'] },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [
        'The template this space uses arranges its own pages rather than drawing from a section list, so there is nothing to configure here.',
      ],
    },
  ],
};

const sectionsCard: SchemaNode = {
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
              $: "space.canAdminister ? 'The pages this space has, in the order they appear. Drag to reorder. Only the right-hand switch affects other members.' : 'The pages this space has. You can hide any of them for yourself; changing what everyone sees needs someone who administers the space.'",
            },
          ],
        },
      ],
    },
    {
      /*
        Only the sections the space *has* go in the drag zone.

        A section it does not have has no position, so there is nothing for a drag to mean. Leaving
        them in was not merely untidy: the zone reports every id it holds, so one drag handed the
        disabled ones back as though they were part of the order — and writing that turned every one
        of them on.
      */
      type: 'we-sortable',
      props: {
        // Locked for a member who may not administer the space: the rows stay readable and their
        // "For me" switch still works, but the order is not theirs to change.
        locked: { $: '!space.canAdminister' },
        // `$arg.detail` is where we-sortable puts the reordered ids. The event is `reorder`, which
        // Solid reaches from `onReorder` by lowercasing.
        onReorder: { $action: 'spaceStore.reorderViews', args: ['$arg.detail', '$space.uuid'] },
      },
      children: [
        {
          type: '$each',
          props: { items: { $: 'filter(space.views, { enabled: true })' }, as: 'view' },
          children: [draggableRow],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(filter(space.views, { enabled: false }))' },
        then: {
          type: 'Column',
          props: { gap: '200', pt: '300', mt: '200', borderTop: '1px solid border' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', fontWeight: 'semibold', textTransform: 'uppercase', color: 'text-faint' },
              children: ['Not in this space'],
            },
            {
              type: '$each',
              props: { items: { $: 'filter(space.views, { enabled: false })' }, as: 'view' },
              children: [sectionRow],
            },
          ],
        },
      },
    },
  ],
};

export const spaceSectionsSection: SchemaNode = {
  type: '$if',
  props: { condition: '$space.usesSections', then: sectionsCard, else: noSectionsNotice },
};
