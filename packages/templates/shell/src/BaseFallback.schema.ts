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
 * - the connection being made.
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

const waiting = (words: string): SchemaNode =>
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
                variant: 'primary',
                loading: { $: 'baseStore.busy' },
                onClick: { $invoke: 'baseStore.retry' },
              },
              // A backend that ran and stopped is started again, under the deployment's name.
              children: [
                {
                  $: "baseStore.stage == 'failed' && baseStore.executorStopped ? `Start ${baseStore.brand.name} again` : 'Try again'",
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

export const baseFallback: TemplateSchema & { id: string } = {
  id: 'we-base',
  type: 'Column',
  meta: {
    name: 'Before you sign in',
    description: 'This device’s backend starting, and a place that could not be reached.',
    icon: 'power',
    role: 'base',
  },
  props: { styles: { display: 'contents' } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'failed'" },
        then: problem(
          'chrome__executor-failed',
          {
            $: 'baseStore.executorStopped ? `${baseStore.brand.name} has stopped` : `${baseStore.brand.name} could not start`',
          },
          "baseStore.executorReason != '' ? baseStore.executorReason : 'The backend on this computer stopped before it was ready.'",
        ),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'offline'" },
        then: problem('chrome__offline', 'You are offline', 'baseStore.offlineReason'),
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.stage == 'starting'" },
        then: waiting('Starting on this computer…'),
      },
    },
    {
      type: '$if',
      props: {
        condition: {
          $: "baseStore.stage == 'loading' || baseStore.stage == 'handing-off' || baseStore.stage == 'connect'",
        },
        then: waiting('Connecting…'),
      },
    },
  ],
};
