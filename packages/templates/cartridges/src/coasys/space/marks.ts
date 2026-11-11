import type { SchemaNode, SchemaProp } from '@we/schema-shared';

/**
 * Small marks the tree and the views share.
 */

/**
 * Something happening now: a dot in the success colour with a ring going out from it, as Nico's
 * "online" and "live call" dots are. The design system's live drawing, so every one in the space
 * pulses in step and keeps still for anyone who asked for less motion. Unsized, it takes the icon
 * size of the badge it sits in; give it a size where it stands on its own.
 */
export const liveDot: SchemaNode = {
  type: 'we-animated-icon',
  props: { name: 'live', color: 'success' },
};

/**
 * A count at the end of a row, as a pill. Shown only while there is something to count. `tone` may
 * be an expression, for a count whose colour says something — calls, green while one is running.
 */
export const countPill = (expr: string, tone?: SchemaProp): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: expr },
    then: {
      type: 'we-badge',
      props: { variant: 'soft', size: 'xs', ...(tone ? { tone } : {}) },
      children: [{ $: expr }],
    },
  },
});

/**
 * A call's transcript to take away, as a ghost square with a tooltip: at the end of a call's bar and
 * on each card of the Calls page. Offered whether the call is running or over, and to everyone: it
 * reads the shared record and writes to the reader's own device, so there is nobody else's account
 * involved. `callId` is an expression for the call's record id. `md` stands the height of the bar's
 * Page / Canvas switch; a card takes `sm`, so it does not make the card taller or take its title's room.
 */
export const exportTranscriptButton = (callId: string, size: 'sm' | 'md' = 'md'): SchemaNode => ({
  type: 'we-tooltip',
  props: { content: 'Export the transcript', placement: 'bottom' },
  children: [
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size,
        square: true,
        label: 'Export the transcript',
        onClick: { $invoke: 'spaceStore.exportCallTranscript', args: [{ $: callId }] },
      },
      children: [{ type: 'we-icon', props: { name: 'download-simple' } }],
    },
  ],
});
