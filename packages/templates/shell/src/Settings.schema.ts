/**
 * Settings — Shell template for account settings
 *
 * Provides: template switching, theme switching, agent info, logout.
 */

import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

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
      props: { bg: 'surface' },
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
              props: { variant: 'body' },
              children: [{ $: 'me.did' }],
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
          props: { items: { $: 'templateStore.templateManagementList' }, as: 'template' },
          children: [
            {
              type: 'Row',
              props: {
                gap: '300',
                ay: 'center',
                p: '300',
                r: '200',
                bg: { $: "template.isDefault ? 'surface-sunken' : 'transparent'" },
              },
              children: [
                // Template icon + name
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', styles: { flex: '1', 'min-width': '0' } },
                  children: [
                    { type: 'we-icon', props: { name: { $: 'template.icon' }, size: '20px' } },
                    {
                      type: 'Column',
                      props: { gap: '50' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'body', fontWeight: 'medium' },
                          children: [{ $: 'template.name' }],
                        },
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'template.description' },
                            then: {
                              type: 'we-text',
                              props: { variant: 'label' },
                              children: [{ $: 'template.description' }],
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
                    condition: { $: 'template.isBuiltIn' },
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
                    condition: { $: '!template.isBuiltIn' },
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
                            checked: { $: 'template.isInstalled' },
                            size: 'sm',
                            onChange: {
                              $action: 'templateStore.toggleInstalled',
                              args: [{ $: 'template.id' }],
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
                    condition: { $: 'template.isInstalled' },
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
                            checked: { $: 'template.isDefault' },
                            name: 'default-template',
                            value: { $: 'template.id' },
                            onChange: {
                              $action: 'templateStore.setDefaultTemplate',
                              args: [{ $: 'template.id' }],
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
                    condition: { $: '!template.isBuiltIn' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $action: 'templateStore.deleteTemplate',
                          args: [{ $: 'template.id' }],
                        },
                      },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: 'trash', size: '16px', color: 'danger-text' },
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
        bg: 'surface-sunken',
        r: '300',
        border: '1px solid border',
      },
      children: [
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Let spaces theme the whole window'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                'Off, a space themes its own content and the shell keeps your theme. On, entering a space restyles everything, including these settings.',
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'themeStore.themeScopePreviewing' },
                then: {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'warning-text' },
                  children: ['A theme you are editing is previewing a different scope right now.'],
                },
              },
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $: 'themeStore.themeScopeGlobal' },
            onChange: { $action: 'themeStore.setThemeScopeGlobal', args: [{ $: 'event.detail' }] },
          },
        },
      ],
    },
    {
      type: 'Row',
      props: {
        ay: 'center',
        ax: 'between',
        gap: '300',
        p: '300',
        bg: 'surface-sunken',
        r: '300',
        border: '1px solid border',
      },
      children: [
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Let templates bring their own theme'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                'On, switching to a template designed for a particular theme switches the look with it, and switching back restores what you had. Off, only you and the space decide the theme. A theme you pick for a space always wins either way.',
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $: 'themeStore.useTemplateTheme' },
            onChange: { $action: 'themeStore.setUseTemplateTheme', args: [{ $: 'event.detail' }] },
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
          props: { items: { $: 'themeStore.themeManagementList' }, as: 'theme' },
          children: [
            {
              type: 'Row',
              props: {
                gap: '300',
                ay: 'center',
                p: '300',
                r: '200',
                bg: { $: "theme.isDefault ? 'surface-sunken' : 'transparent'" },
              },
              children: [
                // Theme icon + name
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', styles: { flex: '1', 'min-width': '0' } },
                  children: [
                    { type: 'we-icon', props: { name: { $: 'theme.icon' }, size: '20px' } },
                    {
                      type: 'we-text',
                      props: { variant: 'body', fontWeight: 'medium' },
                      children: [{ $: 'theme.name' }],
                    },
                  ],
                },

                // Built-in badge
                {
                  type: '$if',
                  props: {
                    condition: { $: 'theme.isBuiltIn' },
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
                    condition: { $: '!theme.isBuiltIn' },
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
                            checked: { $: 'theme.isInstalled' },
                            size: 'sm',
                            onChange: {
                              $action: 'themeStore.setThemeInstalled',
                              args: [{ $: 'theme.id' }, { $: 'event.detail' }],
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
                    condition: { $: 'theme.isInstalled' },
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
                            checked: { $: 'theme.isDefault' },
                            name: 'default-theme',
                            value: { $: 'theme.id' },
                            onChange: {
                              $action: 'themeStore.setDefaultTheme',
                              args: [{ $: 'theme.id' }],
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
                    condition: { $: '!theme.isBuiltIn' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $action: 'themeStore.deleteTheme',
                          args: [{ $: 'theme.id' }],
                        },
                      },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: 'trash', size: '16px', color: 'danger-text' },
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
      bg: 'surface-sunken',
      r: '300',
      border: '1px solid border',
    },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: { $: 'mod.icon' }, size: '20px' } },
          {
            type: 'Column',
            props: { gap: '100' },
            children: [
              { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'mod.name' }] },
              {
                type: 'we-text',
                props: { variant: 'footnote', color: 'text-faint' },
                children: [{ $: 'mod.description' }],
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
  const items = expr`filter(spaceStore.moduleInstallSettings, { surface: ${surface} })`;
  return {
    type: '$if',
    props: {
      // A deployment need not ship all three kinds — a seed declaring no embedded apps would
      // otherwise render a heading and a paragraph over nothing.
      condition: expr`count(${items})`,
      then: {
        type: 'Column',
        props: { gap: '200' },
        children: [
          { type: 'we-text', props: { variant: 'label' }, children: [title] },
          { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [blurb] },
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
    checked: { $: 'mod.installed' },
    onChange: { $action: 'spaceStore.setModuleInstalled', args: [{ $: 'mod.id' }, { $: 'event.detail' }] },
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
          props: { variant: 'footnote', color: 'text-faint' },
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
            value: { $: 'local.joinLink' },
            placeholder: 'Paste a space link or neighbourhood:// address',
            disabled: { $: 'local.joining' },
            onInput: { $setLocal: 'joinLink', value: { $: 'event.detail' } },
          },
        },
        {
          type: 'we-button',
          props: {
            variant: 'secondary',
            // Gated on having typed something rather than on validation: whether an address
            // resolves is only knowable by trying it, so the button asks rather than predicts.
            disabled: { $: '!local.joinLink || local.joining' },
            loading: { $: 'local.joining' },
            onClick: [
              { $setLocal: 'joining', value: true },
              {
                $action: 'spaceStore.joinSpace',
                args: [{ $: 'local.joinLink' }],
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
    path === '/' ? { $: "routeStore.currentPath == '/'" } : expr`routeStore.segments[0] == ${path.slice(1)}`;
  return {
    type: 'we-button',
    props: {
      variant: expr`${selected} ? 'secondary' : 'ghost'`,
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

/**
 * The one switch every developer affordance is gated on.
 *
 * ## Why this page gates on `isDevelopment` and the switch reads `devTools`
 *
 * They are deliberately different stores' worth of question, and using one for both breaks the
 * page: gate the nav entry on `devTools` and turning the switch off removes the page holding the
 * switch, so there is no way back short of clearing site data. The *build* decides whether this
 * page exists; the *switch* decides what the rest of the app shows. That asymmetry is the whole
 * design — see `devToolsEnabled`, where the build flag is the ceiling.
 *
 * A switch rather than a console incantation because the loop this supports is look-compare-restore,
 * and a step that needs a remembered `localStorage` key is one people do once and then leave in
 * whichever position they left it.
 */
const developerSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Developer'] },
    {
      type: 'Row',
      props: {
        ay: 'center',
        ax: 'between',
        gap: '300',
        p: '300',
        bg: 'surface-sunken',
        r: '300',
        border: '1px solid border',
      },
      children: [
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            { type: 'we-text', props: { variant: 'label' }, children: ['Show developer tools'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                'On, this build shows its developer affordances — the schema test pages, the fake-participant controls in a call, render logging. Off, it looks like a shipped app, which is the point: it is how you check what a user actually sees without building for production.',
              ],
            },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: ['This page is only ever here in a development build. A shipped app has none of it.'],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $: 'sessionStore.devTools' },
            // Positive-phrased, so the switch's own value passes straight through — `$not` around it
            // would resolve at render time and send a constant.
            onChange: { $action: 'sessionStore.setDevTools', args: [{ $: 'event.detail' }] },
          },
        },
      ],
    },
  ],
};

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
  props: { width: '100%', minHeight: '100%', bg: 'page', ax: 'center' },
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
    // No `$if` on the route itself: its nav entry is already gated, and a production build resolves
    // the switch to false whatever it is set to, so the page is inert rather than dangerous if
    // somebody navigates to it directly.
    { path: '/developer', ...page([developerSection]) },
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
                    condition: { $: 'runtimeStore.canManageAi' },
                    then: navItem('AI', 'sparkle', '/ai'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'runtimeStore.canManageLanguages' },
                    then: navItem('Languages', 'code', '/languages'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'runtimeStore.canManageNetwork || runtimeStore.canConfigureExecutor' },
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
                      $: 'sessionStore.host || runtimeStore.canManageApps || runtimeStore.canConfigureExecutor',
                    },
                    then: navItem('Connections', 'plugs', '/connections'),
                  },
                },
                {
                  type: '$if',
                  props: {
                    // `isDevelopment`, NOT `devTools` — see `developerSection`. Gating the way to
                    // the switch on the switch would make turning it off a one-way door.
                    condition: { $: 'sessionStore.isDevelopment' },
                    then: navItem('Developer', 'flask', '/developer'),
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
