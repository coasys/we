import type { RouteSchema } from '@we/schema-shared';

export const aboutRoute: RouteSchema = {
  path: '/about',
  type: 'Column',
  props: { width: '100%', ax: 'center', height: 'calc(100vh - 72px)' },
  children: [
    {
      type: '$single',
      props: {
        item: {
          $query: {
            model: 'Space',
            where: { uuid: { $store: 'adamStore.currentPerspective.uuid' } },
            include: { location: true },
          },
        },
        as: 'space',
      },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: '1200px', gap: '500', px: '400', pt: '500' },
          $localState: {
            editing: { type: 'boolean', initial: false },
            editName: { type: 'string', initial: '' },
            editDescription: { type: 'string', initial: '' },
          },
          children: [
            // ─── Name & Description ───────────────────────────────────────────
            {
              type: 'Column',
              props: { gap: '500', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
              children: [
                // Section header: title + edit/cancel toggle
                {
                  type: 'Row',
                  props: { ay: 'center', ax: 'between' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
                      // props: { fontSize: '600', fontWeight: 'bold', textTransform: 'uppercase', color: 'primary-700' },
                      children: ['About this space'],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $not: { $local: 'editing' } },
                        then: {
                          type: 'we-button',
                          props: {
                            variant: 'secondary',
                            size: 'sm',
                            onClick: [
                              { $setLocal: 'editName', from: '$space.name' },
                              { $setLocal: 'editDescription', from: '$space.description' },
                              { $setLocal: 'editing', value: true },
                            ],
                          },
                          children: [
                            { type: 'we-icon', props: { name: 'pencil-simple' } },
                            { type: 'we-text', children: ['Edit'] },
                          ],
                        },
                      },
                    },
                  ],
                },

                // View mode
                {
                  type: '$if',
                  props: {
                    condition: { $not: { $local: 'editing' } },
                    then: {
                      type: 'Column',
                      props: { gap: '400' },
                      children: [
                        {
                          type: 'Column',
                          props: { gap: '100' },
                          children: [
                            { type: 'we-text', props: { fontSize: '500', color: 'neutral-600' }, children: ['Name'] },
                            {
                              type: 'we-text',
                              props: { fontSize: '700', fontWeight: 'bold' },
                              children: ['$space.name'],
                            },
                          ],
                        },
                        {
                          type: 'Column',
                          props: { gap: '100' },
                          children: [
                            {
                              type: 'we-text',
                              props: { fontSize: '500', color: 'neutral-600' },
                              children: ['Description'],
                            },
                            {
                              type: '$if',
                              props: {
                                condition: '$space.description',
                                then: { type: 'we-text', children: ['$space.description'] },
                                else: {
                                  type: 'we-text',
                                  props: { color: 'neutral-500', italic: true },
                                  children: ['No description...'],
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                },

                // Edit mode
                {
                  type: '$if',
                  props: {
                    condition: { $local: 'editing' },
                    then: {
                      type: 'Column',
                      props: { gap: '500' },
                      children: [
                        {
                          type: 'we-form-field',
                          props: { label: 'Name' },
                          children: [
                            {
                              type: 'we-input',
                              props: {
                                value: { $local: 'editName' },
                                onInput: { $setLocal: 'editName', from: '$event.detail' },
                                placeholder: 'Space name',
                              },
                            },
                          ],
                        },
                        {
                          type: 'we-form-field',
                          props: { label: 'Description' },
                          children: [
                            {
                              type: 'we-textarea',
                              props: {
                                value: { $local: 'editDescription' },
                                onInput: { $setLocal: 'editDescription', from: '$event.detail' },
                                placeholder: 'Space description',
                                // rows: 6,
                              },
                            },
                          ],
                        },
                        {
                          type: 'Row',
                          props: { gap: '300' },
                          children: [
                            {
                              type: 'we-button',
                              props: { variant: 'secondary', onClick: { $setLocal: 'editing', value: false } },
                              children: ['Cancel'],
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'primary',
                                onClick: {
                                  $action: 'model.update',
                                  args: [
                                    'Space',
                                    '$space.id',
                                    {
                                      name: { $local: 'editName' },
                                      description: { $local: 'editDescription' },
                                    },
                                  ],
                                  onSuccess: [{ $setLocal: 'editing', value: false }],
                                },
                              },
                              children: ['Save changes'],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },

                // Visibility
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '300', py: '100' },
                  children: [
                    { type: 'we-icon', props: { name: 'eye' } },
                    { type: 'we-text', props: { color: 'neutral-600' }, children: ['Visibility'] },
                    {
                      type: 'we-badge',
                      props: {
                        variant: {
                          $if: {
                            condition: { $eq: ['$space.visibility', 'public'] },
                            then: 'success',
                            else: 'neutral',
                          },
                        },
                      },
                      children: ['$space.visibility'],
                    },
                  ],
                },

                // Location (if set)
                {
                  type: '$if',
                  props: {
                    condition: '$space.location',
                    then: {
                      type: 'Row',
                      props: { ay: 'center', gap: '300', py: '100' },
                      children: [
                        { type: 'we-icon', props: { name: 'map-pin' } },
                        { type: 'we-text', props: { color: 'neutral-600' }, children: ['Location'] },
                        { type: 'we-text', children: ['$space.location.address'] },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
