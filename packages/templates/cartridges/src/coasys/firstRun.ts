import type { OperatorToken, SchemaNode, SchemaProp } from '@we/schema-shared';

/**
 * The first run on a computer that keeps master keys: "Welcome to Coasys".
 *
 * Whole window, over the rail and the space, while `identityStore.needsFirstRun`: the desktop
 * shell keeps master keys, this computer's key speaks for nobody, and "Start now" was not chosen
 * here. It offers the two ways in that work on one computer:
 *
 * - **Make my identity here** opens the identity window, which shows the 12 words, asks for two of
 *   them back and keeps master #0 on this computer. The question goes away by itself once the
 *   identity exists, because `needsFirstRun` reads the key log again when the window closes.
 * - **Start now** uses the app with no identity, remembered on this computer; Settings → Security
 *   offers "Make my identity here" again.
 *
 * On a build that cannot make an identity yet (`identityStore.changeBlocked`: no identity store is
 * set up), the first door is drawn disabled with that reason in place of its detail, and "Start now"
 * is the way in.
 *
 * The three other doors — log in with a Coasys account, link to an identity from another app,
 * restore from the 12 words — need flows that later changes add, and are drawn as "Coming soon"
 * rather than left out, so the screen keeps its order when they arrive.
 */

/** One row of the doors card. */
function door(options: {
  icon: string;
  title: string;
  detail?: OperatorToken | string;
  onClick?: SchemaProp;
  soon?: boolean;
  busy?: boolean;
  /** An expression: while it holds, the door is drawn but cannot be opened, and its detail says why. */
  off?: string;
}): SchemaNode {
  const off = options.off;
  const text: SchemaNode[] = [{ type: 'we-text', children: [options.title] }];
  if (options.detail) {
    text.push({ type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [options.detail] });
  }
  return {
    type: 'we-button',
    props: {
      variant: 'bare',
      width: '100%',
      disabled: options.soon
        ? true
        : off
          ? { $: `identityStore.busy || ${off}` }
          : options.busy
            ? { $: 'identityStore.busy' }
            : false,
      ...(options.onClick ? { onClick: options.onClick } : {}),
    },
    children: [
      {
        type: 'Row',
        props: {
          width: '100%',
          gap: '400',
          ay: 'center',
          px: '400',
          py: '400',
          borderBottom: '1px solid border',
          opacity: options.soon ? 0.55 : off ? { $: `${off} ? 0.55 : 1` } : 1,
          hoverProps: options.soon ? {} : { bg: 'surface-hover' },
        },
        children: [
          {
            type: 'Row',
            props: {
              width: '44px',
              height: '44px',
              r: 'full',
              bg: 'surface-sunken',
              ax: 'center',
              ay: 'center',
              flexShrink: '0',
            },
            children: [{ type: 'we-icon', props: { name: options.icon, color: 'accent-text' } }],
          },
          { type: 'Column', props: { gap: '100', flex: '1', minWidth: '0', textAlign: 'left' }, children: text },
          options.soon
            ? { type: 'we-tag', props: { tone: 'neutral' }, children: ['Coming soon'] }
            : { type: 'we-icon', props: { name: 'caret-right', color: 'text-faint' } },
        ],
      },
    ],
  };
}

/**
 * What the person's master key will rest behind on this computer, as the custody service says; or,
 * on a build that cannot make an identity yet, why.
 */
const keepsLine: OperatorToken = {
  $: "identityStore.changeBlocked ? identityStore.changeBlocked : identityStore.custody.unlock == 'touch-id-or-password' ? 'Your 12 words, no email needed. This computer keeps your master key behind Touch ID' : 'Your 12 words, no email needed. This computer keeps your master key behind your passphrase'",
};

export const coasysFirstRun: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'identityStore.needsFirstRun' },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100dvh',
        zIndex: 'modal',
        bg: 'page',
        overflowY: 'auto',
        p: '600',
        gap: '800',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            {
              type: 'we-image',
              props: { src: { $: 'templateStore.brand.mark' }, alt: 'Coasys', width: '28px', height: '28px' },
            },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Coasys'] },
            { type: 'we-text', props: { color: 'text-muted' }, children: ['Identity'] },
          ],
        },
        {
          type: 'Column',
          props: { width: '100%', maxWidth: '720px', mx: 'auto', gap: '600' },
          children: [
            { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: ['Welcome to Coasys'] },
            {
              type: 'Column',
              props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
              children: [
                door({
                  icon: 'sparkle',
                  title: 'Make my identity here',
                  detail: keepsLine,
                  busy: true,
                  off: "identityStore.changeBlocked != ''",
                  onClick: { $invoke: 'identityStore.makeIdentity' },
                }),
                door({
                  icon: 'lightning',
                  title: 'Start now',
                  detail: 'Use Coasys on this computer alone. Make your identity later, to share spaces',
                  busy: true,
                  onClick: { $invoke: 'identityStore.startWithoutIdentity' },
                }),
                door({
                  icon: 'envelope-simple',
                  title: 'Log in with your Coasys account',
                  detail: 'Email and password',
                  soon: true,
                }),
                door({
                  icon: 'qr-code',
                  title: 'Link to my identity',
                  detail: 'From an app that holds your master key',
                  soon: true,
                }),
                door({ icon: 'key', title: 'Use my 12 words', soon: true }),
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: "identityStore.lastOutcome == 'failed'" },
                then: {
                  type: 'we-alert',
                  props: { tone: 'danger' },
                  children: ['Your identity was not made. Nothing was published; try again.'],
                },
              },
            },
          ],
        },
      ],
    },
  },
};
