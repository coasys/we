import type { RouteSchema, SchemaNode, SchemaProp } from '@we/schema-shared';
import { attributeRow, pageShell, sectionCard } from '@we/template-kit';

import { createSignalTypeModal } from './CreateSignalTypeModal.ts';
import { marketplaceBrowser } from './MarketplaceBrowser.ts';
import { modelsSection } from './ModelsSection.ts';
import { relationshipTypesSection } from './RelationshipTypesSection.ts';
import { signalTypeCard } from './SignalTypeCard.ts';
import { themeMarketplaceBrowser } from './ThemeMarketplaceBrowser.ts';

/**
 * A row in one of the "what do members see by default" pickers.
 *
 * Templates and themes had a row each, identical down to the padding, and they had already begun to
 * drift — one compared `$template.id` against the space default while the marketplace list compared
 * `$template.slug`. One generator, two calls, one comparison.
 *
 * The current default states itself with a badge rather than a disabled button: there is nothing to
 * press on the row you are already using, and a greyed-out "Set as default" invites the press anyway.
 */
const defaultPickerRow = (opts: {
  as: string;
  icon: SchemaProp;
  name: string;
  currentDefault: string;
  setDefault: string;
}): SchemaNode => {
  const isDefault = { $eq: [`$${opts.as}.id`, { $store: opts.currentDefault }] };

  return {
    type: 'Row',
    props: {
      ay: 'center',
      ax: 'between',
      p: '300',
      r: '300',
      bg: { $if: { condition: isDefault, then: 'surface-active', else: 'page' } },
    },
    children: [
      {
        type: 'Row',
        props: { ay: 'center', gap: '300' },
        children: [
          { type: 'we-icon', props: { name: opts.icon } },
          { type: 'we-text', props: { fontWeight: 'semibold' }, children: [opts.name] },
        ],
      },
      {
        type: '$if',
        props: {
          condition: isDefault,
          then: { type: 'we-badge', props: { variant: 'primary', size: 'sm' }, children: ['Default'] },
          else: {
            type: 'we-button',
            props: {
              variant: 'secondary',
              size: 'sm',
              onClick: { $action: opts.setDefault, args: [`$${opts.as}.id`] },
            },
            children: ['Set as default'],
          },
        },
      },
    ],
  };
};

const templateRow: SchemaNode = defaultPickerRow({
  as: 'template',
  icon: '$template.meta.icon',
  name: '$template.meta.name',
  currentDefault: 'spaceStore.spaceDefaultTemplateId',
  setDefault: 'spaceStore.setSpaceDefaultTemplate',
});

const themeRow: SchemaNode = defaultPickerRow({
  as: 'theme',
  icon: '$theme.icon',
  name: '$theme.name',
  currentDefault: 'spaceStore.spaceDefaultThemeId',
  setDefault: 'spaceStore.setSpaceDefaultTheme',
});

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
  $localState: {
    showMarketplace: { type: 'boolean', initial: false },
    showThemeMarketplace: { type: 'boolean', initial: false },
    createSignalTypeOpen: { type: 'boolean', initial: false },
    createRelationshipTypeOpen: { type: 'boolean', initial: false },
    editName: { type: 'string', initial: { $store: 'spaceStore.currentSpace.name' } },
    editDescription: { type: 'string', initial: { $store: 'spaceStore.currentSpace.description' } },
    saving: { type: 'boolean', initial: false },
    isDirty: { type: 'boolean', initial: false },
    editLocation: { type: 'boolean', initial: false },
    location: { type: 'object', initial: { $store: 'spaceStore.currentSpace.location' } },
    locationDirty: { type: 'boolean', initial: false },
  },
  ...pageShell({
    children: [
      sectionCard({
        title: 'About this space',
        description: 'Manage how this space appears to others.',
        // Everything on this card saves on blur, so the only signal that a change was taken is
        // this spinner. It sits by the title rather than by the field, because a blur has usually
        // moved the cursor somewhere else by the time the write lands.
        aside: {
          type: '$if',
          props: { condition: { $local: 'saving' }, then: { type: 'we-spinner', props: { size: 'sm' } } },
        },
        children: [
          // Name
          {
            type: 'Column',
            props: { gap: '100' },
            children: [
              { type: 'we-text', props: { color: 'text' }, children: ['Name'] },
              {
                type: 'we-form-field',
                children: [
                  {
                    type: 'we-input',
                    props: {
                      value: { $local: 'editName' },
                      disabled: { $local: 'saving' },
                      fontSize: '500',
                      fontWeight: 'semibold',
                      onInput: [
                        { $setLocal: 'editName', from: '$event.detail' },
                        { $setLocal: 'isDirty', value: true },
                      ],
                      onBlur: saveOnBlur,
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
              { type: 'we-text', props: { color: 'text' }, children: ['Description'] },
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

          attributeRow({
            icon: 'globe',
            label: 'Discovery',
            value: {
              $if: {
                condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                then: 'Listed',
                else: 'Hidden',
              },
            },
            description: {
              $if: {
                condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                then: 'Appears on the WE discovery globe',
                else: 'Not shown in global discovery',
              },
            },
            control: {
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
          }),

          attributeRow({
            icon: 'map-pin',
            label: 'Location',
            value: {
              $if: {
                condition: { $store: 'spaceStore.currentSpace.location' },
                then: {
                  $concat: [
                    { $store: 'spaceStore.currentSpace.location.city' },
                    ', ',
                    { $store: 'spaceStore.currentSpace.location.country' },
                  ],
                },
                else: 'Not set',
              },
            },
            control: {
              type: 'Row',
              props: { ay: 'center', gap: '300' },
              children: [
                {
                  type: 'we-button',
                  props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: 'editLocation' } },
                  children: [{ $if: { condition: { $local: 'editLocation' }, then: 'Hide', else: 'Edit' } }],
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
          }),

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
      }),

      // Default Template
      sectionCard({
        title: 'Default Template',
        description: 'Choose the template members see when they enter this space.',
        children: [
          // Core templates
          {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: 'we-text',
                props: { variant: 'body', fontWeight: 'semibold', textTransform: 'uppercase' },
                children: ['Built-in Templates'],
              },
              {
                type: '$each',
                props: { items: { $store: 'templateStore.builtInTemplates' }, as: 'template' },
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
                    props: {
                      variant: 'body',
                      fontWeight: 'semibold',
                      textTransform: 'uppercase',
                    },
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
                    props: {
                      variant: 'body',
                      fontWeight: 'semibold',
                      textTransform: 'uppercase',
                    },
                    children: ['Browse Marketplace'],
                  },
                  {
                    type: 'we-text',
                    props: { variant: 'body' },
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
      }),

      // Default Theme
      sectionCard({
        title: 'Default Theme',
        description: 'Choose the theme members see when they enter this space.',
        children: [
          // Built-in themes
          {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: 'we-text',
                props: { variant: 'body', fontWeight: 'semibold', textTransform: 'uppercase' },
                children: ['Built-in Themes'],
              },
              {
                type: '$each',
                props: { items: { $store: 'themeStore.builtInThemes' }, as: 'theme' },
                children: [themeRow],
              },
              // "Follow system" is not one of them — see `automaticThemes` — but it is a choice made
              // in the same place, so it is offered here under its own heading rather than dropped.
              {
                type: 'we-text',
                props: { variant: 'body', fontWeight: 'semibold', textTransform: 'uppercase' },
                children: ['Automatic'],
              },
              {
                type: '$each',
                props: { items: { $store: 'themeStore.automaticThemes' }, as: 'theme' },
                children: [themeRow],
              },
              /*
                Which two themes it chooses between.

                Without these the row above means "match my machine, using the two built-ins" — so
                an agent who had made their own pair could follow their machine or wear their own
                themes and never both. "Built-in" is the way back out; it is an option from the
                store rather than a row here, because a schema can map a list into options and
                cannot prepend one.
              */
              {
                type: 'Row',
                props: { gap: '300', ay: 'center', wrap: true },
                children: [
                  {
                    type: 'we-form-field',
                    props: { label: 'When my system is light', size: 'sm', flex: '1', minWidth: '180px' },
                    children: [
                      {
                        type: 'we-select',
                        props: {
                          size: 'sm',
                          options: { $store: 'themeStore.systemThemeOptions' },
                          value: { $store: 'themeStore.systemThemes.light' },
                          onChange: { $action: 'themeStore.setSystemTheme', args: ['light', '$arg.detail'] },
                        },
                      },
                    ],
                  },
                  {
                    type: 'we-form-field',
                    props: { label: 'When my system is dark', size: 'sm', flex: '1', minWidth: '180px' },
                    children: [
                      {
                        type: 'we-select',
                        props: {
                          size: 'sm',
                          options: { $store: 'themeStore.systemThemeOptions' },
                          value: { $store: 'themeStore.systemThemes.dark' },
                          onChange: { $action: 'themeStore.setSystemTheme', args: ['dark', '$arg.detail'] },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },

          // Space themes (only shown when present)
          {
            type: '$if',
            props: {
              condition: { $count: { items: { $store: 'themeStore.spaceThemes' } } },
              then: {
                type: 'Column',
                props: { gap: '200' },
                children: [
                  {
                    type: 'we-text',
                    props: {
                      variant: 'body',
                      fontWeight: 'semibold',
                      textTransform: 'uppercase',
                    },
                    children: ['Space Themes'],
                  },
                  {
                    type: '$each',
                    props: { items: { $store: 'themeStore.spaceThemes' }, as: 'theme' },
                    children: [themeRow],
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
                    props: {
                      variant: 'body',
                      fontWeight: 'semibold',
                      textTransform: 'uppercase',
                    },
                    children: ['Browse Marketplace'],
                  },
                  {
                    type: 'we-text',
                    props: { variant: 'body' },
                    children: ['Install themes from the marketplace into this space.'],
                  },
                ],
              },
              {
                type: 'we-button',
                props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: 'showThemeMarketplace' } },
                children: [
                  {
                    type: '$if',
                    props: {
                      condition: { $local: 'showThemeMarketplace' },
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
            props: { condition: { $local: 'showThemeMarketplace' }, then: themeMarketplaceBrowser },
          },
        ],
      }),

      sectionCard({
        title: 'Signal Types',
        description: 'Create and manage custom signal types to categorize and enrich your signals.',
        aside: {
          type: 'we-button',
          props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'createSignalTypeOpen', value: true } },
          children: [
            { type: 'we-icon', props: { name: 'plus' } },
            { type: 'we-text', children: ['Add Signal Type'] },
          ],
        },
        children: [
          {
            type: '$each',
            props: { items: { $query: { entity: 'SignalType', subscribe: true } }, as: 'signalType' },
            children: [signalTypeCard],
          },
          {
            type: '$if',
            props: { condition: { $local: 'createSignalTypeOpen' }, then: createSignalTypeModal },
          },
        ],
      }),

      // Beside Signal Types and the models section, because all three are the same act at different
      // levels: a community naming what a reaction means, what a connection means, and what a thing
      // *is*. See `docs/architecture/relations.md` for where the middle one sits.
      relationshipTypesSection,

      modelsSection,
    ],
  }),
};
