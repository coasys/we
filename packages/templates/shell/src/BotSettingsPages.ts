/**
 * Settings → Bots: the person's bots, what each may do, and what each did.
 *
 * A bot is added in two halves, each where it must happen. Its key joins the person's key log where
 * the master key is kept ("Add a bot" opens the identity window, which shows an offer); its agent is
 * made here from that offer ("Make the bot"), and the backend answers a match code, which the person
 * checks in the identity window, and the bot's credential, shown once.
 *
 * Every word on a row comes worded from `botStore`, so these nodes only arrange. Nothing here is
 * offered to a space template: `botStore` is chrome only.
 */
import type { SchemaNode } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

/** What a node's children may hold: a node, text, or an expression. */
type Child = NonNullable<SchemaNode['children']>[number];

const heading = (title: SchemaNode | string, blurb: Child, action?: SchemaNode): SchemaNode => ({
  type: 'Row',
  props: { gap: '400', ay: 'start', ax: 'between', wrap: true },
  children: [
    {
      type: 'Column',
      props: { gap: '100', flex: '1 1 320px', minWidth: '0' },
      children: [
        typeof title === 'string'
          ? { type: 'we-text', props: { variant: 'heading-sm', tag: 'h2' }, children: [title] }
          : title,
        { type: 'we-text', props: { variant: 'body', color: 'text-muted' }, children: [blurb] },
      ],
    },
    ...(action ? [action] : []),
  ],
});

const sectionTitle = (text: string): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'label', color: 'text-muted' },
  children: [text],
});

const card = (children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface', r: 'surface', border: '1px solid border' },
  children,
});

const footnote = (icon: string, text: string): SchemaNode => ({
  type: 'Row',
  props: { gap: '200', ay: 'center' },
  children: [
    { type: 'we-icon', props: { name: icon, color: 'text-faint' } },
    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [text] },
  ],
});

const problem = (condition: string, text: string, tone = 'danger'): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: condition },
    then: { type: 'we-alert', props: { tone }, children: [{ $: text }] },
  },
});

// ─── The list ───────────────────────────────────────────────────────────────────

const addBotButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'botStore.canAdd' },
    then: {
      type: 'we-button',
      props: { variant: 'solid', size: 'sm', onClick: { $invoke: 'botStore.addBot' } },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add a bot'],
    },
  },
};

/** The bot just made: its match code, and its credential, once. */
const createdCard: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'botStore.created' },
    then: card([
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'robot', color: 'accent-text' } },
          {
            type: 'we-text',
            props: { fontWeight: 'semibold' },
            children: [{ $: '`${botStore.created.name} is made`' }],
          },
        ],
      },
      sectionTitle('Match code'),
      {
        type: 'we-text',
        props: { fontFamily: 'mono', fontSize: '600', letterSpacing: '0.1em' },
        children: [{ $: 'botStore.created.matchCode' }],
      },
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'text-muted' },
        children: [
          {
            $: '`Check that the identity window shows the same code, then add the bot there before ${botStore.created.confirmBy}. Until then it can do nothing.`',
          },
        ],
      },
      sectionTitle('Its credential'),
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', p: '200', bg: 'surface-sunken', r: 'control' },
        children: [
          {
            type: 'we-text',
            props: { fontFamily: 'mono', variant: 'footnote', flex: '1', minWidth: '0' },
            children: [{ $: 'botStore.created.token' }],
          },
          {
            type: 'we-tooltip',
            props: { content: 'Copy' },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'sm',
                  square: true,
                  label: 'Copy the credential',
                  onClick: { $invoke: 'clipboard.copy', args: [{ $: 'botStore.created.token' }, 'Credential'] },
                },
                children: [{ type: 'we-icon', props: { name: 'copy' } }],
              },
            ],
          },
        ],
      },
      {
        type: 'we-alert',
        props: { tone: 'warning' },
        children: [
          'This is shown once. Give it to the program that runs the bot and keep it like a password: whoever has it acts as the bot. It is not kept here.',
        ],
      },
      {
        type: 'Row',
        props: { ax: 'end' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'soft', size: 'sm', onClick: { $invoke: 'botStore.dismissCreated' } },
            children: ['I have saved it'],
          },
        ],
      },
    ]),
  },
};

/** Making the bot from the offer the identity window shows, which may be on another computer. */
const makeBotCard: SchemaNode = {
  type: 'Column',
  $localState: {
    botOffer: { type: 'string', initial: '' },
    botName: { type: 'string', initial: '' },
  },
  children: [
    card([
      { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Make a bot from an offer'] },
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'text-muted' },
        children: [
          '“Add a bot” on a computer that keeps your master key shows an offer. Paste it here and name the bot.',
        ],
      },
      {
        type: 'we-textarea',
        props: {
          label: 'Offer',
          placeholder: 'Paste the offer',
          rows: 2,
          value: { $: 'local.botOffer' },
          onInput: { $setLocal: 'botOffer', value: { $: 'event.detail' } },
        },
      },
      {
        type: 'we-input',
        props: {
          label: 'Name',
          placeholder: 'What the bot is called',
          value: { $: 'local.botName' },
          onInput: { $setLocal: 'botName', value: { $: 'event.detail' } },
        },
      },
      problem("botStore.createError != ''", 'botStore.createError'),
      {
        type: 'Row',
        props: { ax: 'end' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'solid',
              size: 'sm',
              disabled: { $: "local.botOffer == '' || botStore.creating" },
              loading: { $: 'botStore.creating' },
              onClick: {
                $invoke: 'botStore.create',
                args: [{ $: 'local.botOffer' }, { $: 'local.botName' }],
                onSuccess: [
                  {
                    $if: {
                      condition: { $: 'result' },
                      then: [
                        { $setLocal: 'botOffer', value: '' },
                        { $setLocal: 'botName', value: '' },
                      ],
                    },
                  },
                ],
              },
            },
            children: ['Make the bot'],
          },
        ],
      },
    ]),
  ],
};

const botRow: SchemaNode = {
  type: 'Row',
  props: { gap: '400', ay: 'center', wrap: true, px: '400', py: '300', borderBottom: '1px solid border' },
  children: [
    { type: 'we-icon', props: { name: 'robot', color: { $: "bot.revoked ? 'text-faint' : 'accent-text'" } } },
    {
      type: 'Column',
      props: { gap: '100', flex: '1 1 12rem', minWidth: '0' },
      children: [
        { type: 'we-text', children: [{ $: 'bot.name' }] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'bot.grantLine' }] },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: { $: 'bot.keyTone' } },
          children: [{ $: 'bot.keyLine' }],
        },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [{ $: 'bot.created' }] },
      ],
    },
    {
      type: 'Row',
      props: { gap: '400', ay: 'center', ax: 'end', wrap: true, ml: 'auto', flex: '0 1 auto', minWidth: '0' },
      children: [
        { type: 'we-badge', props: { tone: { $: 'bot.statusTone' }, size: 'sm' }, children: [{ $: 'bot.status' }] },
        {
          type: 'we-button',
          props: { variant: 'soft', size: 'sm', onClick: { $invoke: 'botStore.select', args: [{ $: 'bot.did' }] } },
          children: ['Manage'],
        },
      ],
    },
  ],
};

const botList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(botStore.bots)' },
    then: {
      type: 'Column',
      props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
      children: [{ type: '$each', props: { items: { $: 'botStore.bots' }, as: 'bot' }, children: [botRow] }],
    },
    else: {
      type: 'we-text',
      props: { color: 'text-muted', loading: { $: '!botStore.loaded' } },
      children: ['You have no bots yet.'],
    },
  },
};

const listView: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    heading(
      'Bots',
      'Bots act for you with keys of their own, only in the spaces you give them, and give a reason for each thing they write.',
      addBotButton,
    ),
    problem("botStore.error != ''", 'botStore.error'),
    createdCard,
    botList,
    makeBotCard,
    footnote(
      'lock',
      'A bot signs as itself, never as you. Each write and join it makes here, and each call refused, is logged; its reads are not.',
    ),
  ],
};

// ─── One bot ────────────────────────────────────────────────────────────────────

const spaceChoice: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    {
      type: 'we-checkbox',
      props: {
        flex: '1',
        label: { $: 'space.name' },
        checked: { $: 'space.checked' },
        onChange: { $invoke: 'botStore.toggleSpace', args: [{ $: 'space.id' }] },
      },
      children: [{ $: 'space.name' }],
    },
    {
      type: '$if',
      props: {
        condition: { $: '!space.known' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['Not one of your spaces here'],
        },
      },
    },
  ],
};

const actionChoice: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    {
      type: 'we-checkbox',
      props: {
        flex: '1',
        label: { $: 'item.label' },
        checked: { $: 'item.checked' },
        disabled: { $: '!item.allowed && !item.checked' },
        onChange: { $invoke: 'botStore.toggleAction', args: [{ $: 'item.action' }] },
      },
      children: [{ $: 'item.label' }],
    },
    {
      type: '$if',
      props: {
        condition: { $: '!item.allowed' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['Its key may not'],
        },
      },
    },
  ],
};

const grantEditor: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'botStore.editor && !botStore.selected.revoked' },
    then: card([
      { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['What it may do'] },
      sectionTitle('Spaces'),
      {
        type: '$if',
        props: {
          condition: { $: 'count(botStore.editor.spaces)' },
          then: {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: '$each',
                props: { items: { $: 'botStore.editor.spaces' }, as: 'space' },
                children: [spaceChoice],
              },
            ],
          },
          else: {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-muted' },
            children: ['A bot can only be given a shared space, and you have none here yet.'],
          },
        },
      },
      sectionTitle('Actions'),
      {
        type: 'Column',
        props: { gap: '200' },
        children: [
          { type: '$each', props: { items: { $: 'botStore.editor.actions' }, as: 'item' }, children: [actionChoice] },
        ],
      },
      sectionTitle('Ends'),
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', wrap: true },
        children: [
          {
            type: 'we-input',
            props: {
              type: 'number',
              min: '1',
              size: 'sm',
              width: '8rem',
              label: 'Days from now',
              placeholder: 'Days',
              value: { $: 'botStore.editor.days' },
              onInput: { $invoke: 'botStore.setDays', args: [{ $: 'event.detail' }] },
            },
          },
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-muted' },
            children: [{ $: 'botStore.editor.ends' }],
          },
        ],
      },
      problem("botStore.editor.problem != ''", 'botStore.editor.problem', 'warning'),
      {
        type: 'Row',
        props: { gap: '200', ax: 'end' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              disabled: { $: '!botStore.editor.changed || botStore.saving' },
              onClick: { $invoke: 'botStore.resetDraft' },
            },
            children: ['Undo changes'],
          },
          {
            type: 'we-button',
            props: {
              variant: 'solid',
              size: 'sm',
              disabled: { $: "!botStore.editor.changed || botStore.editor.problem != '' || botStore.saving" },
              loading: { $: 'botStore.saving' },
              onClick: { $invoke: 'botStore.saveGrant' },
            },
            children: ['Save'],
          },
        ],
      },
    ]),
  },
};

const stateCard: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: '!botStore.selected.revoked' },
    then: card([
      { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Pause or revoke'] },
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'text-muted' },
        children: [
          {
            $: "botStore.selected.paused ? 'Paused: this computer refuses its next call until you resume it. Its grant is kept. A stream it already opened runs on until it ends.' : 'Pause makes this computer refuse its next call and keeps its grant. Revoke ends its sessions here for good.'",
          },
        ],
      },
      {
        type: 'Row',
        props: { gap: '200', wrap: true },
        children: [
          {
            type: '$if',
            props: {
              condition: { $: 'botStore.selected.paused' },
              then: {
                type: 'we-button',
                props: {
                  variant: 'soft',
                  size: 'sm',
                  disabled: { $: 'botStore.saving' },
                  onClick: { $invoke: 'botStore.resume' },
                },
                children: [{ type: 'we-icon', props: { name: 'play' } }, 'Resume'],
              },
              else: {
                type: 'we-button',
                props: {
                  variant: 'soft',
                  size: 'sm',
                  disabled: { $: 'botStore.saving' },
                  onClick: { $invoke: 'botStore.pause' },
                },
                children: [{ type: 'we-icon', props: { name: 'pause' } }, 'Pause'],
              },
            },
          },
          {
            type: 'we-button',
            props: {
              variant: 'soft',
              size: 'sm',
              color: 'danger-text',
              disabled: { $: 'botStore.saving' },
              onClick: { $setLocal: 'confirmRevokeBot', value: true },
            },
            children: [{ type: 'we-icon', props: { name: 'prohibit' } }, 'Revoke…'],
          },
        ],
      },
    ]),
    else: {
      type: 'we-alert',
      props: { tone: 'danger' },
      children: [
        'Revoked for good. It can do nothing again, and its grant can never change. To use a bot again, add a new one.',
      ],
    },
  },
};

const activityRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'start', px: '400', py: '300', borderBottom: '1px solid border' },
  children: [
    {
      type: 'we-icon',
      props: {
        name: { $: "entry.allowed ? 'check-circle' : 'prohibit'" },
        color: { $: "entry.allowed ? 'success-text' : 'danger-text'" },
      },
    },
    {
      type: 'Column',
      props: { gap: '100', flex: '1 1 12rem', minWidth: '0' },
      children: [
        { type: 'we-text', children: [{ $: 'entry.what' }] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'entry.reason' }] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [{ $: 'entry.when' }] },
      ],
    },
    {
      type: 'we-badge',
      props: { tone: { $: "entry.allowed ? 'success' : 'danger'" }, size: 'sm' },
      children: [{ $: 'entry.outcome' }],
    },
  ],
};

const activityLog: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Activity'] },
    {
      type: '$if',
      props: {
        condition: { $: 'count(botStore.activity)' },
        then: {
          type: 'Column',
          props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
          children: [
            { type: '$each', props: { items: { $: 'botStore.activity' }, as: 'entry' }, children: [activityRow] },
          ],
        },
        else: {
          type: 'we-text',
          props: { color: 'text-muted', loading: { $: '!botStore.activityLoaded' } },
          children: ['No recorded activity yet.'],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'botStore.hasOlder' },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            alignSelf: 'start',
            loading: { $: 'botStore.loadingOlder' },
            onClick: { $invoke: 'botStore.loadOlder' },
          },
          children: ['Load older'],
        },
      },
    },
  ],
};

const detailView: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  $localState: { confirmRevokeBot: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'sm', alignSelf: 'start', onClick: { $invoke: 'botStore.close' } },
      children: [{ type: 'we-icon', props: { name: 'caret-left' } }, 'Bots'],
    },
    heading(
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', wrap: true },
        children: [
          { type: 'we-text', props: { variant: 'heading-sm', tag: 'h2' }, children: [{ $: 'botStore.selected.name' }] },
          {
            type: 'we-badge',
            props: { tone: { $: 'botStore.selected.statusTone' }, size: 'sm' },
            children: [{ $: 'botStore.selected.status' }],
          },
        ],
      },
      { $: 'botStore.selected.keyLine' },
    ),
    problem("botStore.conflict != ''", 'botStore.conflict', 'warning'),
    problem("botStore.error != ''", 'botStore.error'),
    grantEditor,
    stateCard,
    activityLog,
    confirmModal({
      open: { $: 'local.confirmRevokeBot' },
      close: { $setLocal: 'confirmRevokeBot', value: false },
      title: { $: '`Revoke ${botStore.selected.name}?`' },
      body: 'This computer ends its sessions and refuses every call from it, for good. Its key stays in your key log until you remove it under Devices, and other computers trust that log, not this grant. This is final: a revoked bot cannot be resumed.',
      detail: 'To use a bot again, add a new one. Its activity log is kept.',
      confirmLabel: 'Revoke for good',
      confirm: { $invoke: 'botStore.revoke' },
    }),
  ],
};

export const botsSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'botStore.selected' },
    then: detailView,
    else: listView,
  },
};
