/**
 * Who is running the node this session is talking to.
 *
 * Absent entirely on the desktop hosts and on a local executor: `sessionStore.host` is only set for
 * a node chosen from the hosting directory, so its presence *is* the question "am I on someone
 * else's machine". Telling a user their data is on their own computer would be noise.
 *
 * It exists because WE was silent about this. An agent could be running on a metered node, paying
 * per operation, with no indication anywhere in the app that a node, an operator or a balance were
 * involved — and would first learn about credits by running out of them mid-call.
 *
 * Read-only throughout. Everything here belongs to whoever runs the node; the connect UI is where it
 * is chosen and changed, and this is the app reporting where it ended up.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/** One label-and-value line, omitted when there is no value rather than shown as blank. */
function detail(label: string, value: SchemaProp): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: value,
      then: {
        type: 'Row',
        props: { gap: '300', ay: 'start', ax: 'between', wrap: true },
        children: [
          { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [label] },
          {
            type: 'we-text',
            props: { variant: 'footnote', textAlign: 'right', styles: { 'word-break': 'break-all' } },
            children: [value],
          },
        ],
      },
    },
  };
}

const identity: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    {
      type: 'we-avatar',
      props: {
        image: { $store: 'sessionStore.host.imageUrl' },
        initials: { $store: 'sessionStore.host.name' },
        size: 'md',
      },
    },
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'body', fontWeight: 'medium' },
          children: [{ $store: 'sessionStore.host.name' }],
        },
        {
          // Tested on the container, not the field: `host` present with no description is a host
          // that did not write one, and `host` absent is a section that should not be rendering.
          type: '$if',
          props: {
            condition: { $store: 'sessionStore.host.description' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $store: 'sessionStore.host.description' }],
            },
          },
        },
      ],
    },
  ],
};

/**
 * The balance, and only when the operator is actually charging.
 *
 * `freeAccess` is not the same as a zero balance: on a free node the number is meaningless, and
 * showing "0 credits" there would read as an account that had run dry.
 */
const credits: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $and: [{ $store: 'sessionStore.hostAccount' }, { $not: { $store: 'sessionStore.hostAccount.freeAccess' } }],
    },
    then: {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'lightning', color: 'text-muted' } },
            { type: 'we-text', props: { variant: 'footnote' }, children: ['Credits remaining'] },
          ],
        },
        {
          type: 'we-number',
          props: { value: { $store: 'sessionStore.hostAccount.remainingCredits' }, shorten: true },
        },
      ],
    },
  },
};

/**
 * What the host says it can run, from the directory rather than from the executor.
 *
 * Worth showing precisely because it needs no capability: a guest may be refused the model list and
 * still get an honest answer here about whether this node can transcribe or prompt at all.
 */
const advertisedModels: SchemaNode = {
  type: '$if',
  props: {
    condition: { $count: { items: { $store: 'sessionStore.host.aiModels' } } },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['AI models offered'] },
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'sessionStore.host.aiModels' }, as: 'model' },
              children: [{ type: 'we-tag', props: { variant: 'neutral' }, children: ['$model'] }],
            },
          ],
        },
      ],
    },
  },
};

const pricing: SchemaNode = {
  type: '$if',
  props: {
    condition: { $count: { items: { $store: 'sessionStore.host.rates' } } },
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Rates'] },
        {
          type: '$each',
          props: { items: { $store: 'sessionStore.host.rates' }, as: 'rate' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ax: 'between', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'footnote' }, children: ['$rate.description'] },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [{ $concat: ['$rate.priceInHOT', ' HOT'] }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

export const hostSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'sessionStore.host' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'hard-drives', color: 'text-muted' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Connected to'] },
          ],
        },
        {
          type: 'Card',
          props: { bg: 'surface-sunken' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                identity,
                credits,
                {
                  type: 'Column',
                  props: { gap: '150' },
                  children: [
                    detail('Address', { $store: 'sessionStore.host.url' }),
                    detail('Location', { $store: 'sessionStore.host.location' }),
                    detail('Hardware', { $store: 'sessionStore.host.computeSpecs' }),
                    detail('Signed in as', { $store: 'sessionStore.hostAccount.email' }),
                  ],
                },
                advertisedModels,
                pricing,
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint', italic: true },
                  children: [
                    'Your data and your agent live on this node. Signing out forgets it and returns you to the host picker.',
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};
