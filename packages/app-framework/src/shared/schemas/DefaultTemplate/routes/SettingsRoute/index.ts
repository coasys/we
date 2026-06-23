import type { RouteSchema, SchemaNode } from '@we/schema-shared';

import { marketplaceBrowser } from './MarketplaceBrowser.ts';

const templateRow: SchemaNode = {
  type: 'Row',
  props: {
    ay: 'center',
    ax: 'between',
    p: '300',
    r: '300',
    border: '1px solid neutral-200',
    bg: {
      $if: {
        condition: { $eq: ['$template.id', { $store: 'spaceStore.spaceDefaultTemplateId' }] },
        then: 'primary-50',
        else: 'neutral-0',
      },
    },
  },
  children: [
    {
      type: 'Row',
      props: { ay: 'center', gap: '300' },
      children: [
        { type: 'we-icon', props: { name: '$template.meta.icon' } },
        { type: 'we-text', props: { fontWeight: '600' }, children: ['$template.meta.name'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $eq: ['$template.id', { $store: 'spaceStore.spaceDefaultTemplateId' }] },
        then: {
          type: 'we-badge',
          props: { variant: 'primary' },
          children: ['Default'],
        },
        else: {
          type: 'we-button',
          props: {
            variant: 'secondary',
            size: 'sm',
            onClick: { $action: 'spaceStore.setSpaceDefaultTemplate', args: ['$template.id'] },
          },
          children: ['Set as default'],
        },
      },
    },
  ],
};

const saveLocationOnBlur = [
  {
    $if: {
      condition: { $local: 'locationDirty' },
      then: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [
          {
            location: {
              latitude: { $local: 'locationLat' },
              longitude: { $local: 'locationLng' },
              city: { $local: 'locationCity' },
              country: { $local: 'locationCountry' },
              countryCode: { $local: 'locationCountryCode' },
            },
          },
        ],
        onFinally: [{ $setLocal: 'locationDirty', value: false }],
      },
    },
  },
];

const saveOnBlur = [
  { $if: { condition: { $local: 'isDirty' }, then: { $setLocal: 'saving', value: true } } },
  {
    $if: {
      condition: { $local: 'isDirty' },
      then: {
        $action: 'spaceStore.updateSpaceMeta',
        args: [{ name: { $local: 'editName' }, description: { $local: 'editDescription' } }],
        onFinally: [
          { $setLocal: 'saving', value: false },
          { $setLocal: 'isDirty', value: false },
        ],
      },
    },
  },
];

export const settingsRoute: RouteSchema = {
  path: '/settings',
  type: 'Column',
  props: { width: '100%', ax: 'center', height: 'calc(100vh - 72px)' },
  $localState: {
    showMarketplace: { type: 'boolean', initial: false },
    editName: { type: 'string', initial: { $store: 'spaceStore.currentSpace.name' } },
    editDescription: { type: 'string', initial: { $store: 'spaceStore.currentSpace.description' } },
    saving: { type: 'boolean', initial: false },
    isDirty: { type: 'boolean', initial: false },
    locationCity: {
      type: 'string',
      initial: {
        $if: {
          condition: { $store: 'spaceStore.currentSpace.location' },
          then: { $store: 'spaceStore.currentSpace.location.city' },
          else: '',
        },
      },
    },
    locationCountry: {
      type: 'string',
      initial: {
        $if: {
          condition: { $store: 'spaceStore.currentSpace.location' },
          then: { $store: 'spaceStore.currentSpace.location.country' },
          else: '',
        },
      },
    },
    locationCountryCode: {
      type: 'string',
      initial: {
        $if: {
          condition: { $store: 'spaceStore.currentSpace.location' },
          then: { $store: 'spaceStore.currentSpace.location.countryCode' },
          else: '',
        },
      },
    },
    locationLat: {
      type: 'number',
      initial: {
        $if: {
          condition: { $store: 'spaceStore.currentSpace.location' },
          then: { $store: 'spaceStore.currentSpace.location.latitude' },
          else: null,
        },
      },
    },
    locationLng: {
      type: 'number',
      initial: {
        $if: {
          condition: { $store: 'spaceStore.currentSpace.location' },
          then: { $store: 'spaceStore.currentSpace.location.longitude' },
          else: null,
        },
      },
    },
    locationDirty: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '1200px', gap: '500', px: '400', pt: '500' },
      children: [
        // ─── About this space ───────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
          children: [
            // Header row — title + saving spinner
            {
              type: 'Row',
              props: { ax: 'between', ay: 'center' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
                      children: ['About this space'],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'neutral-600' },
                      children: ['Manage how this space appears to others.'],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $local: 'saving' },
                    then: { type: 'we-spinner', props: { size: 'sm' } },
                  },
                },
              ],
            },

            // Name
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                { type: 'we-text', props: { fontSize: '500', color: 'neutral-600' }, children: ['Name'] },
                {
                  type: 'we-form-field',
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'editName' },
                        disabled: { $local: 'saving' },
                        onInput: [
                          { $setLocal: 'editName', from: '$event.detail' },
                          { $setLocal: 'isDirty', value: true },
                        ],
                        onBlur: saveOnBlur,
                        fontSize: '600',
                        fontWeight: 'bold',
                      },
                    },
                  ],
                },
              ],
            },

            // Description
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                { type: 'we-text', props: { fontSize: '500', color: 'neutral-600' }, children: ['Description'] },
                {
                  type: 'we-form-field',
                  children: [
                    {
                      type: 'we-textarea',
                      props: {
                        value: { $local: 'editDescription' },
                        disabled: { $local: 'saving' },
                        onInput: [
                          { $setLocal: 'editDescription', from: '$event.detail' },
                          { $setLocal: 'isDirty', value: true },
                        ],
                        onBlur: saveOnBlur,
                      },
                    },
                  ],
                },
              ],
            },

            // { type: 'we-divider', props: { my: '400' } },

            {
              type: 'Row',
              props: { ay: 'center', ax: 'between', wrap: true },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '400' },
                  children: [
                    { type: 'we-icon', props: { name: 'globe', color: 'primary-600' } },
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300' },
                          children: [
                            {
                              type: 'we-text',
                              props: { color: 'neutral-700', fontWeight: 'bold' },
                              children: ['Discovery:'],
                            },
                            {
                              type: 'we-text',
                              props: { fontWeight: 'bold' },
                              children: [
                                {
                                  $if: {
                                    condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                                    then: 'Listed',
                                    else: 'Hidden',
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'we-text',
                          props: { color: 'neutral-700', fontSize: '400' },
                          children: [
                            {
                              $if: {
                                condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                                then: 'Appears on the WE discovery globe',
                                else: 'Not shown in global discovery',
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'we-switch',
                  props: {
                    py: '400',
                    checked: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                    labelOn: 'Listed',
                    labelOff: 'Hidden',
                    disabled: { $local: 'saving' },
                    onChange: {
                      $action: 'spaceStore.updateSpaceMeta',
                      args: [
                        {
                          discovery: {
                            $if: {
                              condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                              then: 'hidden',
                              else: 'listed',
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },

            // Location
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-form-field',
                  props: { label: 'Location' },
                  children: [
                    {
                      type: 'we-location-picker',
                      props: {
                        latitude: { $local: 'locationLat' },
                        longitude: { $local: 'locationLng' },
                        onChange: [
                          // Null event fires internally before geocoding when picking a new pin —
                          // only clear local state here, never touch the store (avoids race with confirm)
                          {
                            $if: {
                              condition: { $not: '$event.detail' },
                              then: { $setLocal: 'locationLat', value: null },
                            },
                          },
                          {
                            $if: {
                              condition: { $not: '$event.detail' },
                              then: { $setLocal: 'locationLng', value: null },
                            },
                          },
                          {
                            $if: {
                              condition: { $not: '$event.detail' },
                              then: { $setLocal: 'locationCity', value: '' },
                            },
                          },
                          {
                            $if: {
                              condition: { $not: '$event.detail' },
                              then: { $setLocal: 'locationCountry', value: '' },
                            },
                          },
                          {
                            $if: {
                              condition: { $not: '$event.detail' },
                              then: { $setLocal: 'locationCountryCode', value: '' },
                            },
                          },
                          // Confirm — populate local state then save to store
                          {
                            $if: {
                              condition: '$event.detail',
                              then: { $setLocal: 'locationLat', from: '$event.detail.latitude' },
                            },
                          },
                          {
                            $if: {
                              condition: '$event.detail',
                              then: { $setLocal: 'locationLng', from: '$event.detail.longitude' },
                            },
                          },
                          {
                            $if: {
                              condition: '$event.detail',
                              then: { $setLocal: 'locationCity', from: '$event.detail.city' },
                            },
                          },
                          {
                            $if: {
                              condition: '$event.detail',
                              then: { $setLocal: 'locationCountry', from: '$event.detail.country' },
                            },
                          },
                          {
                            $if: {
                              condition: '$event.detail',
                              then: { $setLocal: 'locationCountryCode', from: '$event.detail.countryCode' },
                            },
                          },
                          {
                            $if: {
                              condition: '$event.detail',
                              then: {
                                $action: 'spaceStore.updateSpaceMeta',
                                args: [
                                  {
                                    location: {
                                      latitude: { $local: 'locationLat' },
                                      longitude: { $local: 'locationLng' },
                                      city: { $local: 'locationCity' },
                                      country: { $local: 'locationCountry' },
                                      countryCode: { $local: 'locationCountryCode' },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $local: 'locationLat' },
                    then: {
                      type: 'Column',
                      props: { gap: '300' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300' },
                          children: [
                            {
                              type: 'we-form-field',
                              props: { label: 'City', flex: '1' },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    value: { $local: 'locationCity' },
                                    placeholder: 'City…',
                                    onInput: [
                                      { $setLocal: 'locationCity', from: '$event.detail' },
                                      { $setLocal: 'locationDirty', value: true },
                                    ],
                                    onBlur: saveLocationOnBlur,
                                  },
                                },
                              ],
                            },
                            {
                              type: 'we-form-field',
                              props: { label: 'Country', flex: '1' },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    value: { $local: 'locationCountry' },
                                    placeholder: 'Country…',
                                    onInput: [
                                      { $setLocal: 'locationCountry', from: '$event.detail' },
                                      { $setLocal: 'locationDirty', value: true },
                                    ],
                                    onBlur: saveLocationOnBlur,
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'sm',
                            onClick: [
                              { $setLocal: 'locationLat', value: null },
                              { $setLocal: 'locationLng', value: null },
                              { $setLocal: 'locationCity', value: '' },
                              { $setLocal: 'locationCountry', value: '' },
                              { $setLocal: 'locationCountryCode', value: '' },
                              { $action: 'spaceStore.updateSpaceMeta', args: [{ location: null }] },
                            ],
                          },
                          children: [
                            { type: 'we-icon', props: { name: 'trash', color: 'danger-400' } },
                            { type: 'we-text', props: { color: 'danger-400' }, children: ['Remove location'] },
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },

        // ─── Default Template ───────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
          children: [
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
                  children: ['Default Template'],
                },
                {
                  type: 'we-text',
                  props: { color: 'neutral-600' },
                  children: ['Choose the template members see when they enter this space.'],
                },
              ],
            },

            // Core templates
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: '600', color: 'neutral-500', textTransform: 'uppercase' },
                  children: ['Core Templates'],
                },
                {
                  type: '$each',
                  props: { items: { $store: 'templateStore.coreTemplates' }, as: 'template' },
                  children: [templateRow],
                },
              ],
            },

            // Space templates (only shown when present)
            {
              type: '$if',
              props: {
                condition: {
                  $gt: [{ $count: { items: { $store: 'templateStore.spaceTemplates' } } }, 0],
                },
                then: {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: '600', color: 'neutral-500', textTransform: 'uppercase' },
                      children: ['Space Templates'],
                    },
                    {
                      type: '$each',
                      props: { items: { $store: 'templateStore.spaceTemplates' }, as: 'template' },
                      children: [templateRow],
                    },
                  ],
                },
              },
            },

            // Browse Marketplace (merged into this section)
            {
              type: 'Row',
              props: { ax: 'between', ay: 'center' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: '600', color: 'neutral-500', textTransform: 'uppercase' },
                      children: ['Browse Marketplace'],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'neutral-800', fontSize: '400' },
                      children: ['Install templates from the marketplace into this space.'],
                    },
                  ],
                },
                {
                  type: 'we-button',
                  props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: 'showMarketplace' } },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $local: 'showMarketplace' },
                        then: { type: 'we-text', children: ['Hide'] },
                        else: {
                          type: 'Row',
                          props: { gap: '200', ay: 'center' },
                          children: [
                            { type: 'we-icon', props: { name: 'magnifying-glass' } },
                            { type: 'we-text', children: ['Browse'] },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $local: 'showMarketplace' },
                then: marketplaceBrowser,
              },
            },
          ],
        },
      ],
    },
  ],
};
