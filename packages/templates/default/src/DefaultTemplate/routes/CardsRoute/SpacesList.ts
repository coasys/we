import type { SchemaNode } from '@we/schema-shared';
import { cardList, cardShell, confirmModal, emptyState, statChip } from '@we/template-kit';

export const spacesList: SchemaNode = cardList({
  query: {
    entity: 'Space',
    where: {
      url: { not: { $store: 'datasetStore.currentDatasetCid' } },
      OR: [{ name: { contains: { $local: 'searchText' } } }, { description: { contains: { $local: 'searchText' } } }],
    },
    limit: 20,
    order: {
      $if: {
        condition: { $eq: [{ $local: 'sortField' }, 'location'] },
        then: { 'location.country': { $local: 'sortDirection' } },
        else: { createdAt: { $local: 'sortDirection' } },
      },
    },
    include: { location: true },
  },
  as: 'space',
  // The space you are in is excluded from the query, so "any spaces" here means any *other* space
  // this one knows about — which is what the sentence has to say for the global directory, where
  // the list is the point of the page.
  empty: emptyState({
    icon: 'users-three',
    label: 'spaces',
    message: {
      $if: {
        condition: { $local: 'searchText' },
        then: 'No spaces match your search.',
        else: "This space doesn't list any other spaces.",
      },
    },
  }),
  children: [
    cardShell({
      header: [
        {
          type: '$if',
          props: {
            condition: '$space.coverImage',
            then: {
              type: 'we-image',
              props: { src: '$space.coverImage', width: '100%', height: '120px', fit: 'cover', r: '400' },
            },
          },
        },
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', width: '100%' },
          $localState: { confirmDeleteOpen: { type: 'boolean', initial: false } },
          children: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '300' },
              children: [
                {
                  type: 'we-avatar',
                  props: { image: '$space.avatar', initials: '$space.name', size: 'lg', shadow: 'md' },
                },
                { type: 'we-text', props: { variant: 'heading-sm' }, children: ['$space.name'] },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $store: 'spaceStore.currentSpace.author' }, '$me.did'] },
                then: {
                  type: 'Row',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: { $setLocal: 'confirmDeleteOpen', value: true },
                      },
                      children: [{ type: 'we-icon', props: { name: 'trash' } }],
                    },
                    confirmModal({
                      openLocal: 'confirmDeleteOpen',
                      title: 'Remove from discovery?',
                      body: 'This will remove this space from the global discovery listing. The space and all its content will remain intact.',
                      confirmLabel: 'Remove',
                      confirm: { $action: 'model.delete', args: ['Space', '$space.id'] },
                    }),
                  ],
                },
              },
            },
          ],
        },
      ],
      body: [
        {
          type: '$if',
          props: {
            condition: '$space.description',
            then: { type: 'we-text', props: { color: 'neutral-600' }, children: ['$space.description'] },
          },
        },
        {
          type: 'Row',
          props: { gap: '500', ay: 'center', wrap: true },
          children: [
            statChip({
              icon: 'lock-simple',
              label: 'Access',
              value: { $if: { condition: '$space.url', then: 'Shared', else: 'Personal' } },
            }),
            statChip({
              icon: 'globe',
              label: 'Discovery',
              value: { $if: { condition: { $eq: ['$space.discovery', 'listed'] }, then: 'Listed', else: 'Hidden' } },
            }),
            {
              type: '$if',
              props: {
                // Gated on city, not the location object: a lat/lng-only location
                // (reverse geocoding off) renders ", " and says nothing. Matches
                // the member card's gate.
                condition: '$space.location.city',
                then: statChip({
                  icon: 'map-pin',
                  label: 'Location',
                  value: { $concat: ['$space.location.city', ', ', '$space.location.country'] },
                }),
              },
            },
            {
              type: 'Row',
              props: { gap: '100', ay: 'center', flex: 'none' },
              children: [
                { type: 'we-icon', props: { name: 'clock', size: 'sm', color: 'neutral-600' } },
                { type: 'we-text', props: { color: 'neutral-600' }, children: ['Created:'] },
                {
                  type: 'we-timestamp',
                  props: { value: '$space.createdAt', relative: true, color: 'neutral-800' },
                },
                { type: 'we-text', props: { color: 'neutral-600' }, children: ['by'] },
                {
                  type: '$agent',
                  props: { did: '$space.author', as: 'creator' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center' },
                      children: [
                        {
                          type: 'we-avatar',
                          props: { size: 'xs', image: '$creator.avatar', hash: '$creator.did' },
                        },
                        {
                          type: 'we-text',
                          props: { color: 'neutral-800' },
                          children: ['$creator.name'],
                        },
                      ],
                    },
                  ],
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
            condition: '$space.url',
            then: {
              type: '$if',
              props: {
                condition: { $in: ['$space.url', { $store: 'datasetStore.joinedSpaceCids' }] },
                then: {
                  type: 'we-button',
                  props: {
                    alignSelf: 'start',
                    text: 'Enter Space',
                    variant: 'primary',
                    size: 'sm',
                    onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.url'] },
                  },
                },
                else: {
                  type: 'we-button',
                  $localState: { joining: { type: 'boolean', initial: false } },
                  props: {
                    text: 'Join Space',
                    variant: 'primary',
                    size: 'sm',
                    alignSelf: 'start',
                    loading: { $local: 'joining' },
                    onClick: [
                      { $setLocal: 'joining', value: true },
                      {
                        $action: 'spaceStore.joinSpace',
                        args: ['$space.url'],
                        onSuccess: [{ $action: 'spaceStore.navigateToSpace', args: ['$space.url'] }],
                        onError: [{ $setLocal: 'joining', value: false }],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      ],
    }),
  ],
});
