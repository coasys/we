import type { RouteSchema, SchemaNode } from '@we/schema-shared';

import { marketplaceBrowser } from './MarketplaceBrowser.ts';

const templateRow: SchemaNode = {
  type: 'Row',
  props: {
    ay: 'center',
    ax: 'between',
    p: '300',
    r: '300',
    bg: {
      $if: {
        condition: { $eq: ['$template.id', { $store: 'spaceStore.spaceDefaultTemplateId' }] },
        then: 'neutral-200',
        else: 'neutral-50',
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
          props: { variant: 'primary', size: 'sm' },
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
        args: [{ location: { $local: 'location' } }],
        onFinally: [{ $setLocal: 'locationDirty', value: false }],
      },
    },
  },
];

const saveOnBlur = [
  {
    $if: {
      condition: { $local: 'isDirty' },
      then: [
        { $setLocal: 'saving', value: true },
        {
          $action: 'spaceStore.updateSpaceMeta',
          args: [{ name: { $local: 'editName' }, description: { $local: 'editDescription' } }],
          onFinally: [
            { $setLocal: 'saving', value: false },
            { $setLocal: 'isDirty', value: false },
          ],
        },
      ],
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
    editLocation: { type: 'boolean', initial: false },
    location: { type: 'object', initial: { $store: 'spaceStore.currentSpace.location' } },
    locationDirty: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '1200px', gap: '500', px: '400', pt: '500' },
      children: [
        // About this space
        {
          type: 'Column',
          props: { gap: '500', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
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

            // Discovery
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
              type: 'Row',
              props: { ay: 'center', ax: 'between', wrap: true },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '400', py: '100' },
                  children: [
                    { type: 'we-icon', props: { name: 'map-pin', color: 'primary-600' } },
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
                              children: ['Location:'],
                            },
                            {
                              type: '$if',
                              props: {
                                condition: { $store: 'spaceStore.currentSpace.location' },
                                then: {
                                  type: 'we-text',
                                  props: { fontWeight: 'bold' },
                                  children: [
                                    {
                                      $concat: [
                                        { $store: 'spaceStore.currentSpace.location.city' },
                                        ', ',
                                        { $store: 'spaceStore.currentSpace.location.country' },
                                      ],
                                    },
                                  ],
                                },
                                else: {
                                  type: 'we-text',
                                  props: { fontWeight: 'bold' },
                                  children: ['Not set'],
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '300' },
                  children: [
                    {
                      type: 'we-button',
                      props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: 'editLocation' } },
                      children: [
                        {
                          type: '$if',
                          props: {
                            condition: { $local: 'editLocation' },
                            then: { type: 'we-text', children: ['Hide'] },
                            else: { type: 'we-text', children: ['Edit'] },
                          },
                        },
                      ],
                    },
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'danger',
                        onClick: [
                          { $setLocal: 'location', value: null },
                          { $action: 'spaceStore.updateSpaceMeta', args: [{ location: null }] },
                        ],
                      },
                      children: [
                        { type: 'we-icon', props: { name: 'trash' } },
                        { type: 'we-text', children: ['Remove'] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $local: 'editLocation' },
                then: {
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
                            latitude: { $local: 'location.latitude' },
                            longitude: { $local: 'location.longitude' },
                            onChange: [
                              { $setLocal: 'location', from: '$event.detail' },
                              {
                                $action: 'spaceStore.updateSpaceMeta',
                                args: [{ location: { $local: 'location' } }],
                              },
                            ],
                          },
                        },
                      ],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $local: 'location' },
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
                                        value: { $local: 'location.city' },
                                        placeholder: 'City…',
                                        onInput: [
                                          { $setLocal: 'location', merge: { city: '$event.detail' } },
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
                                        value: { $local: 'location.country' },
                                        placeholder: 'Country…',
                                        onInput: [
                                          { $setLocal: 'location', merge: { country: '$event.detail' } },
                                          { $setLocal: 'locationDirty', value: true },
                                        ],
                                        onBlur: saveLocationOnBlur,
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },

        // Default Template
        {
          type: 'Column',
          props: { gap: '500', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
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
                condition: { $count: { items: { $store: 'templateStore.spaceTemplates' } } },
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

            // Browse Marketplace
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
              props: { condition: { $local: 'showMarketplace' }, then: marketplaceBrowser },
            },
          ],
        },

        // Default Theme
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
                  children: ['Default Theme'],
                },
                {
                  type: 'we-text',
                  props: { color: 'neutral-600' },
                  children: ['Choose the theme members see when they enter this space.'],
                },
              ],
            },
            {
              type: '$each',
              props: { items: { $store: 'themeStore.allThemes' }, as: 'theme' },
              children: [
                {
                  type: 'Row',
                  props: {
                    ay: 'center',
                    ax: 'between',
                    p: '300',
                    r: '300',
                    bg: {
                      $if: {
                        condition: { $eq: ['$theme.id', { $store: 'spaceStore.spaceDefaultThemeId' }] },
                        then: 'neutral-200',
                        else: 'neutral-50',
                      },
                    },
                  },
                  children: [
                    {
                      type: 'Row',
                      props: { ay: 'center', gap: '300' },
                      children: [
                        { type: 'we-icon', props: { name: '$theme.icon' } },
                        { type: 'we-text', props: { fontWeight: '600' }, children: ['$theme.name'] },
                      ],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $eq: ['$theme.id', { $store: 'spaceStore.spaceDefaultThemeId' }] },
                        then: {
                          type: 'we-badge',
                          props: { variant: 'primary', size: 'sm' },
                          children: ['Default'],
                        },
                        else: {
                          type: 'we-button',
                          props: {
                            variant: 'secondary',
                            size: 'sm',
                            onClick: { $action: 'spaceStore.setSpaceDefaultTheme', args: ['$theme.id'] },
                          },
                          children: ['Set as default'],
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
    },
  ],
};
