import type { ExpressionToken, SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';

import { COLLAPSED } from './lockup.ts';

/**
 * The Coasys app before a session: the same cartridge, with no backend connected yet.
 *
 * Drawn by the base host (`BaseApp`) against `baseStore` alone, on every platform Coasys runs on —
 * the desktop, the phone, a browser — so there is one way in and no separate identity app anywhere.
 * What it asks, in the order `baseStore.stage` gives:
 *
 * - **starting / failed** — the desktop's own backend coming up, and why it did not, with "Try
 *   again". It used to be an error box and a quit.
 * - **password** — a computer with no keyring the app can use: the WE password protects the agent
 *   here instead, asked for in the host's own field and never held by this template. On a first start
 *   it is typed twice, which only catches a typo, and has a floor of 8 characters; a password an agent
 *   was already made with has none.
 * - **first-run** — this device speaks for nobody yet: "Make my identity here", "Link to my identity",
 *   "Use my 12 words", and "Start now", on a phone as on a computer: a phone makes an identity and
 *   keeps its master key, links to one, or brings one back from the 12 words. A door a host cannot
 *   open is drawn closed with its reason. Every door opens the host's own identity window — the only
 *   place the 12 words are ever shown or typed.
 * - **connect** — where this device gets its session: this computer, the servers added on it (listed,
 *   but not wired on the desktop yet: choosing one says so, coasys/we#428), the computer a phone's
 *   key signs in to, or the browser's connect screen. Coasys cloud and the hosting index have a place
 *   of their own, labelled as coming, with nothing listed until they exist.
 * - **offline** — the place chosen could not be reached, with "Try again" and the way back to the
 *   choice.
 *
 * Devices and Security open over any of these, read-only: changes to them are made in Settings once
 * a session runs, where the master key is asked for.
 */

const MARK = '28px';

/** Words a screen draws: written out, or read from the store. */
type Words = string | ExpressionToken;

/** The mark and name, where the rail draws them once a session runs. */
const header: SchemaNode = {
  type: 'Row',
  props: { width: '100%', ay: 'center', ax: 'space-between', gap: '300', minHeight: COLLAPSED },
  children: [
    {
      type: 'Row',
      props: { ay: 'center', gap: '300', pl: `calc((${COLLAPSED} - ${MARK}) / 2)` },
      children: [
        {
          type: 'we-image',
          props: { src: { $: 'baseStore.brand.mark' }, alt: '', width: MARK, height: MARK, flexShrink: 0 },
        },
        {
          type: 'we-text',
          props: { variant: 'body', fontWeight: 'semibold', letterSpacing: 'tight' },
          children: [{ $: 'baseStore.brand.name' }],
        },
      ],
    },
    // The identity's pages, once there is an identity to show.
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.identityKnown && baseStore.did != ''" },
        then: {
          type: 'Row',
          props: { gap: '200', pr: '400' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', onClick: { $invoke: 'baseStore.openPage', args: ['devices'] } },
              children: [{ type: 'we-icon', props: { name: 'devices', slot: 'start' } }, 'Devices'],
            },
            {
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', onClick: { $invoke: 'baseStore.openPage', args: ['security'] } },
              children: [{ type: 'we-icon', props: { name: 'shield-check', slot: 'start' } }, 'Security'],
            },
          ],
        },
      },
    },
  ],
};

/** A whole-window screen: the header, then its content in a column of reading width. */
function screen(id: string, content: SchemaNode[]): SchemaNode {
  return {
    id,
    type: 'Column',
    props: {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100dvh',
      bg: 'page',
      overflowY: 'auto',
      gap: '600',
      pb: '800',
    },
    children: [
      header,
      {
        type: 'Column',
        props: { width: '100%', maxWidth: '720px', mx: 'auto', px: '600', gap: '600' },
        children: content,
      },
    ],
  };
}

/** A screen of one sentence under a spinner, while something is under way. */
function waiting(id: string, words: Words): SchemaNode {
  return {
    id,
    type: 'Column',
    props: {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100dvh',
      bg: 'page',
      ax: 'center',
      ay: 'center',
      gap: '500',
    },
    children: [
      { type: 'we-image', props: { src: { $: 'baseStore.brand.mark' }, alt: '', width: '48px', height: '48px' } },
      { type: 'we-animated-icon', props: { name: 'spinner', size: 'lg' } },
      { type: 'we-text', props: { color: 'text-muted' }, children: [words] },
    ],
  };
}

const card = (children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
  children,
});

/** One row of a card that does something on a press: an icon, a title, a line under it. */
function row(options: {
  icon: SchemaProp;
  title: Words;
  detail?: Words;
  onClick: SchemaProp;
  /** An expression: while it holds, the row is drawn but cannot be pressed. */
  off?: string;
  /** What stands at the end of the row in place of the caret. */
  end?: SchemaNode;
}): SchemaNode {
  const text: SchemaNode[] = [{ type: 'we-text', children: [options.title] }];
  if (options.detail) {
    text.push({ type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [options.detail] });
  }
  return {
    type: 'we-button',
    props: {
      variant: 'bare',
      width: '100%',
      disabled: { $: options.off ? `baseStore.busy || ${options.off}` : 'baseStore.busy' },
      onClick: options.onClick,
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
          opacity: options.off ? { $: `${options.off} ? 0.55 : 1` } : 1,
          hoverProps: { bg: 'surface-hover' },
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
          options.end ?? { type: 'we-icon', props: { name: 'caret-right', color: 'text-faint' } },
        ],
      },
    ],
  };
}

/**
 * A door of the first run: open, or drawn closed with the reason this device gives. `detail` is what an
 * open door says; one that reads differently on a phone (the phone takes an offer, where a computer
 * shows its code; it keeps the master key itself) says so in `{ computer, phone }`.
 */
function door(
  name: 'make' | 'link' | 'words',
  icon: string,
  title: Words,
  detail: string | { computer: string; phone: string },
  action: string,
): SchemaNode {
  const open =
    typeof detail === 'string'
      ? `'${detail}'`
      : `(baseStore.hostKind == 'phone' ? '${detail.phone}' : '${detail.computer}')`;
  return row({
    icon,
    title,
    detail: { $: `baseStore.doors.${name}.open ? ${open} : baseStore.doors.${name}.note` },
    off: `!baseStore.doors.${name}.open`,
    onClick: { $invoke: `baseStore.${action}` },
  });
}

const failedAlert = (condition: string, words: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: condition },
    then: { type: 'we-alert', props: { tone: 'danger' }, children: [{ $: words }] },
  },
});

const firstRun = screen('base__first-run', [
  {
    type: 'Column',
    props: { gap: '200' },
    children: [
      {
        type: 'we-text',
        props: { variant: 'heading-xl', tag: 'h1' },
        children: ['Welcome to Coasys'],
      },
      {
        type: 'we-text',
        props: { color: 'text-muted' },
        children: [
          {
            $: '`Your identity is yours: no email, no account with anybody. Choose how this ${baseStore.deviceNoun} comes in.`',
          },
        ],
      },
    ],
  },
  card([
    door(
      'make',
      'sparkle',
      'Make my identity here',
      {
        computer: 'Your 12 words, no email needed. This computer keeps your master key',
        phone: 'Your 12 words, no email needed. This phone keeps your master key',
      },
      'makeIdentity',
    ),
    door(
      'link',
      'qr-code',
      'Link to my identity',
      {
        computer: 'From a device that keeps your master key: it scans this code',
        phone: 'From a device that keeps your master key: scan or paste the offer it makes for this phone',
      },
      'linkIdentity',
    ),
    door(
      'words',
      'key',
      'Use my 12 words',
      { computer: 'Bring your identity back to this computer', phone: 'Bring your identity back to this phone' },
      'useWords',
    ),
    row({
      icon: 'lightning',
      title: 'Start now',
      detail: {
        $: '`Use Coasys on this ${baseStore.deviceNoun} alone. Make or link your identity later, from Settings`',
      },
      onClick: { $invoke: 'baseStore.startNow' },
    }),
  ]),
  // A step that made the identity and could not publish it did change something: the master key
  // is kept here. Said whenever it is so, after the step and after a relaunch alike.
  {
    type: '$if',
    props: {
      condition: { $: "baseStore.unpublished != ''" },
      then: {
        type: 'we-alert',
        props: { tone: 'warning' },
        children: [
          {
            $: '`Your identity was made on this ${baseStore.deviceNoun} and its master key is kept here, but it is not published yet. Coasys publishes it again each time it starts. To finish it now, choose Make my identity here: it finishes the same identity, with no new words.`',
          },
        ],
      },
    },
  },
  // Nothing tells the base that a failed step changed nothing (with the executor down, custody
  // cannot say it kept the key either), so it says only that the step did not finish.
  failedAlert(
    "baseStore.lastOutcome == 'failed' && baseStore.unpublished == ''",
    "baseStore.error != '' ? baseStore.error : 'That did not finish; try again.'",
  ),
  failedAlert(
    "baseStore.lastOutcome == 'failed' && baseStore.unpublished != '' && baseStore.error != ''",
    'baseStore.error',
  ),
  failedAlert("baseStore.lastOutcome != 'failed' && baseStore.error != ''", 'baseStore.error'),
]);

const connectionRow: SchemaNode = {
  type: '$each',
  props: { items: { $: 'baseStore.connections' }, as: 'place' },
  children: [
    row({
      icon: { $: 'place.icon' },
      title: { $: 'place.label' },
      detail: { $: 'place.detail' },
      onClick: { $invoke: 'baseStore.choose', args: [{ $: 'place.id' }] },
      end: {
        type: '$if',
        props: {
          condition: { $: 'place.chosen' },
          then: { type: 'we-tag', props: { tone: 'neutral' }, children: ['Last used'] },
          else: { type: 'we-icon', props: { name: 'caret-right', color: 'text-faint' } },
        },
      },
    }),
  ],
};

const connect = screen('base__connect', [
  {
    type: 'Column',
    props: { gap: '200' },
    children: [
      // Read as the list grows: today this computer, later a server of your own or a host you trust.
      // No "you can change this later": a place once chosen is taken again at each start, and only an
      // unreachable one brings this choice back.
      { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: ['Where should Coasys run for you?'] },
      {
        type: 'we-text',
        props: { color: 'text-muted' },
        children: [
          {
            $: "baseStore.hostKind == 'phone' ? 'Coasys keeps your spaces on a computer you choose: one of your own, or a host you trust.' : 'Coasys keeps your spaces on a computer you choose: this one, or a host you trust.'",
          },
        ],
      },
    ],
  },
  card([connectionRow]),
  // Labelled, and empty: these arrive in a later release, and nothing stands in for them until then.
  {
    id: 'base__hosted',
    type: 'Column',
    props: { gap: '200', p: '400', r: 'surface', border: '1px dashed border' },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: 'we-icon', props: { name: 'cloud', color: 'text-muted' } },
          { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Coasys cloud and community hosts'] },
          { type: 'we-tag', props: { tone: 'neutral' }, children: ['Later release'] },
        ],
      },
      {
        type: 'we-text',
        props: { variant: 'footnote', color: 'text-muted' },
        children: ['Hosted Coasys, and an index of hosts communities run, will be listed here. None is offered yet.'],
      },
    ],
  },
  failedAlert("baseStore.error != ''", 'baseStore.error'),
  // A reason here is one a second try may clear: an identity that could not be read, a place that
  // refused. "Try again" reads the identity and the places again, as a relaunch would.
  {
    type: '$if',
    props: {
      condition: { $: "baseStore.error != ''" },
      then: {
        type: 'Row',
        children: [
          {
            type: 'we-button',
            props: { variant: 'secondary', loading: { $: 'baseStore.busy' }, onClick: { $invoke: 'baseStore.retry' } },
            children: ['Try again'],
          },
        ],
      },
    },
  },
]);

const offline = screen('chrome__offline', [
  {
    type: 'Column',
    props: { gap: '200' },
    children: [
      { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: ['You are offline'] },
      { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: 'baseStore.offlineReason' }] },
    ],
  },
  {
    type: 'Row',
    props: { gap: '300' },
    children: [
      {
        type: 'we-button',
        props: { variant: 'primary', loading: { $: 'baseStore.busy' }, onClick: { $invoke: 'baseStore.retry' } },
        children: ['Try again'],
      },
      {
        type: 'we-button',
        props: {
          variant: 'secondary',
          disabled: { $: 'baseStore.busy' },
          onClick: { $invoke: 'baseStore.showConnections' },
        },
        children: ['Choose another place'],
      },
    ],
  },
]);

const failed = screen('chrome__executor-failed', [
  {
    type: 'Column',
    props: { gap: '200' },
    children: [
      // Stopped after it ran (outside the app, from the tray) or failed to start: the same screen, in
      // the words for each.
      {
        type: 'we-text',
        props: { variant: 'heading-xl', tag: 'h1' },
        children: [{ $: "baseStore.executorStopped ? 'Coasys has stopped' : 'Coasys could not start'" }],
      },
      {
        type: 'we-text',
        props: { color: 'text-muted' },
        children: [
          {
            $: "baseStore.executorStopped ? 'The part of Coasys that keeps your spaces on this computer is not running, so nothing here can be opened until it starts again.' : 'The part of Coasys that keeps your spaces on this computer stopped before it was ready.'",
          },
        ],
      },
    ],
  },
  {
    type: 'we-alert',
    props: { tone: 'danger' },
    children: [{ $: "baseStore.executorReason != '' ? baseStore.executorReason : 'No reason was given.'" }],
  },
  {
    type: 'Row',
    children: [
      {
        type: 'we-button',
        props: { variant: 'primary', loading: { $: 'baseStore.busy' }, onClick: { $invoke: 'baseStore.retry' } },
        children: [{ $: "baseStore.executorStopped ? 'Start Coasys again' : 'Try again'" }],
      },
    ],
  },
]);

/*
  No keyring could be used, so the WE password protects this computer's agent: one field, the host's
  own (it holds the value; this template only learns whether something is typed), and Continue.
*/
const password = screen('base__password', [
  {
    type: 'Column',
    props: { gap: '200' },
    children: [
      {
        type: 'we-text',
        props: { variant: 'heading-xl', tag: 'h1' },
        children: [{ $: "baseStore.passwordIsNew ? 'Choose your WE password' : 'Enter your WE password'" }],
      },
      {
        type: 'we-text',
        props: { color: 'text-muted' },
        children: [
          'This computer’s keyring is not available, so your WE password protects your agent on this computer.',
        ],
      },
    ],
  },
  {
    type: 'CredentialField',
    props: {
      purpose: { $: "baseStore.passwordIsNew ? 'new' : 'unlock'" },
      // A new one's floor, as baseStore.passwordConfirmed holds it; one an agent was made with has none.
      minLength: 8,
      width: '100%',
      placeholder: 'Password...',
      confirmPlaceholder: 'Password again...',
      onEdit: { $invoke: 'baseStore.clearPasswordWrong' },
      onSubmit: { $invoke: 'baseStore.submitPassword' },
    },
  },
  failedAlert('baseStore.passwordWrong', "'That password did not unlock your agent. Try again.'"),
  failedAlert("baseStore.error != ''", 'baseStore.error'),
  {
    type: 'Row',
    children: [
      {
        type: 'we-button',
        props: {
          variant: 'primary',
          loading: { $: 'baseStore.busy' },
          disabled: {
            $: '!baseStore.passwordEntered || (baseStore.passwordIsNew && !baseStore.passwordConfirmed)',
          },
          onClick: { $invoke: 'baseStore.submitPassword' },
        },
        children: ['Continue'],
      },
    ],
  },
]);

/** A line of a read-only page: a label, and what it says. */
const fact = (label: string, value: Words): SchemaNode => ({
  type: 'Row',
  props: { gap: '400', px: '400', py: '300', borderBottom: '1px solid border', ay: 'center' },
  children: [
    { type: 'we-text', props: { color: 'text-muted', width: '160px', flexShrink: '0' }, children: [label] },
    { type: 'we-text', props: { flex: '1', minWidth: '0' }, children: [value] },
  ],
});

/** A page over the stage, with its way back. */
function page(name: 'devices' | 'security', title: string, content: SchemaNode[]): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `baseStore.page == '${name}'` },
      then: {
        id: `base__${name}`,
        type: 'Column',
        props: {
          position: 'fixed',
          top: '0',
          left: '0',
          width: '100vw',
          height: '100dvh',
          bg: 'page',
          overflowY: 'auto',
          zIndex: 'modal',
          gap: '600',
          pb: '800',
        },
        children: [
          {
            type: 'Row',
            props: { minHeight: COLLAPSED, ay: 'center', px: '400' },
            children: [
              {
                type: 'we-button',
                props: { variant: 'ghost', onClick: { $invoke: 'baseStore.closePage' } },
                children: [{ type: 'we-icon', props: { name: 'arrow-left', slot: 'start' } }, 'Back'],
              },
            ],
          },
          {
            type: 'Column',
            props: { width: '100%', maxWidth: '720px', mx: 'auto', px: '600', gap: '500' },
            children: [
              { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: [title] },
              ...content,
              {
                type: 'we-text',
                props: { variant: 'footnote', color: 'text-muted' },
                children: ['Change these in Settings once you are connected, where your master key is asked for.'],
              },
            ],
          },
        ],
      },
    },
  };
}

const devicesPage = page('devices', 'Devices', [
  card([
    {
      type: '$each',
      props: { items: { $: 'baseStore.devices' }, as: 'device' },
      children: [
        {
          type: 'Row',
          props: { gap: '400', px: '400', py: '400', ay: 'center', borderBottom: '1px solid border' },
          children: [
            { type: 'we-icon', props: { name: { $: 'device.icon' }, color: 'accent-text' } },
            {
              type: 'Column',
              props: { gap: '100', flex: '1', minWidth: '0' },
              children: [
                { type: 'we-text', children: [{ $: 'device.label' }] },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
                  children: [{ $: 'device.subtitle' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: "device.master != ''" },
                then: { type: 'we-tag', props: { tone: 'accent' }, children: [{ $: 'device.master' }] },
              },
            },
          ],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'baseStore.devices.length == 0' },
        then: {
          type: 'we-text',
          props: { color: 'text-muted', px: '400', py: '400' },
          children: ['No device is named yet. Name them in Settings → Devices once you are connected.'],
        },
      },
    },
  ]),
]);

const securityPage = page('security', 'Security', [
  card([
    // Whether there is one, never its identifier: that is for Settings' advanced places.
    fact('Your identity', { $: "baseStore.did != '' ? 'Set up' : 'None yet'" }),
    fact('Master key', { $: 'baseStore.keepsLine' }),
    {
      type: '$if',
      props: {
        condition: { $: "baseStore.blocked != ''" },
        then: fact('Changes', { $: 'baseStore.blocked' }),
      },
    },
  ]),
]);

/** Each stage's screen, drawn while it is the one due. */
const stage = (condition: string, then: SchemaNode): SchemaNode => ({
  type: '$if',
  props: { condition: { $: condition }, then },
});

export const coasysBase: TemplateSchema & { id: string } = {
  id: 'coasys-base',
  type: 'Column',
  meta: {
    name: 'Coasys before you sign in',
    description: 'Your identity, and where Coasys runs for you, before anything is connected.',
    icon: 'hexagon',
    role: 'base',
  },
  props: { styles: { display: 'contents' } },
  children: [
    stage("baseStore.stage == 'starting'", waiting('base__starting', 'Starting Coasys on this computer…')),
    stage("baseStore.stage == 'failed'", failed),
    stage("baseStore.stage == 'password'", password),
    stage(
      "baseStore.stage == 'loading' || baseStore.stage == 'handing-off'",
      waiting('base__connecting', {
        $: "baseStore.stage == 'loading' ? 'Reading your identity…' : 'Opening your spaces…'",
      }),
    ),
    stage("baseStore.stage == 'first-run'", firstRun),
    stage("baseStore.stage == 'connect'", connect),
    stage("baseStore.stage == 'offline'", offline),
    devicesPage,
    securityPage,
  ],
};
