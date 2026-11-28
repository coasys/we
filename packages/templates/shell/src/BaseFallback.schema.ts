import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

/**
 * WE's own app before a session, for a deployment whose app brings no `base` of its own.
 *
 * Such a deployment asks nothing before a session — no first run, no choice of where to connect: the
 * base host takes the first place its host offers, as WE always booted. What this draws is only what
 * cannot wait for a session, because there is none yet to draw it:
 *
 * - this device's own backend starting, and why it failed to start, with "Try again" — on the
 *   desktop that was an error box and a quit;
 * - the place chosen could not be reached (offline), with "Try again";
 * - the connection being made;
 * - the connection that could not be made, or the list of places that could not be read, with why
 *   and a way on: each place to connect to again, or "Try again" where there is none.
 *
 * Read against `baseStore` alone, at the chrome tier (`BaseApp`).
 */

const centred = (children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100dvh',
    ax: 'center',
    ay: 'center',
    gap: '500',
    p: '600',
    bg: 'page',
  },
  children,
});

const waiting = (words: string | { $: string }): SchemaNode =>
  centred([
    { type: 'we-animated-icon', props: { name: 'spinner', size: 'lg' } },
    { type: 'we-text', props: { color: 'text-muted' }, children: [words] },
  ]);

const problem = (id: string, title: string | { $: string }, reason: string): SchemaNode => ({
  ...centred([
    { type: 'we-text', props: { variant: 'heading-lg', tag: 'h1' }, children: [title] },
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '520px', gap: '400' },
      children: [
        { type: 'we-alert', props: { tone: 'danger' }, children: [{ $: reason }] },
        {
          type: 'Row',
          props: { gap: '300', ax: 'end' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'solid',
                loading: { $: 'baseStore.busy' },
                onClick: { $invoke: 'baseStore.retry' },
              },
              // A backend that ran and stopped is started again, under the deployment's name.
              children: [
                {
                  $: "baseStore.stage == 'failed' && baseStore.executorStopped ? `Start ${baseStore.brand.name}` : 'Try again'",
                },
              ],
            },
          ],
        },
      ],
    },
  ]),
  id,
});

/*
  The connection choice, which this base never asks for: the store lands on it only when the first
  place offered could not be taken — the list could not be read or was empty, the place refused, the
  connector failed — or after a refused sign-in is handed back. Drawn as a wait, it was one that never
  ended, with the reason hidden. So it says why and offers each place again, or "Try again", which
  reads the list afresh.
*/
const connectChoice: SchemaNode = {
  ...centred([
    {
      type: 'we-text',
      props: { variant: 'heading-lg', tag: 'h1' },
      children: [{ $: "baseStore.error != '' ? 'Can’t connect' : `Open ${baseStore.brand.name}`" }],
    },
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '520px', gap: '400' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: "baseStore.error != ''" },
            then: { type: 'we-alert', props: { tone: 'danger' }, children: [{ $: 'baseStore.error' }] },
          },
        },
        {
          type: 'Row',
          props: { gap: '300', ax: 'end', wrap: true },
          children: [
            {
              type: '$each',
              props: { items: { $: 'baseStore.connections' }, as: 'place' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'solid',
                    loading: { $: 'baseStore.busy' },
                    onClick: { $invoke: 'baseStore.choose', args: [{ $: 'place.id' }] },
                  },
                  children: [{ $: '`Connect to ${place.label}`' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'count(baseStore.connections) == 0' },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'solid',
                    loading: { $: 'baseStore.busy' },
                    onClick: { $invoke: 'baseStore.retry' },
                  },
                  children: ['Try again'],
                },
              },
            },
          ],
        },
      ],
    },
  ]),
  id: 'chrome__connect',
};

export const baseFallback: TemplateSchema & { id: string } = {
  id: 'we-base',
  type: 'Column',
  meta: {
    name: 'Before you sign in',
    description: 'Startup and connection screens.',
    icon: 'power',
    role: 'base',
  },
  props: { display: 'contents' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'failed'" },
        then: problem(
          'chrome__executor-failed',
          {
            $: 'baseStore.executorStopped ? `${baseStore.brand.name} stopped` : `${baseStore.brand.name} couldn’t start`',
          },
          "baseStore.executorReason != '' ? baseStore.executorReason : 'Something went wrong.'",
        ),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'offline'" },
        then: problem('chrome__offline', 'Can’t connect', 'baseStore.offlineReason'),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'starting'" },
        then: waiting({ $: '`Starting ${baseStore.brand.name}…`' }),
      },
    },
    {
      type: '$if',
      props: {
        condition: {
          $: "baseStore.stage == 'loading' || baseStore.stage == 'handing-off'",
        },
        then: waiting('Connecting…'),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'connect'" },
        then: connectChoice,
      },
    },
  ],
};
