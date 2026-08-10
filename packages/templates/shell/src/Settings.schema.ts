/**
 * Settings — Shell template for account settings
 *
 * Provides: template switching, theme switching, agent info, logout.
 */

import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

import { accountSettings } from './AccountSettings.schema.ts';
import { aiSection } from './AiSettings.schema.ts';
import { hostSection } from './HostSettings.schema.ts';
import { languagesLocalState, languagesSection } from './LanguageSettings.schema.ts';
import {
  backup,
  connectedApps,
  logging,
  loggingLocalState,
  mcpServer,
  networkLocalState,
  peerNetwork,
  runtimeError,
  trustedAgents,
} from './RuntimeSettings.schema.ts';
import { advancedDatasetsSection } from './spaces/AdvancedDatasets.ts';
import { spaceSettingsPage } from './spaces/SpaceSettings.ts';
import { spacesListSection } from './spaces/SpacesList.ts';

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

/**
 * Whether a space's theme covers the whole window, or only the space's own content.
 *
 * Off by default, and phrased as something you opt into, because the two failure modes are not
 * symmetric: a dark or low-contrast community theme taking over the whole window makes this very
 * page hard to read, and this is the page you would come to to undo it. The other way round, a
 * space merely feels less immersive.
 *
 * The theme editor's toolbar can flip this for the length of an editing session without writing it
 * here — it is a preview there, and says so.
 */
const themeScopeSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Space themes'] },
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
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Let spaces theme the whole window'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'neutral-400' },
              children: [
                'Off, a space themes its own content and the shell keeps your theme. On, entering a space restyles everything, including these settings.',
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'themeStore.themeScopePreviewing' },
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'warning-600' },
                  children: ['A theme you are editing is previewing a different scope right now.'],
                },
              },
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $store: 'themeStore.themeScopeGlobal' },
            onChange: { $action: 'themeStore.setThemeScopeGlobal', args: ['$event.detail'] },
          },
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

/** One module's row. The control differs by group, so it is passed in rather than branched on here. */
function moduleRow(control: SchemaNode): SchemaNode {
  return {
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
      control,
    ],
  };
}

/**
 * The modules of one surface, under their own heading.
 *
 * Split by `surface` because the three kinds are decided about differently, and one list had to
 * state all three caveats at once over rows where each applied to only some of them — "a community
 * still decides which of them it runs" is true of chrome and of nothing else. Grouped, each sentence
 * sits with the modules it is actually about.
 *
 * `surface` is derived by the host from what a module contributes (see `moduleSurface`), so a new
 * module lands in the right group without declaring one, and without this file changing.
 */
function moduleGroup(title: string, blurb: string, surface: string, control: SchemaNode): SchemaNode {
  const items = { $filter: { items: { $store: 'spaceStore.moduleInstallSettings' }, where: { surface } } };
  return {
    type: '$if',
    props: {
      // A deployment need not ship all three kinds — a seed declaring no embedded apps would
      // otherwise render a heading and a paragraph over nothing.
      condition: { $count: { items } },
      then: {
        type: 'Column',
        props: { gap: '200' },
        children: [
          { type: 'we-text', props: { variant: 'label' }, children: [title] },
          { type: 'we-text', props: { variant: 'footnote', color: 'neutral-400' }, children: [blurb] },
          {
            type: 'Column',
            props: { gap: '200' },
            children: [{ type: '$each', props: { items, as: 'mod' }, children: [moduleRow(control)] }],
          },
        ],
      },
    },
  };
}

const moduleSwitch: SchemaNode = {
  type: 'we-switch',
  props: {
    checked: '$mod.installed',
    onChange: { $action: 'spaceStore.setModuleInstalled', args: ['$mod.id', '$event.detail'] },
  },
};

const modulesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '500' },
  children: [
    {
      type: 'Column',
      props: { gap: '200' },
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
          children: ['Which feature modules you want available to you. Your own choice, and it applies everywhere.'],
        },
      ],
    },

    moduleGroup(
      'Embedded apps',
      'Whole applications, running alongside your spaces rather than inside one. Turning one off takes it out of the app switcher.',
      'app',
      moduleSwitch,
    ),

    moduleGroup(
      'Space modules',
      'Panels and buttons that appear inside a space. A community still decides which of these it runs in theirs, in that space\u2019s settings.',
      'chrome',
      moduleSwitch,
    ),

    // No switch here — see `moduleSurface`. A capability module has no chrome of its own, so "off"
    // could only mean withdrawing a component from whatever template mounts it, which is not
    // something to offer before templates can declare what they need. A tag rather than the sentence
    // that used to sit in the switch's place: in that position a sentence reads as a state anyway,
    // and the reason belongs in the blurb above, where it is a reason. `we-tag` also matches how the
    // templates and themes lists on this page mark a row that is not the user's to change.
    moduleGroup(
      'Template components',
      'These supply pieces that templates build with, and have no chrome of their own. They stay on \u2014 a template that mounts one would break without it, and a template that has no use for one never loads it.',
      'capability',
      { type: 'we-tag', props: { variant: 'neutral' }, children: ['Always on'] },
    ),
  ],
};

const createSpaceButton: SchemaNode = {
  type: 'we-button',
  props: {
    text: 'Create New Space',
    variant: 'primary',
    height: '40px',
    onClick: { $action: 'shellStore.setCreateSpaceOpen', args: [true] },
  },
};

/**
 * Join a space someone sent you.
 *
 * On the web a share link is a URL the browser can open, and the space gate takes it from there.
 * Nothing else has an address bar, so a desktop build needs somewhere to put the thing you were
 * sent — this is that place. `joinSpace` accepts a full URL, a `neighbourhood://` URI or a bare
 * id, so whichever form the link arrived in is the form that works.
 */
const joinSpaceByLink: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  $localState: { joinLink: { type: 'string', initial: '' }, joining: { type: 'boolean', initial: false } },
  children: [
    { type: 'we-text', props: { variant: 'label' }, children: ['Join with a link'] },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-input',
          props: {
            flex: '1',
            value: { $local: 'joinLink' },
            placeholder: 'Paste a space link or neighbourhood:// address',
            disabled: { $local: 'joining' },
            onInput: { $setLocal: 'joinLink', from: '$event.detail' },
          },
        },
        {
          type: 'we-button',
          props: {
            variant: 'secondary',
            // Gated on having typed something rather than on validation: whether an address
            // resolves is only knowable by trying it, so the button asks rather than predicts.
            disabled: { $or: [{ $not: { $local: 'joinLink' } }, { $local: 'joining' }] },
            loading: { $local: 'joining' },
            onClick: [
              { $setLocal: 'joining', value: true },
              {
                $action: 'spaceStore.joinSpace',
                args: [{ $local: 'joinLink' }],
                onSuccess: [{ $setLocal: 'joinLink', value: '' }],
                onFinally: [{ $setLocal: 'joining', value: false }],
              },
            ],
          },
          children: ['Join'],
        },
      ],
    },
  ],
};

/**
 * One entry in the left-hand nav.
 *
 * `secondary` when it is the open page, `ghost` otherwise — the DS convention for a selected item,
 * and it brings hover, focus and keyboard activation without hand-rolling any of them.
 */
function navItem(label: string, icon: string, path: string): SchemaNode {
  // Matched on the first path segment, not the whole path, so a page with sub-routes keeps its nav
  // entry lit — `/spaces/<uuid>` is still Spaces & data. Exact equality left the nav with nothing
  // selected there, which reads as having navigated out of settings altogether.
  const selected =
    path === '/'
      ? { $eq: [{ $store: 'routeStore.currentPath' }, '/'] }
      : { $eq: [{ $store: 'routeStore.segments.0' }, path.slice(1)] };
  return {
    type: 'we-button',
    props: {
      variant: { $if: { condition: selected, then: 'secondary', else: 'ghost' } },
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
    { path: '/appearance', ...page([templatesSection, themeScopeSection, themesSection]) },
    {
      path: '/spaces',
      ...page([
        spacesListSection,
        createSpaceButton,
        joinSpaceByLink,
        // Below the spaces themselves: it is about all of this data at once, and it is the one
        // control here that writes a file rather than changing what is on screen.
        backup,
        advancedDatasetsSection,
      ]),
    },
    // Settings for one space, keyed by the row that was clicked rather than by where the agent is
    // standing — see `spaceSettingsPage`.
    { path: '/spaces/:uuid', ...page([spaceSettingsPage]) },
    { path: '/modules', ...page([modulesSection]) },
    { path: '/ai', ...page([runtimeError, aiSection]) },
    {
      path: '/languages',
      $localState: languagesLocalState,
      ...page([runtimeError, languagesSection]),
    },
    {
      path: '/network',
      // Logging sits here rather than on a page of its own: this is where someone goes when the
      // data layer is misbehaving, which is the same moment they want more of it in the log.
      $localState: { ...networkLocalState, ...loggingLocalState },
      ...page([runtimeError, trustedAgents, peerNetwork, logging]),
    },
    { path: '/connections', ...page([runtimeError, hostSection, connectedApps, mcpServer]) },
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
                    condition: {
                      $or: [
                        { $store: 'runtimeStore.canManageNetwork' },
                        // Logging is a host setting, so this page has something to show even where
                        // the backend administers no networking.
                        { $store: 'runtimeStore.canConfigureExecutor' },
                      ],
                    },
                    then: navItem('Network', 'globe', '/network'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    // `sessionStore.host` carries this page on web: authorized apps are node-scoped
                    // and the executor is not ours to configure there, so without it the one place
                    // that says which node holds your data would be unreachable on exactly the
                    // hosts where that question matters.
                    condition: {
                      $or: [
                        { $store: 'sessionStore.host' },
                        { $store: 'runtimeStore.canManageApps' },
                        { $store: 'runtimeStore.canConfigureExecutor' },
                      ],
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
