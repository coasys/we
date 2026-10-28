/**
 * Settings — Shell template for account settings
 *
 * Grouped as a person thinks about it: their account (profile, security, plan, logging out), the
 * devices and apps that act as them, and this app — how it looks and what it does. The account and
 * device pages live in `AccountSettingsPages.ts`.
 */

import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import {
  botsPage,
  devicesPage,
  logOutAction,
  planPage,
  profilePage,
  securityPage,
  thisDevicePage,
} from './AccountSettingsPages.ts';
import { aiSection } from './AiSettings.schema.ts';
import { spaceChecklist } from './BundlePrompt.schema.ts';
import { languagesLocalState, languagesSection } from './LanguageSettings.schema.ts';
import {
  backup,
  connectedApps,
  executorSupport,
  logging,
  loggingLocalState,
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

/**
 * Which app you are in — the chrome around every space. Yours alone, and the same in every space:
 * which app you use is a fact about you, not about the community on screen.
 */
const appSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['App'] },
    {
      type: 'we-form-field',
      props: {
        label: 'The app you are in',
        description:
          'The chrome around every space: your spaces, the module rail, and whatever an app of your own arranges around them. Yours alone.',
        size: 'sm',
      },
      children: [
        {
          type: 'we-select',
          props: {
            options: { $: 'templateStore.appTemplateOptions' },
            value: { $: 'templateStore.appTemplateId' },
            size: 'sm',
            onChange: { $invoke: 'templateStore.setAppTemplate', args: [{ $: 'event.detail' }] },
          },
        },
      ],
    },
    /*
      The apps that are yours to delete — the copies, never WE's own. Apps are left out of the template
      list below, which is the only other place a template is deleted from, so without this a fork of
      the app could be made and never removed. Deleting the one you are in puts you back in WE's.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'count(templateStore.appTemplateOptions.filter(app, app.editable))' },
        then: {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['Your apps'] },
            {
              type: '$each',
              props: { items: { $: 'templateStore.appTemplateOptions.filter(app, app.editable)' }, as: 'app' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', p: '300', r: '200' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300', ay: 'center', flex: '1', minWidth: '0' },
                      children: [
                        { type: 'we-icon', props: { name: { $: "app.icon ? app.icon : 'app-window'" }, size: '20px' } },
                        {
                          type: 'we-text',
                          props: { variant: 'body', fontWeight: 'medium', truncate: true },
                          children: [{ $: 'app.label' }],
                        },
                      ],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $: 'app.value == templateStore.appTemplateId' },
                        then: { type: 'we-tag', props: { tone: 'accent' }, children: ['In use'] },
                      },
                    },
                    {
                      type: 'we-tooltip',
                      props: { content: 'Delete this app', placement: 'top' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'sm',
                            label: 'Delete this app',
                            onClick: { $invoke: 'templateStore.deleteTemplate', args: [{ $: 'app.value' }] },
                          },
                          children: [{ type: 'we-icon', props: { name: 'trash', size: '16px', color: 'danger-text' } }],
                        },
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
};

/**
 * Apps — installed from a file, or built into this deployment — and setting a space up for one.
 *
 * Installing only reads the file and asks: the prompt is host chrome (`BundlePrompt.schema.ts`), and
 * nothing is written until it is answered. An app's record types and sections belong to spaces, so
 * "Set up a space…" lists the spaces this agent runs and sets up the ones ticked — the same list the
 * prompt shows — and nobody is offered a space they do not run.
 */
/** Setting more spaces up for an app already installed — the prompt's checklist, on its own. */
const setUpPicker: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'bundleStore.setUpPicker' },
    then: {
      type: 'we-modal',
      props: { size: 'sm', close: { $invoke: 'bundleStore.closeSetUp' } },
      children: [
        {
          type: 'we-text',
          slot: 'header',
          props: { variant: 'heading-sm', tag: 'h2' },
          children: [{ $: '`Set up spaces for ${bundleStore.setUpPicker.name}`' }],
        },
        spaceChecklist([
          'Each space you tick gets the kinds of record and the sections the app works with, for everyone in it.',
        ]),
        {
          type: 'Row',
          slot: 'footer',
          props: { ax: 'end', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $invoke: 'bundleStore.closeSetUp' } },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'solid',
                disabled: { $: '!bundleStore.spaceChoices.exists(c, c.chosen)' },
                loading: { $: 'bundleStore.busy' },
                onClick: { $invoke: 'bundleStore.confirmSetUp' },
              },
              children: ['Set up'],
            },
          ],
        },
      ],
    },
  },
};

const appsSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Apps'] },
    {
      type: 'we-text',
      props: { variant: 'body', color: 'text-muted' },
      children: [
        'An app is a whole interface as data — its chrome, templates, theme and the kinds of record it is about. It cannot bring code: it arranges what the app already has.',
      ],
    },
    {
      type: '$each',
      props: { items: { $: 'bundleStore.installed' }, as: 'app' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', p: '300', r: '200', wrap: true },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', flex: '1', minWidth: '0' },
              children: [
                { type: 'we-icon', props: { name: { $: "app.icon ? app.icon : 'app-window'" }, size: '20px' } },
                {
                  type: 'Column',
                  props: { minWidth: '0' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'body', fontWeight: 'medium', truncate: true },
                      children: [{ $: 'app.name' }],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'label', color: 'text-muted' },
                      children: [
                        {
                          $: "app.from == 'deployment' ? `Version ${app.version}, built in` : `Version ${app.version}`",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: "app.setUp == 'available'" },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'soft',
                    size: 'sm',
                    disabled: { $: 'bundleStore.busy' },
                    onClick: { $invoke: 'bundleStore.openSetUp', args: [{ $: 'app.id' }] },
                  },
                  children: ['Set up a space…'],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: "app.setUp == 'done'" },
                then: { type: 'we-tag', props: { tone: 'success' }, children: ['Set up in your spaces'] },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: "app.from == 'file'" },
                then: {
                  type: 'we-tooltip',
                  props: { content: 'Remove this app', placement: 'top' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        label: 'Remove this app',
                        disabled: { $: 'bundleStore.busy' },
                        onClick: { $invoke: 'bundleStore.removeBundle', args: [{ $: 'app.id' }] },
                      },
                      children: [{ type: 'we-icon', props: { name: 'trash', size: '16px', color: 'danger-text' } }],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    {
      type: 'we-file-upload',
      props: {
        accept: '.json,application/json',
        disabled: { $: 'bundleStore.busy' },
        onChange: { $invoke: 'bundleStore.installFromFile', args: [{ $: 'event.detail' }] },
      },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', ax: 'center', p: '300' },
          children: [
            { type: 'we-icon', props: { name: 'package', color: 'text-muted' } },
            { type: 'we-text', children: ['Install an app from a file'] },
          ],
        },
      ],
    },
    setUpPicker,
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
                bg: { $: "template.isDefault ? 'accent-soft' : 'transparent'" },
              },
              children: [
                // Template icon + name
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', flex: '1', minWidth: '0' },
                  children: [
                    { type: 'we-icon', props: { name: { $: 'template.icon' }, size: '20px' } },
                    {
                      type: 'Column',
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
                      props: {},
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
                              $invoke: 'templateStore.toggleInstalled',
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
                              $invoke: 'templateStore.setDefaultTemplate',
                              args: [{ $: 'template.id' }],
                            },
                          },
                        },
                      ],
                    },
                  },
                },

                // Where it came from, when an installed app brought it — removed with that app.
                {
                  type: '$if',
                  props: {
                    condition: { $: 'template.fromApp' },
                    then: {
                      type: 'we-tag',
                      props: {},
                      children: [{ $: '`From ${template.fromApp}`' }],
                    },
                  },
                },

                // Delete button (custom templates only, and never one an installed app brought)
                {
                  type: '$if',
                  props: {
                    condition: { $: '!template.isBuiltIn && !template.fromApp' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'sm',
                        onClick: {
                          $invoke: 'templateStore.deleteTemplate',
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
    refusedTemplatesGroup(),
  ],
};

/**
 * Templates in the library that no longer validate. Without this they were in no list at all: not
 * offered, not deletable, and present only as a warning in the console on every boot.
 */
function refusedTemplatesGroup(): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: 'count(templateStore.refusedTemplates)' },
      then: {
        type: 'Column',
        props: { gap: '200', pt: '300' },
        children: [
          { type: 'we-text', props: { fontWeight: 'semibold' }, children: ["Couldn't load"] },
          {
            type: 'we-text',
            props: { variant: 'label', color: 'text-muted' },
            children: [
              'These templates in your library no longer pass validation, so they cannot be used. ' +
                'Usually a copy made before a change to the template rules. Delete them, then copy the ' +
                'built-in again if you want it back.',
            ],
          },
          {
            type: '$each',
            props: { items: { $: 'templateStore.refusedTemplates' }, as: 'refused' },
            children: [
              {
                type: 'Row',
                props: { gap: '300', ay: 'center', p: '300', r: '200', bg: 'surface' },
                children: [
                  { type: 'we-icon', props: { name: 'warning', size: '20px', color: 'warning-text' } },
                  {
                    type: 'Column',
                    props: { flex: '1', minWidth: '0' },
                    children: [
                      {
                        type: 'we-text',
                        props: { variant: 'body', fontWeight: 'medium' },
                        children: [{ $: 'refused.name' }],
                      },
                      {
                        type: 'we-text',
                        props: { variant: 'label', color: 'text-muted' },
                        children: [{ $: 'refused.reason' }],
                      },
                    ],
                  },
                  {
                    type: 'we-button',
                    props: {
                      variant: 'ghost',
                      size: 'sm',
                      label: 'Delete',
                      loading: { $: 'templateStore.operationLoading == `delete:${refused.id}`' },
                      onClick: { $invoke: 'templateStore.deleteRefusedTemplate', args: [{ $: 'refused.id' }] },
                    },
                    children: [{ type: 'we-icon', props: { name: 'trash', size: '16px', color: 'danger-text' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

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
/*
  What happens when somebody else saves the template on screen. Off, a notice offers the update and
  the page stays as it is until somebody presses it; on, it changes as they save. Your own changes,
  and any template you are editing, always follow.
*/
const templateUpdatesSection: SchemaNode = {
  type: 'Row',
  props: {
    ay: 'center',
    ax: 'between',
    gap: '300',
    p: '300',
    bg: 'surface',
    r: '300',
    border: '1px solid border',
  },
  children: [
    {
      type: 'Column',
      props: { gap: '100', flex: '1' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: ["Show others' template changes as they happen"] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-faint' },
          children: [
            'Off, when someone else changes the template you are looking at, you are told and choose when to update. On, it changes as they save it. Your own changes from another device, and any template you are editing, always update.',
          ],
        },
      ],
    },
    {
      type: 'we-switch',
      props: {
        checked: { $: 'templateStore.followTemplateUpdates' },
        onChange: { $invoke: 'templateStore.setFollowTemplateUpdates', args: [{ $: 'event.detail' }] },
      },
    },
  ],
};

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
        bg: 'surface',
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
            onChange: { $invoke: 'themeStore.setThemeScopeGlobal', args: [{ $: 'event.detail' }] },
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
        bg: 'surface',
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
            onChange: { $invoke: 'themeStore.setUseTemplateTheme', args: [{ $: 'event.detail' }] },
          },
        },
      ],
    },
  ],
};

/**
 * Light, dark or the machine's choice — offered only while the theme on screen has both sides
 * (`themeStore.currentThemeSides`). A theme with one look has nothing to choose between, and a control
 * that changes nothing is worse than none.
 *
 * Drawn under the row of the theme it sets, indented, so it reads as that theme's option rather than
 * as a setting of the whole list. `where` says which row it sits under: the theme on screen's own,
 * or the top of the list when that theme is not one listed (a space's own theme, say).
 */
const themeModeRow = (where: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `count(themeStore.currentThemeSides) && (${where})` },
    then: {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between', wrap: true, pl: '600', pr: '300', pb: '200' },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { fontWeight: 'medium' }, children: ['Light or dark'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: ['This theme has a light and a dark side.'],
            },
          ],
        },
        {
          type: 'we-select',
          props: {
            fit: true,
            value: { $: 'themeStore.themeMode' },
            options: [
              { label: 'Follow system', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
            ],
            onChange: { $invoke: 'themeStore.setThemeMode', args: [{ $: 'event.detail' }] },
          },
        },
      ],
    },
  },
});

/**
 * One of the person's display needs: a label, what it does, and a choice. See `displayPreferences`.
 *
 * Every one applies over whatever theme is on screen, a space's included — which is the point of
 * them, and why they sit apart from the themes rather than under one.
 */
const displayRow = (
  key: 'contrast' | 'textSize' | 'density' | 'motion',
  label: string,
  hint: string,
  options: { label: string; value: string }[],
  fallback: string | number,
): SchemaNode => ({
  type: 'Row',
  props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
  children: [
    {
      type: 'Column',
      props: { gap: '100', flex: '1 1 16rem', minWidth: '0' },
      children: [
        { type: 'we-text', props: { fontWeight: 'medium' }, children: [label] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [hint] },
      ],
    },
    {
      type: 'we-select',
      props: {
        fit: true,
        // A select's values are strings, so a number is read back as one; the action turns it back.
        value: {
          $:
            typeof fallback === 'number'
              ? `(themeStore.displayPreferences.${key} ?? ${fallback}) + ''`
              : `themeStore.displayPreferences.${key} ?? '${fallback}'`,
        },
        options,
        onChange: {
          $invoke: 'themeStore.setDisplayPreference',
          args: [key, key === 'textSize' ? { $: 'event.detail * 1' } : { $: 'event.detail' }],
        },
      },
    },
  ],
});

const displaySection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Display'] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['What you need to read comfortably. These apply in every space, whatever its theme.'],
        },
      ],
    },
    displayRow(
      'contrast',
      'Contrast',
      'More separates text, borders and controls from what is behind them.',
      [
        { label: 'Follow system', value: 'system' },
        { label: 'Standard', value: 'standard' },
        { label: 'More', value: 'more' },
      ],
      'system',
    ),
    displayRow(
      'textSize',
      'Text size',
      'Larger or smaller than the theme sets it.',
      [
        { label: '90%', value: '0.9' },
        { label: '100%', value: '1' },
        { label: '115%', value: '1.15' },
        { label: '130%', value: '1.3' },
        { label: '150%', value: '1.5' },
      ],
      1,
    ),
    displayRow(
      'density',
      'Density',
      'How much room things take.',
      [
        { label: 'Compact', value: 'compact' },
        { label: 'Normal', value: 'normal' },
        { label: 'Roomy', value: 'roomy' },
      ],
      'normal',
    ),
    displayRow(
      'motion',
      'Motion',
      'Reduced stops transitions and animations.',
      [
        { label: 'Follow system', value: 'system' },
        { label: 'Full', value: 'full' },
        { label: 'Reduced', value: 'reduced' },
      ],
      'system',
    ),
  ],
};

const themesSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Themes'] },
    themeModeRow('!themeStore.themeManagementList.exists(t, t.id == themeStore.currentTheme.id)'),
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'themeStore.themeManagementList' }, as: 'theme' },
          children: [
            {
              // The fill is the block's, so the light-or-dark row under a theme sits inside its highlight.
              type: 'Column',
              props: { r: '200', bg: { $: "theme.isDefault ? 'accent-soft' : 'transparent'" } },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', p: '300' },
                  children: [
                    // Theme icon + name
                    {
                      type: 'Row',
                      props: { gap: '300', ay: 'center', flex: '1', minWidth: '0' },
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
                          props: {},
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
                                  $invoke: 'themeStore.setThemeInstalled',
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
                                  $invoke: 'themeStore.setDefaultTheme',
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
                              $invoke: 'themeStore.deleteTheme',
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
                themeModeRow('theme.id == themeStore.currentTheme.id'),
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
      bg: 'surface',
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
              /*
                What the module can reach — derived by the host from its manifest and what it
                contributes, so it cannot go stale. The contract used to carry a list every module
                wrote and nothing read; this is the row that reads it.
              */
              {
                type: '$if',
                props: {
                  condition: { $: 'count(mod.capabilities)' },
                  then: {
                    type: 'we-text',
                    props: { variant: 'footnote', color: 'text-faint' },
                    children: [{ $: "`Can: ${join(mod.capabilities, ', ')}`" }],
                  },
                },
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
 * What each capability lets *you* decide, everywhere.
 *
 * The personal half of the settings a module declares — the community's half is the same rows in
 * space settings, and this one is written to the root dataset so no other member sees it. Rendered
 * from the declarations rather than written out, so a module that adds a setting appears here with
 * nothing to register; a deployment whose modules declare none renders no section at all.
 *
 * One control per row rather than the pair space settings shows, because there is no second audience
 * here: this is what you want everywhere, and a community's answer about its own space does not
 * overrule it — see `BINDING` in `moduleSettings.ts`. The only thing that can take the decision away
 * is the deployment, which is what the disabled control says. Explaining that is the whole job of the
 * sentence under the label: a switch that takes a press and springs back reads as broken.
 */
const agentModuleSettingsSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(spaceStore.agentModuleSettings)' },
    then: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['What these modules do'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                'Your own answers, in every space. A community can decide differently for its own space, and where the two disagree the more cautious one stands.',
              ],
            },
          ],
        },
        {
          type: '$each',
          props: { items: { $: 'spaceStore.agentModuleSettings' }, as: 'setting' },
          children: [
            {
              type: 'Row',
              props: {
                width: '100%',
                gap: '400',
                ay: 'center',
                p: '400',
                bg: 'surface',
                r: '300',
                border: '1px solid border',
              },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100', flex: '1', minWidth: '0' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center', wrap: true },
                      children: [
                        { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'setting.label' }] },
                        { type: 'we-badge', props: { size: 'xs' }, children: [{ $: 'setting.groupLabel' }] },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: [
                        {
                          $: "setting.locked ? 'Set by this deployment, so it cannot be changed here.' : (setting.description ?? '')",
                        },
                      ],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'setting.set' },
                    then: {
                      type: 'we-tooltip',
                      props: { content: 'Stop deciding this' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'xs',
                            onClick: {
                              $invoke: 'spaceStore.setAgentModuleSetting',
                              args: [{ $: 'setting.group' }, { $: 'setting.key' }],
                            },
                          },
                          children: ['Use default'],
                        },
                      ],
                    },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: "setting.type == 'boolean'" },
                    then: {
                      type: 'we-switch',
                      props: {
                        size: 'sm',
                        checked: { $: 'setting.value' },
                        disabled: { $: 'setting.locked' },
                        onChange: {
                          $invoke: 'spaceStore.setAgentModuleSetting',
                          args: [{ $: 'setting.group' }, { $: 'setting.key' }, { $: 'event.detail' }],
                        },
                      },
                    },
                    else: {
                      type: '$if',
                      props: {
                        condition: { $: "setting.type == 'enum'" },
                        then: {
                          type: 'we-select',
                          props: {
                            size: 'sm',
                            options: { $: 'setting.options' },
                            value: { $: 'setting.value' },
                            disabled: { $: 'setting.locked' },
                            onChange: {
                              $invoke: 'spaceStore.setAgentModuleSetting',
                              args: [{ $: 'setting.group' }, { $: 'setting.key' }, { $: 'event.detail' }],
                            },
                          },
                        },
                        else: {
                          type: 'we-input',
                          props: {
                            size: 'sm',
                            value: { $: 'setting.value' },
                            disabled: { $: 'setting.locked' },
                            onInput: {
                              $invoke: 'spaceStore.setAgentModuleSetting',
                              args: [{ $: 'setting.group' }, { $: 'setting.key' }, { $: 'event.detail' }],
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
    },
  },
};

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
    onChange: { $invoke: 'spaceStore.setModuleInstalled', args: [{ $: 'mod.id' }, { $: 'event.detail' }] },
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
      { type: 'we-tag', props: {}, children: ['Always on'] },
    ),
    agentModuleSettingsSection,
  ],
};

/**
 * The two ways a space gets into the list above, as a pair.
 *
 * They were a primary button and, under it, a labelled input with a Join beside it — two different
 * shapes for two halves of one question, and the second of them a second copy of a form the sidebar
 * now also needs. Both are dialogs held by the shell, so both are buttons here and there is one
 * join form in the app rather than two that can drift.
 *
 * Joining is `secondary`: creating is the thing somebody arrives at this page to do, and an address
 * you were sent is more often pasted from the sidebar, which is where it is now offered.
 */
const spaceActions: SchemaNode = {
  type: 'Row',
  props: { gap: '200', ay: 'center', wrap: true },
  children: [
    {
      type: 'we-button',
      props: {
        text: 'Create New Space',
        variant: 'solid',
        height: '40px',
        onClick: { $invoke: 'shellStore.setCreateSpaceOpen', args: [true] },
      },
    },
    {
      type: 'we-button',
      props: {
        text: 'Join a Space',
        variant: 'soft',
        height: '40px',
        onClick: { $invoke: 'shellStore.setJoinSpaceOpen', args: [true] },
      },
    },
  ],
};

/**
 * Which microphone and camera calls use, out of a call.
 *
 * The same chooser the call bar's More menu opens, placed inline — one `$part`, so there is one
 * device picker in the app rather than two that can drift. The call module owns it because the call
 * module owns the devices; this screen is a second door onto it.
 *
 * Out of a call is the harder half and the reason this exists rather than only the in-call sheet:
 * nothing is captured here, so the machine will not say what its hardware is called until it has
 * been asked for a device once. The part handles that itself — it offers to ask — which is why this
 * section is three lines and not thirty.
 */
const deviceSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Camera & microphone'] },
    {
      type: 'we-text',
      props: { variant: 'body', color: 'text-muted' },
      children: ['What calls capture with on this computer. Remembered here, and not carried to your other devices.'],
    },
    {
      type: 'Card',
      props: { bg: 'surface' },
      children: [{ type: '$part', props: { id: 'call.deviceSettings' } }],
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
      variant: expr`${selected} ? 'soft' : 'ghost'`,
      width: '100%',
      ax: 'start',
      onClick: { $invoke: 'routeStore.navigate', args: [path] },
    },
    children: [
      { type: 'we-icon', props: { name: icon } },
      { type: 'we-text', children: [label] },
    ],
  };
}

/** A heading over a run of nav entries. */
function navGroup(label: string, items: SchemaNode[]): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '100' },
    children: [
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'text-muted', px: '300', pt: '300' },
        children: [label],
      },
      ...items,
    ],
  };
}

/**
 * The one switch every developer affordance is gated on.
 *
 * ## Why this page gates on `devFeatures` and the switch reads `devTools`
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
        bg: 'surface',
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
            onChange: { $invoke: 'sessionStore.setDevTools', args: [{ $: 'event.detail' }] },
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
  props: { width: '100%', minHeight: '100%', bg: 'chrome', ax: 'center' },
  // Every route below declares whatever local state it needs. A route is rendered by `buildRoutes`
  // as its own `RenderSchema` call with a fresh context — so it is not a descendant of this node at
  // render time, whatever the schema tree looks like, and state declared here would never reach it.
  routes: [
    // Account — who you are and how you get in.
    { path: '/', ...page([profilePage]) },
    { path: '/security', ...page([securityPage]) },
    { path: '/plan', ...page([planPage]) },
    // Devices and access — what acts as you.
    { path: '/devices', ...page([devicesPage]) },
    {
      path: '/devices/this',
      // What runs underneath sits behind This device's Advanced switch: network, languages and logs
      // are what someone opens when the data layer misbehaves, and noise the rest of the time.
      $localState: { ...networkLocalState, ...loggingLocalState, ...languagesLocalState },
      ...page([thisDevicePage([runtimeError, executorSupport, trustedAgents, peerNetwork, logging, languagesSection])]),
    },
    { path: '/bots', ...page([botsPage]) },
    { path: '/connections', ...page([runtimeError, connectedApps]) },
    // This app — how it looks and what it does here.
    // How things look — and only that. What you run is its own page, below.
    { path: '/appearance', ...page([themeScopeSection, themesSection, displaySection]) },
    // What you run: the app around every space, the apps you installed, and the templates spaces
    // are drawn with. A question apart from how they look, and from the spaces themselves.
    { path: '/apps', ...page([appSection, appsSection, templatesSection, templateUpdatesSection]) },
    {
      path: '/spaces',
      ...page([
        spacesListSection,
        spaceActions,
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
    { path: '/camera', ...page([deviceSection]) },
    { path: '/ai', ...page([runtimeError, aiSection]) },
    // The pages these used to have, kept so a link into them still lands somewhere: their sections
    // now sit behind This device's Advanced switch.
    {
      path: '/languages',
      $localState: languagesLocalState,
      ...page([runtimeError, languagesSection]),
    },
    {
      path: '/network',
      $localState: { ...networkLocalState, ...loggingLocalState },
      ...page([runtimeError, executorSupport, trustedAgents, peerNetwork, logging]),
    },
    // No `$if` on the route itself: its nav entry is already gated, and a production build resolves
    // the switch to false whatever it is set to, so the page is inert rather than dangerous if
    // somebody navigates to it directly.
    { path: '/developer', ...page([developerSection]) },
    // Anything else lands on Profile rather than an empty frame.
    { path: '*', ...page([profilePage]) },
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
              props: { gap: '300', width: '200px', minWidth: '200px' },
              children: [
                navGroup('Account', [
                  navItem('Profile', 'user', '/'),
                  navItem('Security', 'shield-check', '/security'),
                  navItem('Plan & usage', 'credit-card', '/plan'),
                ]),
                navGroup('Devices and access', [
                  navItem('Devices', 'devices', '/devices'),
                  /*
                    The models the backend on this device runs — language and transcription — which
                    every app connected to it uses, and bots run on; so beside them, not under This
                    app. Feature-detected, as before.
                  */
                  {
                    type: '$if',
                    props: {
                      condition: { $: 'runtimeStore.canManageAi' },
                      then: navItem('AI models', 'sparkle', '/ai'),
                    },
                  },
                  navItem('Bots', 'robot', '/bots'),
                  // Feature-detected: a backend that administers no apps has nothing to show here.
                  {
                    type: '$if',
                    props: {
                      condition: { $: 'runtimeStore.canManageApps' },
                      then: navItem('Connections', 'plugs-connected', '/connections'),
                    },
                  },
                ]),
                navGroup('This app', [
                  // How it looks, what it is drawn with, what it can do — then what you keep.
                  navItem('Appearance', 'palette', '/appearance'),
                  navItem('Apps & templates', 'app-window', '/apps'),
                  navItem('Modules', 'squares-four', '/modules'),
                  navItem('Spaces & data', 'stack', '/spaces'),
                  /*
                    Only where calls are installed, which is what makes the entry honest: microphones
                    and cameras are for calling with, and a deployment without the module would be
                    offering a screen about hardware it never touches. `modules.call` resolves to
                    nothing where it is absent, so the entry simply is not there.
                  */
                  {
                    type: '$if',
                    props: {
                      condition: { $: 'modules.call' },
                      then: navItem('Camera & microphone', 'video-camera', '/camera'),
                    },
                  },
                  {
                    type: '$if',
                    props: {
                      // `devFeatures`, NOT `devTools` — see `developerSection`. Gating the way to
                      // the switch on the switch would make turning it off a one-way door.
                      condition: { $: 'sessionStore.devFeatures' },
                      then: navItem('Developer', 'flask', '/developer'),
                    },
                  },
                ]),
                // An action rather than a page, set apart at the foot of the nav — see `logOutAction`.
                { type: 'Column', props: { pt: '300', borderTop: '1px solid border' }, children: [logOutAction] },
              ],
            },
            { type: 'Column', props: { flex: '1', gap: '600' }, children: [{ type: '$routes' }] },
          ],
        },
      ],
    },
  ],
};
