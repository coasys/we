import type { SchemaNode } from '@we/schema-shared';
import { peopleRow, peopleTooltip } from '@we/template-kit';

export const spaceHeader: SchemaNode = {
  type: 'Column',
  children: [
    // ─── Header ───────────────────────────────────────────────────────────────
    {
      type: 'Row',
      props: { bg: 'neutral-100', ax: 'center' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)' },
          children: [
            // Cover image
            {
              type: 'EditableImage',
              props: {
                src: { $store: 'spaceStore.currentSpace.coverImage' },
                alt: 'Cover image',
                fit: 'cover',
                width: '100%',
                height: '300px',
                rb: '600',
                aspect: 4 / 1,
                placeholderIcon: 'panorama',
                onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['coverImage', '$arg'] },
              },
            },
            {
              type: 'Row',
              props: { gap: '300', p: '400', mt: '400' },
              children: [
                // Profile picture
                {
                  type: 'EditableImage',
                  props: {
                    src: { $store: 'spaceStore.currentSpace.avatar' },
                    alt: 'Profile picture',
                    fit: 'cover',
                    width: '120px',
                    height: '120px',
                    r: 'pill',
                    ring: '0 0 0 2px var(--we-ring-color)',
                    placeholderIcon: 'users-three',
                    onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['avatar', '$arg'] },
                  },
                },
                // Space Details
                {
                  type: 'Column',
                  props: { p: '400', gap: '300', maxWidth: '700px' },
                  children: [
                    /*
                      `loading` rather than a placeholder beside the text: the element sizes its own
                      placeholder from the line it would occupy, so nothing here has to know the
                      height of a heading — a number no template can derive and which drifts the
                      moment a theme changes its type scale.

                      The description still waits on the space rather than reading through it. Its
                      inner condition tests `description`, which is falsy while unloaded, so without
                      the outer test it asserted "No description..." about a space it had not seen.
                    */
                    {
                      type: 'we-text',
                      props: {
                        variant: 'heading-md',
                        color: 'neutral-1000',
                        loading: { $not: { $store: 'spaceStore.currentSpace' } },
                        loadingWidth: '220px',
                      },
                      children: [{ $store: 'spaceStore.currentSpace.name' }],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $store: 'spaceStore.currentSpace' },
                        then: {
                          type: '$if',
                          props: {
                            condition: { $store: 'spaceStore.currentSpace.description' },
                            then: {
                              type: 'we-text',
                              props: { truncate: true },
                              children: [{ $store: 'spaceStore.currentSpace.description' }],
                            },
                            else: {
                              type: 'we-text',
                              props: { italic: true },
                              children: ['No description...'],
                            },
                          },
                        },
                        else: { type: 'we-text', props: { loading: true, loadingWidth: '320px' } },
                      },
                    },
                    // The faces and the count are one thing to a reader — "12 Members" — so the
                    // roster hangs off both rather than off the avatars alone. Hovering the words
                    // and getting nothing was the tell that the tooltip belonged out here.
                    peopleRow({
                      items: { $store: 'spaceStore.members' },
                      noun: 'Member',
                      // Members resolve on their own path, later than the space itself, so without
                      // a floor this row collapsed and then pushed the header down a second time.
                      minHeight: '32px',
                      rowProps: { mt: '200' },
                    }),
                  ],
                },
              ],
            },
            // Sentinel — zero-height marker used by scrollPast in the sticky nav below
            {
              type: 'div',
              props: { id: 'space-header-sentinel' },
              styles: { height: '0px', pointerEvents: 'none' },
            },
          ],
        },
      ],
    },
  ],
};

// Sticky navigation — exported separately so it can be placed as a sibling of
// both the header content and the $routes outlet, giving it a containing block
// that spans the full page height (required for position:sticky to work correctly).
export const spaceNavBar: SchemaNode = {
  type: 'Row',
  props: {
    bg: 'neutral-100',
    ax: 'center',
    position: 'sticky',
    zIndex: 'sticky',
    top: '0',
    left: '0',
    borderBottom: '1px solid neutral-200',
  },
  children: [
    // Mini-profile (fades in once the header has scrolled out of view)
    {
      type: '$animate',
      props: {
        scrollPast: 'space-header-sentinel',
        enterTransition: { type: 'fade', duration: 250 },
        exitTransition: { type: 'fade', duration: 200 },
      },
      children: [
        {
          type: 'Row',
          props: { position: 'absolute', left: '16px', top: '0', bottom: '0', ay: 'center', gap: '400' },
          children: [
            {
              type: 'we-avatar',
              props: {
                image: { $store: 'spaceStore.currentSpace.avatar' },
                initials: { $store: 'spaceStore.currentSpace.name' },
                size: 'lg',
              },
            },
            {
              type: 'we-text',
              props: { fontWeight: 'semibold' },
              children: [{ $store: 'spaceStore.currentSpace.name' }],
            },
          ],
        },
      ],
    },
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)' },
      children: [
        {
          type: 'Row',
          props: { ay: 'center', ax: 'between', p: '400' },
          children: [
            // Navigation
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: [
                      { label: 'About', icon: 'book-open', segment: 'about', path: './about' },
                      { label: 'Cards', icon: 'cards-three', segment: 'cards', path: './cards' },
                      { label: 'Graph', icon: 'graph', segment: 'graph', path: './graph' },
                      { label: 'Board', icon: 'check-square', segment: 'board', path: './board' },
                      { label: 'Calendar', icon: 'calendar', segment: 'calendar', path: './calendar' },
                      { label: 'Globe', icon: 'globe-hemisphere-west', segment: 'globe', path: './globe' },
                      { label: 'Settings', icon: 'gear', segment: 'settings', path: './settings' },
                      // { label: 'Flux', icon: 'chat-circle', segment: 'flux', path: './flux' },
                    ],
                    as: 'view',
                  },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        variant: {
                          $if: {
                            condition: { $eq: [{ $store: 'routeStore.segments.2' }, '$view.segment'] },
                            then: 'primary',
                            else: 'ghost',
                          },
                        },
                        onClick: { $action: 'routeStore.navigate', args: ['$view.path'] },
                      },
                      children: [
                        { type: 'we-icon', props: { name: '$view.icon' } },
                        {
                          type: 'we-text',
                          children: ['$view.label'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            // Live presence — who else is in this space right now. Hidden entirely in a personal
            // space (no neighbourhood, so `presenceStore.available` is false) and when nobody else
            // is around, rather than rendering "0 online now".
            {
              type: '$if',
              props: {
                condition: { $gt: [{ $count: { items: { $store: 'presenceStore.online' } } }, 0] },
                // The count, the label and the faces are one statement, so the roster covers all
                // three — "3 online now" is as much the hover target as the avatars are.
                //
                // Written out rather than built with `peopleRow`: this one puts the count first,
                // carries a liveness `tone` per avatar and has no ring, so routing it through the
                // fragment would mean three options serving one call site. Two instances of a
                // shape is a coincidence; the members row above and the participant rows on cards
                // are the three that made a fragment worth having.
                then: peopleTooltip({
                  items: { $store: 'presenceStore.online' },
                  image: '$person.avatar',
                  hash: '$person.did',
                  name: '$person.name',
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300', ay: 'center' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '100', ay: 'center' },
                          children: [
                            {
                              type: 'we-number',
                              props: {
                                value: { $count: { items: { $store: 'presenceStore.online' } } },
                                shorten: true,
                              },
                            },
                            { type: 'we-text', props: { color: 'neutral-800' }, children: ['online now'] },
                          ],
                        },
                        {
                          type: 'AvatarStack',
                          props: {
                            avatars: {
                              $map: {
                                items: { $store: 'presenceStore.online' },
                                select: {
                                  image: '$item.avatar',
                                  hash: '$item.did',
                                  // Ring colour tracks liveness: green active, amber idle, red stale.
                                  // Colour rather than opacity because these avatars overlap — a
                                  // translucent one shows the avatar behind it through itself.
                                  tone: '$item.tone',
                                },
                              },
                            },
                            max: 5,
                            size: 'sm',
                          },
                        },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        },
      ],
    },
  ],
};
