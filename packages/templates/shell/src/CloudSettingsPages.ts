/**
 * Settings → Devices and This device: a host as a place the person's identity lives.
 *
 * Two roles, from `hostStore`. As a **tenant** the person sees what they use on a host (Coasys cloud,
 * or one they name), can save everything to a file, load such a file, or leave it keeping their data or
 * deleting it. A host that holds them (`hostStore.held`) allows reading, exporting, usage and leaving
 * only, so those are the buttons left. As the **operator** of the host this computer runs, they choose
 * who may join, send invites and see who is on it.
 *
 * Every word on a row comes worded from the store, which also decides what the host can do; the screens
 * only arrange it.
 */
import type { SchemaNode } from '@we/schema-shared';
import { comingSoon, confirmModal } from '@we/template-kit';

type Content = NonNullable<SchemaNode['children']>[number];

const row = (label: string, value: Content): SchemaNode => ({
  type: 'Row',
  props: { gap: '300', ax: 'between', wrap: true },
  children: [
    { type: 'we-text', props: { color: 'text-muted' }, children: [label] },
    { type: 'we-text', children: [value] },
  ],
});

const footnote = (text: string): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'footnote', color: 'text-muted' },
  children: [text],
});

/** What a call to the host or to this computer said went wrong, once. */
const problem = (expression: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `${expression} != ''` },
    then: { type: 'we-text', props: { color: 'danger-text' }, children: [{ $: expression }] },
  },
});

const notice = (expression: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: `${expression} != ''` },
    then: { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: expression }] },
  },
});

// ─── As a tenant ────────────────────────────────────────────────────────────────

const usageRows: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    row('Host', { $: 'hostStore.usage.host' }),
    row('Cost', { $: 'hostStore.usage.spend' }),
    row('Storage', { $: 'hostStore.usage.storage' }),
    row('AI', { $: 'hostStore.usage.aiRuns' }),
    row('Private spaces', { $: 'hostStore.usage.privateSpaces' }),
    {
      type: '$each',
      props: { items: { $: 'hostStore.usage.spaces' }, as: 'space' },
      children: [row('', { $: "space.name + ': ' + space.shared" })],
    },
  ],
};

/** The host holds this person: say what still works, and nothing else is offered. */
const heldNotice: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostStore.held' },
    then: {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold', color: 'warning-text' }, children: ['On hold'] },
        {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: ['You can view, export and leave. Nothing else works until the host lifts the hold.'],
        },
      ],
    },
  },
};

const welcome: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostStore.isCoasysCloud' },
    then: {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Welcome to Coasys cloud'] },
        {
          type: 'we-text',
          props: { color: 'text-muted' },
          children: ['This device keeps a copy of your spaces, so they open on all your devices.'],
        },
      ],
    },
  },
};

const leaveModal: SchemaNode = confirmModal({
  open: { $: 'local.leaveOpen' },
  close: { $setLocal: 'leaveOpen', value: false },
  title: { $: "'Leave ' + hostStore.usage.host + '?'" },
  body: 'This device stops working with the host. Your other devices are not affected.',
  children: [
    {
      type: 'we-checkbox',
      props: {
        checked: { $: 'local.exportFirst' },
        onChange: { $setLocal: 'exportFirst', value: { $: 'event.detail' } },
      },
      children: ['Export my data first'],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.exportFirst' },
        then: footnote("The file isn't encrypted. Keep it somewhere safe."),
      },
    },
    {
      type: 'we-checkbox',
      props: {
        checked: { $: 'local.deleteData' },
        onChange: { $setLocal: 'deleteData', value: { $: 'event.detail' } },
      },
      children: ['Delete my data on this host'],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.deleteData' },
        then: {
          type: 'we-text',
          props: { color: 'danger-text' },
          children: ['Deleting is final. The host destroys your data and no one can recover it.'],
        },
      },
    },
  ],
  confirmLabel: 'Leave',
  confirm: {
    $invoke: 'hostStore.leave',
    args: [{ $: '!local.deleteData' }, { $: 'local.exportFirst' }],
  },
  busy: { $: 'hostStore.busy' },
});

/** What the person uses on a host, and what they can do there. */
export const cloudUsageCard: SchemaNode = comingSoon({
  available: { $: 'hostStore.canViewHost' },
  icon: 'chart-bar',
  title: 'Cloud usage',
  description: 'See what you use on a host, save your data or leave it.',
  preview: [
    {
      type: 'Row',
      props: { gap: '200', wrap: true },
      children: ['View usage', 'Export data', 'Leave'].map((label) => ({
        type: 'we-button',
        props: { variant: 'soft', size: 'sm' },
        children: [label],
      })),
    },
  ],
  children: [
    {
      type: 'Column',
      props: { gap: '300' },
      $localState: {
        hostAddress: { type: 'string', initial: '' },
        leaveOpen: { type: 'boolean', initial: false },
        exportFirst: { type: 'boolean', initial: true },
        deleteData: { type: 'boolean', initial: false },
      },
      children: [
        {
          type: 'we-input',
          props: {
            placeholder: 'Host address (optional)',
            value: { $: 'local.hostAddress' },
            onInput: { $setLocal: 'hostAddress', value: { $: 'event.detail' } },
          },
        },
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                size: 'sm',
                loading: { $: 'hostStore.busy' },
                disabled: { $: 'hostStore.busy' },
                onClick: { $invoke: 'hostStore.openHost', args: [{ $: 'local.hostAddress' }] },
              },
              children: ['View usage'],
            },
          ],
        },
        problem('hostStore.error'),
        notice('hostStore.notice'),
        {
          type: '$if',
          props: {
            condition: { $: '!!hostStore.usage' },
            then: {
              type: 'Column',
              props: { gap: '300' },
              children: [
                welcome,
                heldNotice,
                usageRows,
                {
                  type: 'Row',
                  props: { gap: '200', wrap: true },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'soft',
                        disabled: { $: 'hostStore.busy' },
                        onClick: { $invoke: 'hostStore.exportData' },
                      },
                      children: ['Export data'],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: { $: '!hostStore.held' },
                        then: {
                          type: 'we-button',
                          props: {
                            size: 'sm',
                            variant: 'soft',
                            disabled: { $: 'hostStore.busy' },
                            onClick: { $invoke: 'hostStore.importData' },
                          },
                          children: ['Import data'],
                        },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'soft',
                        color: 'danger-text',
                        disabled: { $: 'hostStore.busy' },
                        onClick: { $setLocal: 'leaveOpen', value: true },
                      },
                      children: ['Leave'],
                    },
                  ],
                },
                leaveModal,
              ],
            },
          },
        },
      ],
    },
  ],
});

// ─── As the operator ────────────────────────────────────────────────────────────

const signupChoice: SchemaNode = {
  type: 'we-select',
  props: {
    value: { $: "hostStore.policy ? hostStore.policy.signup : ''" },
    options: { $: 'hostStore.signupOptions' },
    onChange: { $invoke: 'hostStore.setSignup', args: [{ $: 'event.detail' }] },
  },
};

const inviteRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ax: 'between', ay: 'center', wrap: true },
  children: [
    {
      type: 'Column',
      props: { gap: '0' },
      children: [
        { type: 'we-text', children: [{ $: 'invite.note' }] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [{ $: "invite.status + ' until ' + invite.expires" }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'invite.canRevoke' },
        then: {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: 'soft',
            disabled: { $: 'hostStore.operatorBusy' },
            onClick: { $invoke: 'hostStore.revokeInvite', args: [{ $: 'invite.id' }] },
          },
          children: ['Revoke'],
        },
      },
    },
  ],
};

const personRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ax: 'between', ay: 'center', wrap: true },
  children: [
    {
      type: 'Column',
      props: { gap: '0' },
      children: [
        { type: 'we-text', children: [{ $: 'person.label' }] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [{ $: "person.state + ' since ' + person.since" }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'person.canRemove' },
        then: {
          type: 'we-button',
          props: {
            size: 'sm',
            variant: 'soft',
            color: 'danger-text',
            disabled: { $: 'hostStore.operatorBusy' },
            onClick: { $invoke: 'hostStore.removePerson', args: [{ $: 'person.id' }] },
          },
          children: ['Remove'],
        },
      },
    },
  ],
};

/** Who may join the host this computer runs, and the invites sent. Absent where the host takes one person. */
export const signupsCard: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostStore.canOperate' },
    then: {
      type: 'Card',
      props: { bg: 'surface', gap: '300' },
      $localState: { inviteNote: { type: 'string', initial: '' } },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Sign-ups'] },
        {
          type: '$if',
          props: {
            condition: { $: 'hostStore.choiceNeeded' },
            then: {
              type: 'we-text',
              props: { color: 'warning-text' },
              children: [{ $: 'hostStore.choiceNeededText' }],
            },
          },
        },
        {
          type: 'we-form-field',
          props: { label: 'Who can join' },
          children: [signupChoice],
        },
        {
          type: 'we-form-field',
          props: { label: 'Invite note' },
          children: [
            {
              type: 'we-input',
              props: {
                placeholder: 'Who is it for?',
                value: { $: 'local.inviteNote' },
                onInput: { $setLocal: 'inviteNote', value: { $: 'event.detail' } },
              },
            },
          ],
        },
        {
          type: 'Row',
          children: [
            {
              type: 'we-button',
              props: {
                size: 'sm',
                loading: { $: 'hostStore.operatorBusy' },
                disabled: { $: 'hostStore.operatorBusy' },
                onClick: { $invoke: 'hostStore.createInvite', args: [{ $: 'local.inviteNote' }] },
              },
              children: ['Create invite'],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: "hostStore.newInvite != ''" },
            then: {
              type: 'Column',
              props: { gap: '100' },
              children: [
                { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Invite code'] },
                { type: 'we-text', props: { variant: 'code' }, children: [{ $: 'hostStore.newInvite' }] },
                footnote("Copy it now. It isn't shown again."),
              ],
            },
          },
        },
        problem('hostStore.operatorError'),
        { type: '$each', props: { items: { $: 'hostStore.invites' }, as: 'invite' }, children: [inviteRow] },
      ],
    },
  },
};

/** The people on the host this computer runs. */
export const peopleCard: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostStore.canOperate' },
    then: {
      type: 'Card',
      props: { bg: 'surface', gap: '300' },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['People'] },
        {
          type: '$if',
          props: {
            condition: { $: 'hostStore.people.length > 0' },
            then: { type: '$each', props: { items: { $: 'hostStore.people' }, as: 'person' }, children: [personRow] },
            else: { type: 'we-text', props: { color: 'text-muted' }, children: ['No one has joined yet.'] },
          },
        },
      ],
    },
  },
};
