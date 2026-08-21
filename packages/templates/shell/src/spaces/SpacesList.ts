import type { SchemaNode } from '@we/schema-shared';
import { emptyNote } from '@we/template-kit';

/**
 * One row per joined dataset, space or not — see `spaceStore.spaceList`.
 *
 * This replaces three sections ("All Perspectives", "Shared Spaces", "Personal Spaces"). Shared and
 * personal were the same model differing by one field, so the split bought a second heading and a
 * second "none yet" empty state for what is one list; they are a badge now. "All Perspectives" was a
 * different axis entirely — raw datasets with ids and destructive tools — and has moved to the
 * advanced section, keeping only the one thing it uniquely surfaced: a joined dataset that is not a
 * WE space, which now appears here in its own state rather than as an id in a diagnostics list.
 */

/** Shared / Personal / not-yet-a-space, as a badge rather than a heading. */
const kindBadge: SchemaNode = {
  type: '$if',
  props: {
    condition: '$space.isWeSpace',
    then: {
      type: 'we-badge',
      props: {
        size: 'sm',
        variant: { $if: { condition: { $eq: ['$space.kind', 'shared'] }, then: 'primary', else: 'neutral' } },
      },
      children: [{ $if: { condition: { $eq: ['$space.kind', 'shared'] }, then: 'Shared', else: 'Personal' } }],
    },
    // Not an error state — a dataset synced in from another app is simply waiting to be initialized,
    // and opening it is what surfaces that gate.
    else: {
      type: 'we-badge',
      props: { size: 'sm', variant: 'warning' },
      children: ['Not a WE space'],
    },
  },
};

const spaceCard: SchemaNode = {
  type: 'Row',
  props: {
    ay: 'center',
    gap: '300',
    p: '300',
    bg: 'surface',
    r: '300',
    border: '1px solid border',
  },
  children: [
    // `bare` rather than a Row with onClick: appearance-free, but still a real button, so it keeps
    // keyboard activation and the accessibility role a clickable Row silently loses.
    {
      type: 'we-button',
      props: {
        variant: 'bare',
        flex: '1',
        ax: 'start',
        onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] },
      },
      children: [
        {
          type: 'Row',
          props: { ay: 'center', gap: '300', width: '100%' },
          children: [
            {
              type: 'we-avatar',
              props: {
                image: '$space.avatar',
                initials: '$space.name',
                icon: { $if: { condition: '$space.isWeSpace', then: '', else: 'intersect-three' } },
                size: 'sm',
              },
            },
            {
              type: 'Column',
              props: { gap: '100', flex: '1', ax: 'start' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', wrap: true },
                  children: [{ type: 'we-text', props: { variant: 'label' }, children: ['$space.name'] }, kindBadge],
                },
                {
                  type: '$if',
                  props: {
                    condition: '$space.description',
                    then: {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'textFaint', truncate: true },
                      children: ['$space.description'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    // Settings for a space you are not standing in. Navigating between spaces closes this overlay
    // (`navigateToSpace` calls `closeShellView`), so a "current space" page could never be reached
    // for anywhere but where you already are — the card is what makes any joined space configurable.
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        square: true,
        onClick: { $action: 'routeStore.navigate', args: [{ $concat: ['/spaces/', '$space.uuid'] }] },
      },
      children: [{ type: 'we-icon', props: { name: 'gear' } }],
    },
  ],
};

export const spacesListSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'stack', size: '20px' } },
        { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Spaces'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $count: { items: { $store: 'spaceStore.spaceList' } } },
        then: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'spaceStore.spaceList' }, as: 'space' },
              children: [spaceCard],
            },
          ],
        },
        else: emptyNote('No spaces yet'),
      },
    },
  ],
};
