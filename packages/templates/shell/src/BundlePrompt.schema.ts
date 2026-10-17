import type { SchemaNode } from '@we/schema-shared';

/**
 * BundlePrompt — what an app you are about to install from a file brings, and what it will be able
 * to do.
 *
 * The template install prompt's counterpart one level up, and host chrome for the same reason: a
 * dialog vouching for an app must not be drawn by an app. Everything it shows was worked out from the
 * app's templates (`judgeBundle`), never taken from what the file says about itself — except who made
 * it, which is shown as a claim, beside the plain statement that nothing attests to a file.
 *
 * The four things a person is agreeing to, each in its own words, because each has its own
 * consequence: what the app will be able to do; which modules it turns on, as against which this
 * deployment does not have and nothing here can fix; the spaces it sets up — the kinds of record it
 * adds to each, which outlast the app — ticked one by one; and how it shows spaces. On an update, what
 * it asks for that the version installed was never agreed to comes before all of them.
 */
const pending = 'bundleStore.pendingInstall';

const close = { $action: 'bundleStore.cancelInstall' };

/** A heading and a list of lines, absent when the list is empty. */
function listSection(heading: string, items: string, icon: string, iconColor: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `count(${items})` },
      then: {
        type: 'Column',
        props: { gap: '200' },
        children: [
          { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: [heading] },
          {
            type: '$each',
            props: { items: { $: items }, as: 'line' },
            children: [
              {
                type: 'Row',
                props: { gap: '300', ay: 'start' },
                children: [
                  { type: 'we-icon', props: { name: icon, color: iconColor } },
                  { type: 'we-text', props: { flex: '1' }, children: [{ $: 'line' }] },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

const capabilities: SchemaNode = {
  type: 'Column',
  props: { gap: '200', bg: 'surface', r: '400', p: '400' },
  children: [
    { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['This app will be able to:'] },
    {
      type: '$if',
      props: {
        condition: { $: `count(${pending}.capabilities)` },
        then: {
          type: '$each',
          props: { items: { $: `${pending}.capabilities` }, as: 'capability' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'start' },
              children: [
                { type: 'we-icon', props: { name: 'check', color: 'accent-text' } },
                { type: 'we-text', props: { flex: '1' }, children: [{ $: 'capability' }] },
              ],
            },
          ],
        },
        else: {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: ['Nothing — it only draws what is already on screen.'],
        },
      },
    },
  ],
};

/**
 * The spaces this agent runs, ticked to be set up for an app. Shared by the install prompt and the
 * Settings picker, which both read `bundleStore.spaceChoices` for whichever app they are about.
 * Only spaces this agent runs are listed: a space's record types and sections are its community's,
 * so nobody else's is offered.
 */
export function spaceChecklist(intro: SchemaNode['children']): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '200' },
    children: [
      { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['Set up spaces for it'] },
      { type: 'we-text', children: intro },
      {
        type: '$if',
        props: {
          condition: { $: 'count(bundleStore.spaceChoices)' },
          then: {
            type: 'Column',
            props: { gap: '200', bg: 'surface', r: '400', p: '400' },
            children: [
              {
                type: '$each',
                props: { items: { $: 'bundleStore.spaceChoices' }, as: 'choice' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '300', ay: 'center' },
                    children: [
                      {
                        type: 'we-checkbox',
                        props: {
                          flex: '1',
                          label: { $: 'choice.name' },
                          checked: { $: 'choice.chosen || choice.done' },
                          disabled: { $: 'choice.done' },
                          onChange: { $action: 'bundleStore.toggleSpace', args: [{ $: 'choice.id' }] },
                        },
                        // `label` names the control for a screen reader; what is seen is the slot.
                        children: [{ $: 'choice.name' }],
                      },
                      {
                        type: 'we-text',
                        props: { variant: 'footnote', color: 'text-muted' },
                        children: [{ $: "choice.done ? 'Already set up' : choice.here ? 'This space' : ''" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          else: {
            type: 'we-text',
            props: { color: 'text-muted' },
            children: ['You do not run any spaces, so there are none to set up. Whoever runs one can, from Settings.'],
          },
        },
      },
    ],
  };
}

/** Where its record types and sections go: the spaces ticked, and only those. */
const spaces: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `${pending}.needsSpace` },
    then: spaceChecklist([
      {
        $: `count(${pending}.recordTypes) ? \`It adds \${join(${pending}.recordTypes, ', ')} and its sections to each space you tick, for everyone in it. They stay if you remove the app, because they hold what people make with it.\` : 'It adds its sections to each space you tick, for everyone in it.'`,
      },
    ]),
  },
};

/**
 * On an update, what this version asks for that the installed one was never agreed to — first, and on
 * its own, because a new power listed among everything already agreed reads as one more line of the
 * same. Or, when it asks for nothing new, that sentence, so an update that only changes how the app
 * looks says so plainly. Absent on a first install, and on an update of something installed before
 * agreements were kept, where the full list below is all there is to go on.
 */
const newInVersion: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `${pending}.newInVersion` },
    then: {
      type: '$if',
      props: {
        condition: {
          $: `count(${pending}.newInVersion.capabilities) || count(${pending}.newInVersion.modules) || count(${pending}.newInVersion.recordTypes)`,
        },
        then: {
          type: 'we-alert',
          props: { variant: 'warning' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-text',
                  props: { fontWeight: 'semibold' },
                  children: ['New in this version — the one you have was never agreed to these'],
                },
                listSection('It will also be able to', `${pending}.newInVersion.capabilities`, 'plus', 'warning-text'),
                listSection('It also turns on', `${pending}.newInVersion.modules`, 'toggle-right', 'warning-text'),
                listSection(
                  'It also brings kinds of record',
                  `${pending}.newInVersion.recordTypes`,
                  'shapes',
                  'warning-text',
                ),
              ],
            },
          ],
        },
        else: {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: ['This version asks for nothing the one you have could not already do.'],
        },
      },
    },
  },
};

/** Modules this deployment does not have: a part of the app that will be empty, which nothing here fixes. */
const missingModules: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `count(${pending}.modulesNotInBuild)` },
    then: {
      type: 'we-alert',
      props: { variant: 'warning' },
      children: [
        {
          type: 'we-text',
          children: [
            {
              $: `\`This deployment does not have \${join(${pending}.modulesNotInBuild, ', ')}, so the parts of the app that use it will be empty.\``,
            },
          ],
        },
      ],
    },
  },
};

/** References its tier does not grant: already inert, named so nobody is surprised a button is dead. */
const blocked: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: `count(${pending}.blocked)` },
    then: {
      type: 'we-alert',
      props: { variant: 'warning' },
      children: [
        {
          type: 'we-text',
          children: [
            {
              $: `\`Parts of this app ask for things it is not allowed to do, and will not work: \${join(${pending}.blocked, ', ')}\``,
            },
          ],
        },
      ],
    },
  },
};

export const bundlePrompt: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: pending },
    then: {
      type: 'we-modal',
      props: { size: 'md', close },
      children: [
        {
          type: 'Row',
          slot: 'header',
          props: { gap: '300', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'shield-check', size: 'lg', color: 'accent-text' } },
            {
              type: 'we-text',
              props: { variant: 'heading-sm', tag: 'h2' },
              children: [
                {
                  $: `${pending}.updates ? \`Update \${${pending}.name} to \${${pending}.version}?\` : \`Install \${${pending}.name}?\``,
                },
              ],
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '500' },
          children: [
            // Provenance first: a file is the weakest there is, and the author is only a claim.
            {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: [
                {
                  $: `\`From the file \${${pending}.fileName}. Nothing attests to who made a file\${${pending}.author ? \` — it says it is by \${${pending}.author}\` : ''}.\${${pending}.updates ? \` You have version \${${pending}.updates}.\` : ''}\``,
                },
              ],
            },
            newInVersion,
            listSection('It adds', `${pending}.adds`, 'plus', 'text-muted'),
            capabilities,
            listSection('It turns on', `${pending}.modulesToTurnOn`, 'toggle-right', 'text-muted'),
            missingModules,
            spaces,
            {
              type: '$if',
              props: {
                condition: { $: `${pending}.display == 'ours'` },
                then: {
                  type: 'we-text',
                  children: [
                    'While it is the app you are in, every space opens in its own template, unless you chose one for that space yourself. Switching back to WE’s app puts every space back.',
                  ],
                },
              },
            },
            blocked,
          ],
        },
        {
          type: 'Row',
          slot: 'footer',
          props: { ax: 'end', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', disabled: { $: 'bundleStore.busy' }, onClick: close },
              children: ['Cancel'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                loading: { $: 'bundleStore.busy' },
                disabled: { $: 'bundleStore.busy' },
                onClick: { $action: 'bundleStore.confirmInstall' },
              },
              children: [{ $: `${pending}.updates ? 'Update' : 'Install'` }],
            },
          ],
        },
      ],
    },
  },
};
