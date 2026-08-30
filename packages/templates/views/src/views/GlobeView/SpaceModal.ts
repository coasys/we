/**
 * SpaceModal
 *
 * Rendered when the user clicks a Space pin on the discovery globe.
 * Fetches the selected Space via $single+$query bound to `$local.selectedPin.id`.
 *
 * Layout:
 *   • Optional cover-image banner  ($item.coverImage)
 *   • Row: space avatar circle + name / description
 *   • Signal controls row
 *   • "Join Space" CTA button
 */
import { OFFERED_SIGNAL_TYPES } from '@we/template-kit';

export const spaceModal = {
  type: 'we-modal',
  props: { size: 'md', close: { $setLocal: 'selectedPin', value: null } },
  children: [
    {
      type: '$single',
      props: {
        item: { $query: { entity: 'Space', where: { id: { $: 'local.selectedPin.id' } }, include: { signals: true } } },
        as: 'space',
      },
      children: [
        {
          type: 'Column',
          props: { gap: '400' },
          children: [
            // Cover image
            {
              type: '$if',
              props: {
                condition: { $: 'space.coverImage' },
                then: {
                  type: 'we-image',
                  props: { src: { $: 'space.coverImage' }, width: '100%', height: '160px', fit: 'cover', r: '300' },
                },
              },
            },

            // Avatar + name / description row
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: 'space.avatar' },
                    then: {
                      type: 'we-image',
                      props: { src: { $: 'space.avatar' }, width: '60px', height: '60px', fit: 'cover', r: 'full' },
                    },
                    else: { type: 'we-icon', props: { name: 'globe', size: 'xl', color: 'text-faint' } },
                  },
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    { type: 'we-text', props: { variant: 'heading-md' }, children: [{ $: 'space.name' }] },
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'space.description' },
                        then: {
                          type: 'we-text',
                          props: { variant: 'body' },
                          children: [{ $: 'space.description' }],
                        },
                      },
                    },
                  ],
                },
              ],
            },

            // Signal controls
            {
              /*
                Hoisted rather than queried inline, so the list can be filtered.

                A retired type must not be offered. A `where` would serve *this* modal — it never
                resolves a slug — but every other site shares one subscription between the controls
                and a `find()`-by-slug count that must still see retired types, so the filter lives
                at the point of use everywhere rather than in two spellings. `filter()` cannot name
                an inline `$query`'s results, hence the hoist. See `OFFERED_SIGNAL_TYPES`.
              */
              type: 'Column',
              props: { gap: '200' },
              $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
              children: [
                {
                  type: '$each',
                  props: { items: { $: OFFERED_SIGNAL_TYPES }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: { $: 'sig' },
                        signals: { $: 'filter(space.signals, { signalTypeId: sig.id })' },
                        myDid: { $: 'me.did' },
                        onSignal: {
                          $action: 'spaceStore.upsertSignal',
                          args: [{ $: 'space.id' }, { $: 'sig.id' }, { $: 'arg' }],
                        },
                      },
                    },
                  ],
                },
              ],
            },

            // Enter / Join CTA — only shown for spaces with a neighbourhood URL.
            // Spaces synced to the global perspective before the url fix may have url=null.
            {
              type: '$if',
              props: {
                condition: { $: 'space.url' },
                then: {
                  type: '$if',
                  props: {
                    condition: { $: 'space.url in datasetStore.joinedSpaceCids' },
                    then: {
                      type: 'we-button',
                      props: {
                        text: 'Enter Space',
                        variant: 'primary',
                        height: '40px',
                        onClick: [
                          { $setLocal: 'selectedPin', value: null },
                          { $action: 'spaceStore.navigateToSpace', args: [{ $: 'space.url' }] },
                        ],
                      },
                    },
                    else: {
                      type: 'we-button',
                      props: {
                        text: 'Join Space',
                        variant: 'primary',
                        height: '40px',
                        onClick: {
                          $action: 'spaceStore.joinSpace',
                          args: [{ $: 'space.url' }],
                          onSuccess: [
                            { $setLocal: 'selectedPin', value: null },
                            { $action: 'spaceStore.navigateToSpace', args: [{ $: 'space.url' }] },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  ],
};
