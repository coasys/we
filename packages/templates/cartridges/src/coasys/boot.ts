import type { SchemaNode } from '@we/schema-shared';
import { field } from '@we/template-kit';

/**
 * The Coasys sign-in screen, as Josh's identity ceremonies lay it out: the mark and the name in a bar
 * along the top, and one narrow column under it holding a heading, a sentence and the one thing to do.
 *
 * The password is typed into the host's `CredentialField` and nowhere else — what is typed there never
 * becomes template state, so this screen cannot keep or forward it. Everything around it is the app's.
 *
 * On a desktop build the column ends with the other accounts on this machine and a way to add one,
 * as WE's own screen offers them: switching and creating restart the app, so they are sign-in's to
 * offer, not the app's. The Coasys way in — passkeys, a master key, linking a device — waits for the
 * identity backend, and arrives here as more states of the same column.
 */

const brandBar: SchemaNode = {
  type: 'Row',
  props: { px: '800', py: '600', gap: '200', ay: 'center', width: '100%' },
  children: [
    {
      type: 'we-image',
      props: { src: { $: 'templateStore.brand.mark' }, alt: '', width: '22px', height: '22px' },
    },
    {
      type: 'we-text',
      props: { variant: 'body', fontWeight: 'semibold', letterSpacing: 'tight' },
      children: [{ $: 'templateStore.brand.name' }],
    },
  ],
};

/** A heading and the sentence under it, as every step of the ceremony opens. */
const head = (heading: SchemaNode['children'], intro: NonNullable<SchemaNode['children']>[number]): SchemaNode => ({
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1', letterSpacing: 'tight' }, children: heading },
    { type: 'we-text', props: { variant: 'ingress', color: 'text-muted' }, children: [intro] },
  ],
});

/** A wait with nothing to do but read why. */
const waiting = (words: NonNullable<SchemaNode['children']>[number]): SchemaNode => ({
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    { type: 'we-spinner', props: { size: 'sm' } },
    { type: 'we-text', props: { color: 'text-muted' }, children: [words] },
  ],
});

const signIn: SchemaNode = {
  type: 'Column',
  props: { gap: '600' },
  children: [
    // Names the account once there is more than one, so the password is typed into the right one.
    head(['Welcome back'], {
      $: "accountStore.hasOtherAccounts && accountStore.activeAccount ? `Unlock ${accountStore.activeAccount.name} on this device.` : 'Unlock your account on this device.'",
    }),
    {
      type: 'we-form-field',
      props: {
        label: 'Password',
        error: { $: "sessionStore.passwordError ? 'That password did not unlock it' : sessionStore.loginError" },
      },
      children: [
        {
          type: 'CredentialField',
          props: {
            purpose: 'unlock',
            width: '100%',
            placeholder: 'Your password',
            onEdit: { $invoke: 'sessionStore.clearPasswordError' },
            onSubmit: { $invoke: 'sessionStore.unlock' },
          },
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '300', pt: '200', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'solid',
            disabled: { $: '!sessionStore.credentialEntered' },
            loading: { $: 'sessionStore.loginLoading' },
            onClick: { $invoke: 'sessionStore.unlock' },
          },
          children: ['Unlock'],
        },
      ],
    },
  ],
};

const createAccount: SchemaNode = {
  type: 'Column',
  props: { gap: '600' },
  $localState: {
    name: { type: 'string', initial: '', validate: [{ rule: 'required', message: 'A name is required' }] },
  },
  children: [
    head(
      // Another account on a machine that has one already, rather than the first.
      [{ $: "accountStore.isFirstRun ? 'Make your account' : 'Add an account'" }],
      'A name people will know you by, and a password that unlocks you on this device.',
    ),
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        field({ name: 'name', label: 'Name', placeholder: 'What people call you', validated: true }),
        { type: 'CredentialField', props: { purpose: 'new' } },
      ],
    },
    {
      type: 'Row',
      props: { gap: '300', pt: '200', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'solid',
            loading: { $: 'sessionStore.createAgentLoading' },
            onClick: [
              { $touch: '$all' },
              { $invoke: 'sessionStore.touchCredential' },
              {
                $if: {
                  condition: { $: 'formValid() && sessionStore.credentialConfirmed' },
                  then: { $invoke: 'profileStore.completeAccountSetup', args: [{ $: 'local.name' }] },
                },
              },
            ],
          },
          children: ['Create account'],
        },
      ],
    },
  ],
};

const failed: SchemaNode = {
  type: 'Column',
  props: { gap: '600' },
  children: [
    head(['Could not reach your data'], 'Coasys could not connect to the device that holds your account.'),
    {
      type: '$if',
      props: {
        condition: { $: 'sessionStore.bootError' },
        then: { type: 'we-code', props: { block: true }, children: [{ $: 'sessionStore.bootError' }] },
      },
    },
    {
      type: 'Row',
      children: [
        {
          type: 'we-button',
          props: { variant: 'solid', onClick: { $invoke: 'sessionStore.retryBoot' } },
          children: ['Try again'],
        },
      ],
    },
  ],
};

/**
 * The other accounts on this machine, and a way to add one.
 *
 * Only accounts somebody has set up are listed: one with no identity is not a destination, since
 * switching to it lands on the setup form. "New account" waits until the account on screen exists,
 * so it is never offered beside the form that is itself making one. Both restart the app, which
 * shows `switching` or `preparing` in the column until it is back.
 */
const otherAccounts: SchemaNode = {
  type: 'Column',
  props: { gap: '300', pt: '400', borderTop: '1px solid border' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'accountStore.error' },
        then: { type: 'we-alert', props: { tone: 'danger' }, children: [{ $: 'accountStore.error' }] },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'count(filter(accountStore.accounts, { active: false, hasAgent: true }))' },
        then: {
          type: 'we-text',
          props: { variant: 'label', color: 'text-muted' },
          children: ['Other accounts on this device'],
        },
      },
    },
    {
      type: '$each',
      props: { items: { $: 'filter(accountStore.accounts, { active: false, hasAgent: true })' }, as: 'account' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            ax: 'start',
            onClick: { $invoke: 'accountStore.switchAccount', args: [{ $: 'account.id' }] },
          },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                {
                  type: 'we-avatar',
                  props: {
                    image: { $: 'account.avatar' },
                    initials: { $: 'account.name' },
                    hash: { $: 'account.id' },
                    size: 'sm',
                  },
                },
                { type: 'we-text', props: { truncate: true }, children: [{ $: 'account.name' }] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'accountStore.activeAccount.hasAgent' },
        then: {
          type: 'Row',
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', onClick: { $invoke: 'accountStore.createAccount' } },
              children: [{ type: 'we-icon', props: { name: 'user-plus' } }, 'New account'],
            },
          ],
        },
      },
    },
  ],
};

/** One state of the column at a time, chosen by where boot has got to. */
const step = (condition: string, then: SchemaNode): SchemaNode => ({
  type: '$if',
  props: { condition: { $: condition }, enterTransition: { type: 'fade', duration: 200 }, then },
});

export const coasysBootScreen: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "sessionStore.bootState != 'ready'" },
    exitTransition: { type: 'fade', duration: 400, easing: 'ease-out' },
    then: {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        bg: 'page',
        position: 'absolute',
        zIndex: 9999,
        overflowY: 'auto',
      },
      children: [
        brandBar,
        {
          type: 'Column',
          props: { flex: '1 1 auto', ax: 'center', px: '500', pt: '800', pb: '1000', mdUpProps: { px: '800' } },
          children: [
            {
              type: 'Column',
              props: { width: '100%', maxWidth: '440px', gap: '600' },
              children: [
                // A switch or a new account restarts the app; until it is back, the column says
                // which, rather than a form the restart is about to take away.
                step('accountStore.switchingTo', waiting({ $: '`Switching to ${accountStore.switchingTo.name}…`' })),
                step('accountStore.creating && !accountStore.switchingTo', waiting('Preparing a new account…')),
                step(
                  "sessionStore.bootState == 'initialising' && !accountStore.switchingTo && !accountStore.creating",
                  waiting('Starting up…'),
                ),
                step(
                  "sessionStore.createAgentLoading || sessionStore.bootState == 'finishing'",
                  waiting('Setting up your account…'),
                ),
                step(
                  "sessionStore.bootState == 'login' && !accountStore.switchingTo && !accountStore.creating",
                  signIn,
                ),
                step(
                  "sessionStore.bootState == 'createAgent' && !sessionStore.createAgentLoading && !accountStore.switchingTo",
                  createAccount,
                ),
                step("sessionStore.bootState == 'error'", failed),
                // Outside the steps, so it stays put while the state above it changes.
                {
                  type: '$if',
                  props: {
                    condition: {
                      $: "sessionStore.bootState in ['login', 'createAgent', 'error'] && !sessionStore.createAgentLoading && !accountStore.switchingTo && !accountStore.creating && accountStore.canManageAccounts && accountStore.activeAccount && !accountStore.isFirstRun",
                    },
                    then: otherAccounts,
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
