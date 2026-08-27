import type { SchemaNode } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

/**
 * The other accounts on this machine, and removing them.
 *
 * Deliberately *here* and not on the sign-in screen. Deletion is irreversible, and the sign-in
 * screen is pre-authentication — anyone who opens the laptop reaches it without a password, so
 * putting a destructive action there means physical access alone is enough to erase an account.
 * macOS and Windows both keep account deletion behind an authenticated session for the same
 * reason. (ChromeOS allows it on its login screen; it is the outlier.)
 *
 * Only *other* accounts can be removed: the host refuses the active one, because its executor
 * holds the directory open. That reads oddly stated baldly — you delete the account you are not
 * using — but it is the same shape as an authenticated macOS user removing other local users.
 */

/** The row for one account: who it is, and whether it can be removed. */
const accountRow: SchemaNode = {
  type: 'Card',
  props: { bg: 'surface' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'we-avatar',
              props: { image: '$account.avatar', initials: '$account.name', size: 'sm', bg: 'accent-muted' },
            },
            { type: 'we-text', props: { variant: 'label' }, children: ['$account.name'] },
            {
              type: '$if',
              props: {
                condition: '$account.active',
                then: { type: 'we-badge', props: { variant: 'primary', size: 'xs' }, children: ['Signed in'] },
              },
            },
          ],
        },
        // No remove control on the active account at all, rather than a disabled one: the reason
        // it cannot go is that you are using it, which the badge already says.
        {
          type: '$if',
          props: {
            condition: { $not: '$account.active' },
            then: {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'accountStore.requestRemoval', args: ['$account.id'] },
              },
              children: [{ type: 'we-icon', props: { name: 'trash' } }],
            },
          },
        },
      ],
    },
  ],
};

export const accountSettings: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'accountStore.canManageAccounts' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Accounts on this device'] },
        {
          type: '$if',
          props: {
            condition: { $store: 'accountStore.error' },
            then: { type: 'we-alert', props: { variant: 'danger' }, children: [{ $store: 'accountStore.error' }] },
          },
        },
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: { items: { $store: 'accountStore.accounts' }, as: 'account' },
              children: [accountRow],
            },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['Each account is a separate identity with its own spaces and data.'],
        },
      ],
    },
  },
};

/**
 * The removal confirmation.
 *
 * Says what is actually about to happen rather than a generic "are you sure", because two of the
 * three consequences are not guessable: the data goes permanently, another AD4M app may be using
 * the same account right now, and — for the account holding the ADAM launcher's registry — the
 * launcher also loses its record of every *other* agent it knows about.
 *
 * It was written as a hand-rolled scrim — a fixed Column over `rgba(0,0,0,0.5)` at z-index 9998 —
 * which meant it was the one dialog in the app outside the browser's top layer, with a literal
 * black instead of the theme's `overlay` role, and neither the focus trap nor the Escape handler
 * every other modal gets from the primitive. It looked the most considered of the confirmations
 * and was the least sound of them. What it had that the others lacked — an icon, a real heading, a
 * quieter second line — is now what `confirmModal` gives all of them.
 */
export const removeAccountModal: SchemaNode = confirmModal({
  open: { $store: 'accountStore.pendingRemoval' },
  close: { $action: 'accountStore.cancelRemoval' },
  title: { $concat: ['Delete ', { $store: 'accountStore.pendingRemoval.name' }, '?'] },
  body: 'This permanently deletes the account and everything in it — its identity, its spaces, and its data. It cannot be undone.',
  detail: 'Close Flux and the ADAM launcher first if they use this account.',
  children: [
    // Only for the account the launcher keeps its registry inside. Nobody would predict this one,
    // which is exactly why it is worth a line.
    {
      type: '$if',
      props: {
        condition: { $store: 'accountStore.pendingRemoval.sharedWithLauncher' },
        then: {
          type: 'we-alert',
          props: { variant: 'warning' },
          children: [
            "The ADAM launcher stores its list of agents inside this account, so removing it will also clear the launcher's record of your other agents.",
          ],
        },
      },
    },
  ],
  confirmLabel: 'Delete account',
  // The store runs the removal and already knows it is running — a `busyLocal` beside it could only
  // disagree with it.
  busy: { $store: 'accountStore.busy' },
  confirm: { $action: 'accountStore.confirmRemoval' },
});
