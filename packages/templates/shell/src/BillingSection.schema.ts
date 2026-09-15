/**
 * Billing section for the Account page.
 *
 * Shows the agent's credit balance and billing controls when connected to a hosted node that charges
 * for compute. Absent entirely on self-hosted nodes and on nodes that grant free access — the
 * section appearing *is* the answer to "does this node bill me", which avoids showing a meaningless
 * "0 credits" to somebody who was never going to pay.
 *
 * Reads from `sessionStore.hostAccount` (set by the connector at boot) and
 * `sessionStore.host` (the node metadata). No platform-specific code — any connector that
 * populates these fields gets a billing section, whether the backing system uses Stripe, Unyt, or
 * something else.
 */
import type { SchemaNode } from '@we/schema-shared';

/**
 * Credit balance row — the number and its label, styled to stand out without being loud.
 */
const creditBalance: SchemaNode = {
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
      props: { value: { $: 'sessionStore.hostAccount.remainingCredits' }, shorten: true },
    },
  ],
};

/**
 * "Manage billing" link — opens the billing portal URL in a new tab.
 * Only rendered when the connector supplied a URL.
 */
const billingLink: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'sessionStore.hostAccount.billingPortalUrl' },
    then: {
      type: 'we-button',
      props: {
        variant: 'outline',
        size: 'sm',
        onClick: { $action: 'window.open', args: [{ $: 'sessionStore.hostAccount.billingPortalUrl' }, '_blank'] },
      },
      children: [{ type: 'we-icon', props: { name: 'arrow-square-out', size: 'sm' } }, 'Manage billing'],
    },
  },
};

/**
 * Signed-in email row — shows which email the agent authenticated with on this node.
 */
const emailRow: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'sessionStore.hostAccount.email' },
    then: {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Signed in as'] },
        {
          type: 'we-text',
          props: { variant: 'footnote' },
          children: [{ $: 'sessionStore.hostAccount.email' }],
        },
      ],
    },
  },
};

/**
 * The complete billing section — gated on having a hosted account that charges for compute.
 *
 * The outer `$if` checks two things:
 * 1. `sessionStore.hostAccount` exists (connected to a hosted node with an account)
 * 2. `!freeAccess` (the operator actually charges — a free node has no bill to manage)
 *
 * When both hold, the card shows: credit balance, signed-in email, and (when available)
 * a "Manage billing" link to the external billing portal.
 */
export const billingSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'sessionStore.hostAccount && !sessionStore.hostAccount.freeAccess' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'credit-card', color: 'text-muted' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Billing'] },
          ],
        },
        {
          type: 'Card',
          props: { bg: 'surface' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [creditBalance, emailRow, billingLink],
            },
          ],
        },
      ],
    },
  },
};
