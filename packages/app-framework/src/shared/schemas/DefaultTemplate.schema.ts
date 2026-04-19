/**
 * Default Template
 *
 * Welcome screen showing all perspectives grouped into three categories:
 * - Shared Spaces: perspectives with a Space model published as neighbourhoods
 * - Personal Spaces: perspectives with a Space model (local only)
 * - All Perspectives: every AD4M perspective (raw graphs)
 *
 * Also provides a form to create new spaces.
 */

import type { TemplateSchema } from '@we/schema-shared';

export const defaultTemplate: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', bg: 'neutral-50' },
  children: [
    {
      type: 'Column',
      props: { maxWidth: '1200px', width: '100%', bg: 'neutral-50', p: '500', gap: '400' },
      children: [{ type: '$routes' }],
    },
  ],
  routes: [
    // ── Welcome / Home ──
    {
      path: '/',
      type: 'Column',
      props: { gap: '600', maxWidth: '900px', mx: 'auto', width: '100%' },
      $localState: {
        createSpaceOpen: { type: 'boolean', initial: false },
        name: {
          type: 'string',
          initial: '',
          validate: [{ rule: 'required', message: 'Name is required' }],
        },
        description: { type: 'string', initial: '' },
        shared: { type: 'boolean', initial: false },
        thumbnail: { type: 'file', initial: null },
      },
      children: [
        // Header
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-text', props: { fontSize: '800', fontWeight: 'bold' }, children: ['Welcome to WE'] },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500' },
              children: ['Your perspectives and spaces'],
            },
          ],
        },

        // ── Shared Spaces ──
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'globe', color: 'primary-500', size: '20px' } },
                { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Shared Spaces'] },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.sharedSpaces.length' },
                then: {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: {
                        items: { $store: 'adamStore.sharedSpaces' },
                        as: 'space',
                      },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            bg: 'neutral-50',
                            gap: '200',
                            width: '200px',
                            cursor: 'pointer',
                            onClick: {
                              $action: 'routeStore.navigate',
                              args: [{ $concat: ['/space/', '$space.uuid'] }],
                            },
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { name: 'globe', color: 'primary-400', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$space.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '300', color: 'neutral-400' },
                              children: ['$space.description'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-400', italic: true },
                  children: ['No shared spaces yet'],
                },
              },
            },
          ],
        },

        // ── Personal Spaces ──
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'folder', color: 'primary-500', size: '20px' } },
                {
                  type: 'we-text',
                  props: { fontSize: '600', fontWeight: 'semibold' },
                  children: ['Personal Spaces'],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.personalSpaces.length' },
                then: {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: {
                        items: { $store: 'adamStore.personalSpaces' },
                        as: 'space',
                      },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            bg: 'neutral-50',
                            gap: '200',
                            width: '200px',
                            cursor: 'pointer',
                            onClick: {
                              $action: 'routeStore.navigate',
                              args: [
                                {
                                  $concat: [
                                    '/space/',
                                    { $if: { condition: '$space.url', then: '$space.url', else: '$space.uuid' } },
                                  ],
                                },
                              ],
                            },
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { name: 'folder', color: 'primary-400', size: '16px' } },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$space.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '300', color: 'neutral-400' },
                              children: ['$space.description'],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-400', italic: true },
                  children: ['No personal spaces yet'],
                },
              },
            },
          ],
        },

        // ── All Perspectives ──
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'intersect-three', color: 'neutral-500', size: '20px' } },
                {
                  type: 'we-text',
                  props: { fontSize: '600', fontWeight: 'semibold' },
                  children: ['All Perspectives'],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.allPerspectives.length' },
                then: {
                  type: 'Row',
                  props: { gap: '300', wrap: true },
                  children: [
                    {
                      type: '$each',
                      props: {
                        items: { $store: 'adamStore.allPerspectives' },
                        as: 'perspective',
                      },
                      children: [
                        {
                          type: 'Column',
                          props: {
                            p: '400',
                            r: '400',
                            bg: 'neutral-50',
                            gap: '100',
                            width: '200px',
                            border: '1px solid neutral-200',
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-icon',
                                  props: {
                                    name: {
                                      $if: {
                                        condition: '$perspective.sharedUrl',
                                        then: 'globe',
                                        else: 'folder',
                                      },
                                    },
                                    color: 'neutral-400',
                                    size: '16px',
                                  },
                                },
                                {
                                  type: 'we-text',
                                  props: { fontSize: '400', fontWeight: 'medium' },
                                  children: ['$perspective.name'],
                                },
                              ],
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '200', color: 'neutral-400', fontFamily: 'mono' },
                              children: [{ $concat: ['UUID: ', '$perspective.uuid'] }],
                            },
                            {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                text: 'Delete',
                                color: 'danger-500',
                                height: '28px',
                                width: 'fit-content',
                                onClick: {
                                  $action: 'adamStore.removePerspective',
                                  args: ['$perspective.uuid'],
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                else: {
                  type: 'we-text',
                  props: { fontSize: '300', color: 'neutral-400', italic: true },
                  children: ['No perspectives yet'],
                },
              },
            },
          ],
        },

        // ── Create Space Button ──
        {
          type: 'we-button',
          props: {
            text: 'Create New Space',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            width: 'fit-content',
            onClick: { $setLocal: 'createSpaceOpen', value: true },
          },
        },

        // ── Create Space Modal ──
        {
          type: '$if',
          props: {
            condition: { $local: 'createSpaceOpen' },
            then: {
              type: 'we-modal',
              props: {
                close: { $setLocal: 'createSpaceOpen', value: false },
                maxWidth: '560px',
                width: '100%',
              },
              children: [
                { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create a New Space'] },

                // Space image
                {
                  type: 'EditableImage',
                  props: {
                    src: { $local: 'thumbnail' },
                    alt: 'Space image',
                    fit: 'cover',
                    width: '100%',
                    height: '160px',
                    r: '300',
                    placeholderIcon: 'image',
                    onImageChange: { $setLocal: 'thumbnail', from: '$event' },
                  },
                },

                // Name
                {
                  type: 'we-form-field',
                  props: {
                    label: 'Name',
                    error: { $if: { condition: { $error: 'name' }, then: { $error: 'name' } } },
                  },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        placeholder: 'Space name...',
                        value: { $local: 'name' },
                        onInput: { $setLocal: 'name', from: '$event.detail' },
                        onBlur: { $touch: 'name' },
                      },
                    },
                  ],
                },

                // Description
                {
                  type: 'we-form-field',
                  props: { label: 'Description' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        placeholder: 'Description (optional)',
                        value: { $local: 'description' },
                        onInput: { $setLocal: 'description', from: '$event.detail' },
                      },
                    },
                  ],
                },

                // Shared toggle
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-text', props: { fontSize: '400' }, children: ['Shared with network'] },
                    {
                      type: 'we-switch',
                      props: {
                        checked: { $local: 'shared' },
                        onChange: { $setLocal: 'shared', from: '$event.detail' },
                      },
                    },
                  ],
                },

                // Action buttons
                {
                  type: 'Row',
                  props: { gap: '300', ax: 'end', mt: '200' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        text: 'Cancel',
                        onClick: { $setLocal: 'createSpaceOpen', value: false },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Create Space',
                        bg: 'primary-500',
                        color: 'neutral-0',
                        height: '40px',
                        disabled: { $not: { $formValid: '$scope' } },
                        onClick: [
                          { $touch: '$all' },
                          {
                            $if: {
                              condition: { $formValid: '$scope' },
                              then: {
                                $action: 'adamStore.createSpace',
                                args: [
                                  { $local: 'name' },
                                  { $local: 'description' },
                                  { $local: 'shared' },
                                  { $local: 'thumbnail' },
                                ],
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },

    // ── Space Detail Page (dynamic) ──
    {
      path: '/space/:spaceId',
      type: 'Column',
      props: { gap: '500', maxWidth: '900px', mx: 'auto', width: '100%' },
      children: [
        // Back link
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            text: '← Back',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
          },
        },

        // Cover image
        {
          type: 'EditableImage',
          props: {
            src: { $store: 'spaceStore.space.thumbnail' },
            alt: 'Cover image',
            fit: 'cover',
            width: '100%',
            height: '200px',
            r: '300',
            placeholderIcon: 'panorama',
            onImageChange: { $action: 'spaceStore.updateSpaceCoverImage', args: ['$arg'] },
          },
        },

        // Space avatar + name (overlapping cover)
        {
          type: 'Column',
          props: { mt: '-60px', gap: '100', px: '400' },
          children: [
            {
              type: 'EditableImage',
              props: {
                src: { $store: 'spaceStore.space.image' },
                alt: 'Space image',
                fit: 'cover',
                width: '120px',
                height: '120px',
                r: '300',
                placeholderIcon: 'buildings',
                onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['$arg'] },
              },
            },
            {
              type: 'Column',
              props: { gap: '100', mt: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '800', fontWeight: 'bold' },
                  children: [{ $store: 'spaceStore.space.name' }],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.space.description' },
                    then: {
                      type: 'we-text',
                      props: { fontSize: '400', color: 'neutral-500' },
                      children: [{ $store: 'spaceStore.space.description' }],
                    },
                  },
                },
              ],
            },
          ],
        },

        // Tab navigation
        {
          type: 'we-tabs',
          props: { selectedKey: { $store: 'routeStore.segments.2' } },
          children: [
            {
              type: 'we-tab',
              props: {
                key: 'about',
                label: 'About',
                onClick: { $action: 'routeStore.navigate', args: ['./about'] },
              },
            },
            {
              type: 'we-tab',
              props: {
                key: 'posts',
                label: 'Posts',
                onClick: { $action: 'routeStore.navigate', args: ['./posts'] },
              },
            },
            {
              type: 'we-tab',
              props: {
                key: 'members',
                label: 'Members',
                onClick: { $action: 'routeStore.navigate', args: ['./members'] },
              },
            },
          ],
        },

        // Subroute outlet
        { type: '$routes' },
      ],
      routes: [
        // Default → redirect to about
        { path: '/', type: 'Column', redirect: './about' },

        // ── Posts subroute ──
        {
          path: '/posts',
          type: 'Column',
          props: { gap: '400' },
          $localState: {
            createPostOpen: { type: 'boolean', initial: false },
            viewMode: { type: 'string', initial: 'posts' },
          },
          children: [
            // Top bar: mode toggle + create button
            {
              type: 'Row',
              props: { ax: 'between', ay: 'center', gap: '200' },
              children: [
                // Mode toggle
                {
                  type: 'Row',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        text: 'Posts',
                        height: '32px',
                        width: 'fit-content',
                        bg: {
                          $if: {
                            condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                            then: 'primary-500',
                            else: 'neutral-100',
                          },
                        },
                        color: {
                          $if: {
                            condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                            then: 'neutral-0',
                            else: 'neutral-600',
                          },
                        },
                        onClick: { $setLocal: 'viewMode', value: 'posts' },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Blocks',
                        height: '32px',
                        width: 'fit-content',
                        bg: {
                          $if: {
                            condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                            then: 'primary-500',
                            else: 'neutral-100',
                          },
                        },
                        color: {
                          $if: {
                            condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                            then: 'neutral-0',
                            else: 'neutral-600',
                          },
                        },
                        onClick: { $setLocal: 'viewMode', value: 'blocks' },
                      },
                    },
                  ],
                },
                // Create Post button
                {
                  type: 'we-button',
                  props: {
                    text: 'Create Post',
                    bg: 'primary-500',
                    color: 'neutral-0',
                    height: '40px',
                    width: 'fit-content',
                    onClick: { $setLocal: 'createPostOpen', value: true },
                  },
                },
              ],
            },

            // Create Post modal
            {
              type: '$if',
              props: {
                condition: { $local: 'createPostOpen' },
                then: {
                  type: 'we-modal',
                  props: {
                    close: { $setLocal: 'createPostOpen', value: false },
                    maxWidth: '680px',
                    width: '100%',
                  },
                  children: [
                    { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create Post'] },
                    {
                      type: 'BlockComposer',
                      props: {
                        onSave: [
                          { $action: 'spaceStore.createPost', args: ['$arg'] },
                          { $setLocal: 'createPostOpen', value: false },
                        ],
                      },
                    },
                  ],
                },
              },
            },

            // Mode: Full Posts (store-driven, rendered via BlockRenderer)
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                then: {
                  type: 'Column',
                  props: { gap: '400' },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $store: 'spaceStore.posts.length' },
                        then: {
                          type: '$each',
                          props: {
                            items: { $store: 'spaceStore.posts' },
                            as: 'post',
                          },
                          children: [
                            {
                              type: 'BlockRenderer',
                              props: { post: '$post' },
                            },
                            // {
                            //   type: 'we-text',
                            //   children: ['yooo'],
                            // },
                          ],
                        },
                        else: {
                          type: 'Column',
                          props: { p: '600', ay: 'center', ax: 'center', gap: '200' },
                          children: [
                            {
                              type: 'we-icon',
                              props: { name: 'chat', color: 'neutral-300', size: '48px' },
                            },
                            {
                              type: 'we-text',
                              props: { fontSize: '400', color: 'neutral-400' },
                              children: ['No posts yet'],
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },

            // Mode: Individual Blocks ($query-driven, raw property cards)
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                then: {
                  type: 'Column',
                  props: { gap: '400' },
                  children: [
                    {
                      type: '$each',
                      props: {
                        items: { $query: { model: 'CollectionBlock', subscribe: true, where: { type: 'root' } } },
                        as: 'block',
                      },
                      children: [
                        {
                          type: 'Column',
                          props: { p: '400', r: '400', bg: 'neutral-100', gap: '200' },
                          children: [
                            {
                              type: '$if',
                              props: {
                                condition: '$block.display',
                                then: {
                                  type: 'Row',
                                  props: { gap: '200' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { fontSize: '200', color: 'neutral-400' },
                                      children: ['Display:'],
                                    },
                                    { type: 'we-text', props: { fontSize: '300' }, children: ['$block.display'] },
                                  ],
                                },
                              },
                            },
                            {
                              type: '$if',
                              props: {
                                condition: '$block.direction',
                                then: {
                                  type: 'Row',
                                  props: { gap: '200' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { fontSize: '200', color: 'neutral-400' },
                                      children: ['Direction:'],
                                    },
                                    { type: 'we-text', props: { fontSize: '300' }, children: ['$block.direction'] },
                                  ],
                                },
                              },
                            },
                            {
                              type: '$if',
                              props: {
                                condition: '$block.format',
                                then: {
                                  type: 'Row',
                                  props: { gap: '200' },
                                  children: [
                                    {
                                      type: 'we-text',
                                      props: { fontSize: '200', color: 'neutral-400' },
                                      children: ['Format:'],
                                    },
                                    { type: 'we-text', props: { fontSize: '300' }, children: ['$block.format'] },
                                  ],
                                },
                              },
                            },
                            {
                              type: 'Row',
                              props: { gap: '200' },
                              children: [
                                {
                                  type: 'we-text',
                                  props: { fontSize: '200', color: 'neutral-400' },
                                  children: ['Version:'],
                                },
                                { type: 'we-text', props: { fontSize: '300' }, children: ['$block.version'] },
                              ],
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

        // ── Members subroute ──
        {
          path: '/members',
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Column',
              props: { p: '600', ay: 'center', ax: 'center', gap: '200' },
              children: [
                { type: 'we-icon', props: { name: 'people', color: 'neutral-300', size: '48px' } },
                {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-400' },
                  children: ['Members list coming soon'],
                },
              ],
            },
          ],
        },

        // ── About subroute ──
        {
          path: '/about',
          type: 'Column',
          props: { gap: '400' },
          children: [
            {
              type: 'Column',
              props: { p: '400', r: '400', bg: 'neutral-100', gap: '300' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                      children: ['Name'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400' },
                      children: [{ $store: 'spaceStore.space.name' }],
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                      children: ['Description'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400' },
                      children: [
                        {
                          $if: {
                            condition: { $store: 'spaceStore.space.description' },
                            then: { $store: 'spaceStore.space.description' },
                            else: 'No description',
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                      children: ['UUID'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontFamily: 'mono', color: 'neutral-400' },
                      children: [{ $store: 'spaceStore.space.uuid' }],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.space.visibility' },
                    then: {
                      type: 'Row',
                      props: { gap: '200' },
                      children: [
                        {
                          type: 'we-text',
                          props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                          children: ['Visibility'],
                        },
                        {
                          type: 'we-text',
                          props: { fontSize: '400' },
                          children: [{ $store: 'spaceStore.space.visibility' }],
                        },
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
