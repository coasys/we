/**
 * Settings — Shell template for account settings
 *
 * Provides: template switching, theme switching, agent info, logout.
 */

import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

import { accountSettings } from './AccountSettings.schema.ts';
import { aiSection } from './AiSettings.schema.ts';
import { createSpaceModal } from './CreateSpaceModal.ts';
import { languagesLocalState, languagesSection } from './LanguageSettings.schema.ts';
import {
  connectedApps,
  mcpServer,
  networkLocalState,
  peerNetwork,
  runtimeError,
  trustedAgents,
} from './RuntimeSettings.schema.ts';

const pageHeader: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    { type: 'we-icon', props: { name: 'gear', size: 'md' } },
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Settings'] },
  ],
};

const accountSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    // "Account" to match the sign-in screen; the DID row below carries the protocol term.
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Account'] },
    {
      type: 'Card',
      props: { bg: 'neutral-100' },
      children: [
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'body', fontWeight: 'medium' },
              children: ['DID'],
            },
            {
              type: 'we-text',
              props: { variant: 'body', styles: { 'word-break': 'break-all' } },
              children: ['$me.did'],
            },
          ],
        },
      ],
    },
    accountSettings,
  ],
};

const templatesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Templates'] },
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        {
          type: '$each',
          props: { items: { $store: 'templateStore.templateManagementList' }, as: 'template' },
          children: [
            {
              type: 'Row',
              props: {
                gap: '300',
                ay: 'center',
                p: '300',
                r: '200',
                bg: {
                  $if: {
                    condition: '$template.isDefault',
                    then: 'neutral-100',
                    else: 'transparent',
                  },
                },
              },
              children: [
                // Template icon + name
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', styles: { flex: '1', 'min-width': '0' } },
                  children: [
                    { type: 'we-icon', props: { name: '$template.icon', size: '20px' } },
                    {
                      type: 'Column',
                      props: { gap: '50' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'body', fontWeight: 'medium' },
                          children: ['$template.name'],
                        },
                        {
                          type: '$if',
                          props: {
                            condition: '$template.description',
                            then: {
                              type: 'we-text',
                              props: { variant: 'label' },
                              children: ['$template.description'],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },

                // Built-in badge
                {
                  type: '$if',
                  props: {
                    condition: '$template.isBuiltIn',
                    then: {
                      type: 'we-tag',
                      props: { variant: 'neutral' },
                      children: ['Built-in'],
                    },
                  },
                },

                // Install toggle (custom templates only)
                {
                  type: '$if',
                  props: {
                    condition: { $not: '$template.isBuiltIn' },
                    then: {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'label' },
                          children: ['Installed'],
                        },
                        {
                          type: 'we-switch',
                          props: {
                            checked: '$template.isInstalled',
                            size: 'sm',
                            onChange: {
                              $action: 'templateStore.toggleInstalled',
                              args: ['$template.id'],
                            },
                          },
                        },
                      ],
                    },
                  },
                },

                // Default radio button (only shown if template is installed)
                {
                  type: '$if',
                  props: {
                    condition: '$template.isInstalled',
                    then: {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'label' },
                          children: ['Default'],
                        },
                        {
                          type: 'we-radio',
                          props: {
                            checked: '$template.isDefault',
                            name: 'default-template',
                            value: '$template.id',
                            onChange: {
                              $action: 'templateStore.setDefaultTemplate',
                              args: ['$template.id'],
                            },
                          },
                        },
                      ],
                    },
                  },
                },

                // Delete button (custom templates only)
                {
                  type: '$if',
                  props: {
                    condition: { $not: '$template.isBuiltIn' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $action: 'templateStore.deleteTemplate',
                          args: ['$template.id'],
                        },
                      },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: 'trash', size: '16px', color: 'danger-400' },
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

const themesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Themes'] },
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        {
          type: '$each',
          props: { items: { $store: 'themeStore.themeManagementList' }, as: 'theme' },
          children: [
            {
              type: 'Row',
              props: {
                gap: '300',
                ay: 'center',
                p: '300',
                r: '200',
                bg: {
                  $if: {
                    condition: '$theme.isDefault',
                    then: 'neutral-100',
                    else: 'transparent',
                  },
                },
              },
              children: [
                // Theme icon + name
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', styles: { flex: '1', 'min-width': '0' } },
                  children: [
                    { type: 'we-icon', props: { name: '$theme.icon', size: '20px' } },
                    {
                      type: 'we-text',
                      props: { variant: 'body', fontWeight: 'medium' },
                      children: ['$theme.name'],
                    },
                  ],
                },

                // Built-in badge
                {
                  type: '$if',
                  props: {
                    condition: '$theme.isBuiltIn',
                    then: {
                      type: 'we-tag',
                      props: { variant: 'neutral' },
                      children: ['Built-in'],
                    },
                  },
                },

                // Install toggle (custom themes only)
                {
                  type: '$if',
                  props: {
                    condition: { $not: '$theme.isBuiltIn' },
                    then: {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'label' },
                          children: ['Installed'],
                        },
                        {
                          type: 'we-switch',
                          props: {
                            checked: '$theme.isInstalled',
                            size: 'sm',
                            onChange: {
                              $action: 'themeStore.toggleThemeInstalled',
                              args: ['$theme.id'],
                            },
                          },
                        },
                      ],
                    },
                  },
                },

                // Default radio button (only shown if theme is installed)
                {
                  type: '$if',
                  props: {
                    condition: '$theme.isInstalled',
                    then: {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'label' },
                          children: ['Default'],
                        },
                        {
                          type: 'we-radio',
                          props: {
                            checked: '$theme.isDefault',
                            name: 'default-theme',
                            value: '$theme.id',
                            onChange: {
                              $action: 'themeStore.setDefaultTheme',
                              args: ['$theme.id'],
                            },
                          },
                        },
                      ],
                    },
                  },
                },

                // Delete button (custom themes only)
                {
                  type: '$if',
                  props: {
                    condition: { $not: '$theme.isBuiltIn' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $action: 'themeStore.deleteTheme',
                          args: ['$theme.id'],
                        },
                      },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: 'trash', size: '16px', color: 'danger-400' },
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

const perspectivesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'intersect-three', size: '20px' } },
        {
          type: 'we-text',
          props: { fontWeight: 'semibold' },
          children: ['All Perspectives'],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $store: 'datasetStore.datasets.length' },
        then: {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'datasetStore.datasets' }, as: 'dataset' },
              children: [
                {
                  type: 'Card',
                  props: {
                    ax: 'start',
                    bg: 'neutral-50',
                    border: '1px solid neutral-200',
                  },
                  $localState: {
                    sdnaCleanupResult: { type: 'string', initial: '' },
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
                              $if: { condition: '$dataset.sharedUri', then: 'globe', else: 'folder' },
                            },
                            size: '16px',
                          },
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'body', fontWeight: 'medium' },
                          children: ['$dataset.name'],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'body' },
                      children: [{ $concat: ['ID: ', '$dataset.id'] }],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'body' },
                      children: [{ $concat: ['URL: ', '$dataset.sharedUri'] }],
                    },
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'secondary',
                            size: 'sm',
                            onClick: {
                              $action: 'datasetStore.cleanupSpaceSdna',
                              args: ['$dataset.id'],
                              onSuccess: [{ $setLocal: 'sdnaCleanupResult', from: '$result' }],
                            },
                          },
                          children: [
                            { type: 'we-icon', props: { name: 'broom' } },
                            {
                              type: 'we-text',
                              props: { variant: 'label' },
                              children: ['Clean up duplicate schema'],
                            },
                          ],
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'danger',
                            size: 'sm',
                            onClick: { $action: 'spaceStore.removeSpace', args: ['$dataset.id'] },
                          },
                          children: [
                            { type: 'we-icon', props: { name: 'trash', size: '16px' } },
                            {
                              type: 'we-text',
                              props: { variant: 'label' },
                              children: ['Delete'],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $local: 'sdnaCleanupResult' },
                        then: {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'neutral-400' },
                          children: [{ $local: 'sdnaCleanupResult' }],
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
          props: { variant: 'label', italic: true },
          children: ['No perspectives yet'],
        },
      },
    },
  ],
};

const modulesSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'datasetStore.currentDataset' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'puzzle-piece', size: '20px' } },
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Modules'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'neutral-400' },
          children: ['Feature modules available in this space.'],
        },
        {
          type: '$each',
          props: { items: { $store: 'spaceStore.moduleSettings' }, as: 'mod' },
          children: [
            {
              type: 'Row',
              props: {
                ay: 'center',
                ax: 'between',
                gap: '300',
                p: '300',
                bg: 'neutral-0',
                r: '300',
                border: '1px solid neutral-200',
              },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-icon', props: { name: '$mod.icon', size: '20px' } },
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        { type: 'we-text', props: { variant: 'label' }, children: ['$mod.name'] },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'neutral-400' },
                          children: ['$mod.description'],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'we-switch',
                  props: {
                    checked: '$mod.enabled',
                    onChange: {
                      $action: 'spaceStore.setModuleEnabled',
                      args: ['$mod.id', '$event.detail'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

const sharedSpacesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'globe', size: '20px' } },
        { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Shared Spaces'] },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $store: 'spaceStore.sharedSpaces.length' },
        then: {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'spaceStore.sharedSpaces' }, as: 'space' },
              children: [
                {
                  type: 'Card',
                  props: {
                    bg: 'neutral-50',
                    width: '200px',
                    cursor: 'pointer',
                    onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.uuid'] },
                  },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'globe', size: '16px' } },
                        {
                          type: 'we-text',
                          props: { variant: 'body', fontWeight: 'medium' },
                          children: ['$space.name'],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'label' },
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
          props: { variant: 'label', italic: true },
          children: ['No shared spaces yet'],
        },
      },
    },
  ],
};

const personalSpacesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'folder', size: '20px' } },
        {
          type: 'we-text',
          props: { variant: 'heading-sm' },
          children: ['Personal Spaces'],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $store: 'spaceStore.personalSpaces.length' },
        then: {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'spaceStore.personalSpaces' }, as: 'space' },
              children: [
                {
                  type: 'Card',
                  props: {
                    bg: 'neutral-50',
                    width: '200px',
                    cursor: 'pointer',
                    onClick: {
                      $action: 'spaceStore.navigateToSpace',
                      args: [{ $if: { condition: '$space.url', then: '$space.url', else: '$space.uuid' } }],
                    },
                  },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'folder', size: '16px' } },
                        {
                          type: 'we-text',
                          props: { variant: 'body', fontWeight: 'medium' },
                          children: ['$space.name'],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'label' },
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
          props: { variant: 'label', italic: true },
          children: ['No personal spaces yet'],
        },
      },
    },
  ],
};

const createSpaceButton: SchemaNode = {
  type: 'we-button',
  props: {
    text: 'Create New Space',
    variant: 'primary',
    height: '40px',
    onClick: { $setLocal: 'createSpaceModalOpen', value: true },
  },
};

const createSpaceModalMount: SchemaNode = {
  type: '$if',
  props: { condition: { $local: 'createSpaceModalOpen' }, then: createSpaceModal },
};

/**
 * One entry in the left-hand nav.
 *
 * `secondary` when it is the open page, `ghost` otherwise — the DS convention for a selected item,
 * and it brings hover, focus and keyboard activation without hand-rolling any of them.
 */
function navItem(label: string, icon: string, path: string): SchemaNode {
  return {
    type: 'we-button',
    props: {
      variant: {
        $if: { condition: { $eq: [{ $store: 'routeStore.currentPath' }, path] }, then: 'secondary', else: 'ghost' },
      },
      width: '100%',
      ax: 'start',
      onClick: { $action: 'routeStore.navigate', args: [path] },
    },
    children: [
      { type: 'we-icon', props: { name: icon } },
      { type: 'we-text', children: [label] },
    ],
  };
}

/** A page's own column. Every route renders one, so they share spacing without repeating it. */
function page(children: SchemaNode[]): SchemaNode {
  return { type: 'Column', props: { gap: '600', width: '100%' }, children };
}

/**
 * Settings, as a set of pages rather than one scroll.
 *
 * `routes` sits on the root because the router only reads it there — the `$routes` outlet below can
 * be nested as deeply as it likes. The router itself is the shell's own `MemoryRouter`, injected as
 * `routeStore` for shell views, so none of this touches the browser URL or the app's navigation.
 *
 * The page was ~1,400 lines in one column, and the launcher surfaces still to be ported are larger
 * again. Splitting first means that content arrives into a frame rather than being moved twice.
 */
export const settingsTemplate: TemplateSchema = {
  meta: { name: 'Settings', description: 'Account settings', icon: 'gear' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  // Every route below declares whatever local state it needs. A route is rendered by `buildRoutes`
  // as its own `RenderSchema` call with a fresh context — so it is not a descendant of this node at
  // render time, whatever the schema tree looks like, and state declared here would never reach it.
  routes: [
    { path: '/', ...page([accountSection]) },
    { path: '/appearance', ...page([templatesSection, themesSection]) },
    {
      path: '/spaces',
      $localState: { createSpaceModalOpen: { type: 'boolean', initial: false } },
      ...page([
        perspectivesSection,
        sharedSpacesSection,
        personalSpacesSection,
        createSpaceButton,
        createSpaceModalMount,
      ]),
    },
    { path: '/modules', ...page([modulesSection]) },
    { path: '/ai', ...page([runtimeError, aiSection]) },
    {
      path: '/languages',
      $localState: languagesLocalState,
      ...page([runtimeError, languagesSection]),
    },
    {
      path: '/network',
      $localState: networkLocalState,
      ...page([runtimeError, trustedAgents, peerNetwork]),
    },
    { path: '/connections', ...page([runtimeError, connectedApps, mcpServer]) },
    // Anything else lands on Account rather than an empty frame.
    { path: '*', ...page([accountSection]) },
  ],
  children: [
    {
      type: 'Column',
      props: { px: '400', py: '800', gap: '600', maxWidth: '960px', width: '100%' },
      children: [
        pageHeader,
        {
          type: 'Row',
          props: { gap: '600', width: '100%', ay: 'start' },
          children: [
            {
              type: 'Column',
              props: { gap: '100', width: '200px', minWidth: '200px' },
              children: [
                navItem('Account', 'user', '/'),
                navItem('Appearance', 'palette', '/appearance'),
                navItem('Spaces & data', 'stack', '/spaces'),
                navItem('Modules', 'squares-four', '/modules'),
                // The rest are feature-detected: a backend that administers nothing has nothing to
                // show, so the entry goes rather than leading to an empty page.
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'runtimeStore.canManageAi' },
                    then: navItem('AI', 'sparkle', '/ai'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'runtimeStore.canManageLanguages' },
                    then: navItem('Languages', 'code', '/languages'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'runtimeStore.canManageNetwork' },
                    then: navItem('Network', 'globe', '/network'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: {
                      $or: [{ $store: 'runtimeStore.canManageApps' }, { $store: 'runtimeStore.canConfigureExecutor' }],
                    },
                    then: navItem('Connections', 'plugs', '/connections'),
                  },
                },
              ],
            },
            { type: 'Column', props: { flex: '1', gap: '600' }, children: [{ type: '$routes' }] },
          ],
        },
      ],
    },
  ],
};
