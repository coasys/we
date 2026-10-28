import type { SchemaNode } from '@we/schema-shared';

import { lockup } from './lockup.ts';

/**
 * The Coasys sign-in screen: WE's, in Coasys's frame.
 *
 * WE's sign-in form and its other accounts are placed as parts (`host.signIn.form`,
 * `host.signIn.accounts`), so every step of signing in — and every new one, such as the passkeys and
 * device links the Coasys identity work will bring — arrives here as it arrives in WE's, with no copy
 * of the steps to keep up. What is Coasys's own is around them: the page Glow paints rather than WE's
 * coloured fields, the mark and name in the corner exactly where the rail draws them, and the word on
 * the form's button ("Unlock"), given as one of its inputs.
 *
 * The password is typed into the host's field inside the form and nowhere else — see
 * `docs/architecture/protected-pieces.md`.
 */
export const coasysBootScreen: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "sessionStore.signInStep != 'ready'" },
    exitTransition: { type: 'fade', duration: 400, easing: 'ease-out' },
    then: {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        ax: 'center',
        ay: 'center',
        bg: 'page',
        position: 'absolute',
        zIndex: 9999,
      },
      children: [
        /*
          The mark and name where the rail draws them, so signing in leaves them in place. Not while
          a first run's splash has the mark in the centre — the condition WE's own corner has.
        */
        {
          type: '$if',
          props: {
            condition: {
              $: "accountStore.activeAccount && !(accountStore.isFirstRun && sessionStore.signInStep == 'starting')",
            },
            then: {
              type: 'Column',
              props: { position: 'absolute', top: '0', left: '0' },
              children: [lockup({ alt: '', name: 'always' })],
            },
          },
        },
        {
          type: '$part',
          props: { id: 'host.signIn.form', inputs: { unlockLabel: 'Unlock' } },
        },
        // Anchored outside the part, as WE's is — see `signInAccounts` in the shell templates.
        {
          type: 'Column',
          props: { position: 'absolute', bottom: '300', left: '300', zIndex: 1 },
          children: [{ type: '$part', props: { id: 'host.signIn.accounts' } }],
        },
      ],
    },
  },
};
