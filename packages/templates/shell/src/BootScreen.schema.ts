import type { OperatorToken, SchemaNode, SchemaProp } from '@we/schema-shared';
import { field } from '@we/template-kit';

/**
 * A scale step, rotated off the primary hue.
 *
 * Reads the *palette* step and changes only the hue, which is what the pre-OKLCH version did:
 * `hsl(primary-hue ± 25, saturation, lightness-N)` names the same saturation and lightness the step
 * itself is built from, so the sweep was always the step, turned. Restating it as literal numbers
 * lost that — the chroma got a damping factor (0.15 and 0.31) chosen by eye to imitate the old
 * appearance, and it undershot by a lot: step 200 rotated came out `rgb(70,51,81)`, a grey mauve,
 * where the original is `rgb(78,36,107)`. Hence a sign-in screen that read as washed-out grey rather
 * than deep purple.
 *
 * Reading `from` the palette variable also inherits the ramp, the chroma taper and the per-hue
 * normalisation, so a theme that moves its polarity, range or saturation moves this with it — none
 * of which a hand-built `oklch()` tracks.
 *
 * The fields are made soft by `bgImageOpacity` at the call site, not by weakening the colour. That
 * is the difference between a pale colour and a strong one at low opacity, and only the second one
 * still looks like the theme.
 */
const sweep = (step: '100' | '200', hueOffset: string) =>
  `oklch(from var(--we-color-primary-${step}) l c calc(h ${hueOffset}))`;

/**
 * The boot screen: the four states a session can be in before the app is usable.
 *
 * Modelled on an OS sign-in screen, because that is the thing it actually is — pick an account,
 * prove it, or make a new one. `initialising` and `login` are the common paths; `createAgent` and
 * `finishing` are the first run through a given account.
 *
 * Copy says "account" throughout, never "agent". Internally the two differ (an account is the
 * directory, the agent is the DID inside it), but making a user hold that distinction means they
 * create an account and are then asked to set up its agent — two words for one act. "Agent" is
 * kept for AD4M protocol objects that genuinely are not accounts, like a peer in the trusted list.
 *
 * Account controls are gated on `accountStore.canManageAccounts`, which is false on web: a browser
 * tab has no directories to keep accounts in, and ad4m-connect already owns which executor it
 * talks to. The unlock form is identical either way, so web loses the switcher and nothing else.
 *
 * Two rules govern most of what follows, and both have been rediscovered the hard way more than
 * once:
 *
 * 1. Anything that should survive a change of boot state must be rendered *above* the boot-state
 *    branches. They are sibling `$if`s, so a node inside one is torn down and rebuilt at every
 *    boundary — which reads as a flicker even when the content either side is identical.
 *
 * 2. Ask the account, not the host. `accountStore.activeAccount` is seeded from a session cache on
 *    the first frame, so anything keyed on it draws immediately after a reload or a switch.
 *    `accountsLoaded` waits for IPC and belongs only to `isFirstRun`, where a stale cache must
 *    never be allowed to trigger a welcome.
 */

/**
 * The boot background: the logo's own hue sweep, centred and made pale.
 *
 * The same `primary-hue ± 25` sweep as `--we-gradient-primary` (the mark, the gradient buttons),
 * turned radial — so the screen and the logo are lit by one idea rather than two.
 *
 * Lightness is what differs, and must: at 500 the sweep is a saturated mid-tone, right for a 38px
 * mark and unreadable behind a form. Built from the scale step rather than from literal numbers, so
 * a theme that moves its primary hue, polarity or saturation moves this with it.
 *
 * `circle` rather than the default ellipse, so it does not stretch with the window's aspect.
 */
export const hueSweepBackground = [
  'radial-gradient(circle at 50% 50%,',
  // Neutral at both ends, colour in between — so the sweep is a ring rather than a wash. The
  // content sits in the clear core, and the hue travels through a band that never passes under it.
  'var(--we-color-neutral-0) 0%,',
  // The sweep is squeezed into the middle of the radius rather than spanning it. Two stops can
  // travel the hue or land on a colour, not both; four buy a clean start and a clean finish.
  `${sweep('100', '+ 25')} 40%,`,
  `${sweep('100', '- 25')} 60%,`,
  // Named rather than `transparent`. Identical here, since `bg` beneath is the same token — but it
  // says what it means and does not depend on what happens to be painted under it.
  'var(--we-color-neutral-0) 80%)',
].join(' ');

/**
 * One large soft field. `at` is the knob — the rest rarely needs touching.
 *
 * Falls off to `transparent`, not `neutral-0`: these overlap, and an opaque neutral edge would
 * paint white over whatever is beneath, turning soft overlaps into hard crescents.
 */
const blob = (at: string, size: string, hueOffset: string) =>
  [`radial-gradient(${size} at ${at},`, `${sweep('200', hueOffset)} 0%,`, 'transparent 70%)'].join(' ');

/**
 * The alternative to `hueSweepBackground`: a few large fields placed by hand rather than one
 * concentric sweep.
 *
 * Larger than they look like they need to be: a field smaller than the frame reads as a spot with
 * its own edge, and the gaps between spots become the shape you see. Each takes a different point
 * in the logo's hue range, so moving one relocates a colour rather than introducing one.
 */
export const blobBackground = [
  blob('24% 26%', '65% 60%', '+ 25'),
  blob('80% 34%', '60% 55%', '- 25'),
  blob('52% 88%', '70% 60%', '+ 0'),
].join(', ');

/**
 * The signed-in-as chip, the way an OS sign-in screen leads.
 *
 * Takes a store *path* rather than a name, so the picture and the name always come from the same
 * account — bound separately, a switch showed the target's name above the previous account's face.
 *
 * Falls back to initials. The cached picture exists because this screen renders while the agent is
 * *locked*: the real one lives inside the encrypted store.
 */
function accountBadge(account: string): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '400', ax: 'center' },
    children: [
      {
        type: 'we-avatar',
        props: {
          image: { $store: `${account}.avatar` },
          initials: { $store: `${account}.name` },
          size: '120px',
          bg: 'accent-muted',
        },
      },
      {
        type: 'we-text',
        props: { variant: 'heading-sm', fontWeight: 'regular', minHeight: '28px' },
        children: [{ $store: `${account}.name` }],
      },
    ],
  };
}

/** Shared error line for account operations — one slot, wherever the failure happened. */
const accountError: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'accountStore.error' },
    then: {
      type: 'we-alert',
      props: { variant: 'danger', maxWidth: '320px' },
      children: [{ $store: 'accountStore.error' }],
    },
  },
};

/**
 * The WE mark in the top-left corner.
 *
 * Deliberately the same geometry as the sidebar's header slot (`Sidebar.schema.ts`) — an 80x80 box
 * holding the mark at 38px — because the sidebar is fixed at the origin with no padding of its own,
 * so both put the wordmark in the same place. The boot screen leaves by cross-fading, and matching
 * position means the logo holds still through it. Keep the two in step if either moves.
 *
 * Inert by choice: the About page is reachable from inside the app, and a mark that acts on one
 * screen and not the next reads as broken rather than as restraint.
 */
const logoCorner: SchemaNode = {
  type: '$if',
  props: {
    // Hidden only while the splash is up, which puts the mark in the centre — two copies is one too
    // many. `activeAccount` is also absent on a genuine first run, before anything is cached, which
    // is exactly when the splash wants the centre to itself.
    condition: {
      $: "accountStore.activeAccount && !(accountStore.isFirstRun && sessionStore.bootState == 'initialising')",
    },
    then: {
      type: 'Column',
      props: { position: 'absolute', top: '0', left: '0', width: '80px', height: '80px', ax: 'center', ay: 'center' },
      children: [
        {
          type: 'we-image',
          props: { src: '/we-text.svg', alt: 'WE', width: '38px', height: '38px', gradient: 'primary' },
        },
      ],
    },
  },
};

/**
 * The whole screen on a first run, while the executor starts.
 *
 * Nothing but the mark, a word and a spinner: there is no account to name and nowhere else to go,
 * so any other chrome would be answering a question nobody asked. The mark takes the centre because
 * this is the one moment the app has nothing else to say, and returns to its corner with the form.
 */
const firstRunSplash: SchemaNode = {
  type: 'Column',
  props: { gap: '600', ax: 'center' },
  children: [
    {
      type: 'we-image',
      props: { src: '/we-text.svg', alt: 'WE', width: '150px', height: '75px', gradient: 'primary' },
    },
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', height: '40px' },
      children: [
        { type: 'we-spinner', props: { size: 'sm' } },
        { type: 'we-text', props: { fontSize: '400', color: 'text-muted' }, children: ['Loading...'] },
      ],
    },
  ],
};

/**
 * The other accounts, pinned to the bottom-left corner.
 *
 * The Windows shape: the account being signed in to owns the centre of the screen and the others
 * sit in a corner, small and quiet, so the primary action is uncontested. macOS and ChromeOS give
 * every account equal weight in a centred row instead — which discards the hierarchy this screen
 * already has, and looks sparse with only one other account.
 *
 * Rows rather than columns: a name reads faster beside its picture than under it, and a stack of
 * rows in a corner grows downward without pushing anything else around.
 *
 * The create tile is hidden while the active account is still being set up — offering "new account"
 * beside the form that is itself creating one is incoherent. Switching away stays available, because
 * a freshly created account boots into an empty directory and lands on setup; without a way back an
 * accidental create traps you there.
 *
 * Deliberately carries no positioning of its own, and no gate of its own: the caller anchors it to
 * the corner and decides whether it is shown. Both belong outside because the caller fades it, and
 * a transitioning `$if` renders its content inside a wrapper div — so anything this node did about
 * position would be done relative to that wrapper rather than to the window. See `switcherCorner`.
 */
function accountSwitcher(): SchemaNode {
  const tile = (label: string | SchemaNode | OperatorToken, avatar: SchemaNode, onClick: SchemaProp): SchemaNode => ({
    type: 'we-button',
    // Deliberately not disabled mid-switch: the fade out and back is its own flicker, and switching
    // again is a reasonable thing to want. The store handles it.
    props: { variant: 'bare', ax: 'start', p: '300', hoverProps: { bg: 'surface-hover' }, onClick },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [avatar, { type: 'we-text', props: { fontSize: '300', truncate: true }, children: [label] }],
      },
    ],
  });

  return {
    type: 'Column',
    children: [
      // Failures from switching or creating surface here, beside the controls that cause them
      // — there is nowhere else on this screen that account errors belong.
      accountError,
      {
        type: '$each',
        props: {
          // Everyone but the account signed in to — that one is the badge in the centre — and
          // only accounts somebody has set up. One with no identity is not a destination:
          // switching to it lands straight back on the setup form.
          items: { $: 'filter(accountStore.accounts, { active: false, hasAgent: true })' },
          as: 'account',
        },
        children: [
          tile(
            '$account.name',
            {
              type: 'we-avatar',
              props: { image: '$account.avatar', initials: '$account.name', size: 'lg', bg: 'accent-muted' },
            },
            { $action: 'accountStore.switchAccount', args: ['$account.id'] },
          ),
        ],
      },
      {
        type: '$if',
        props: {
          // Not while the active account is still being set up: it would offer the action
          // already under way. Reading the account rather than the boot state means it appears
          // the moment a switch is chosen, before the restart.
          condition: { $store: 'accountStore.activeAccount.hasAgent' },
          // Straight through, no confirmation. The step it replaced restated the button it was
          // reached from and asked again, and the action is undone in one click from this same
          // corner.
          then: tile(
            'New account',
            { type: 'we-avatar', props: { icon: 'plus', size: 'lg', bg: 'surface-sunken' } },
            { $action: 'accountStore.createAccount' },
          ),
        },
      },
    ],
  };
}

/**
 * The heading a first run opens with, in place of an account badge.
 *
 * The line of orientation is about *where the account lives* rather than what to do next — the
 * question a local-first app raises and a cloud one does not, and what makes someone comfortable
 * typing a password into something they met ten seconds ago. The form below says the rest: a name,
 * a picture and a password *is* what an account is here.
 */
const welcomeHeading: SchemaNode = {
  type: 'Column',
  props: { gap: '300', ax: 'center', maxWidth: '420px' },
  children: [
    { type: 'we-text', props: { variant: 'heading-lg', color: 'accent-text' }, children: ['Welcome'] },
    {
      type: 'we-text',
      props: { fontSize: '500', color: 'text-muted', textAlign: 'center' },
      children: ['Create an account to get started.'],
    },
    {
      type: 'we-text',
      props: { color: 'text-muted', textAlign: 'center' },
      children: [
        'All your data lives on this device. Only content added to shared spaces is synced with their members.',
      ],
    },
  ],
};

/**
 * The neutral wait, before the host has said which kind of machine this is.
 *
 * Deliberately wordless: until the host answers, the screen cannot tell a first run from a
 * returning user, and every label it could show is a guess. Only reached with nothing cached.
 */
const neutralWait: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', height: '40px' },
  children: [{ type: 'we-spinner', props: { size: 'sm' } }],
};

/**
 * The wait while room is being made for a new account, on either side of the restart.
 *
 * "Preparing", not "Creating": nothing about an identity exists yet. What is happening is an empty
 * directory being scaffolded and the data layer being restarted against it — the account itself is
 * created by the form this leads to, which is why claiming otherwise here read as the app having
 * already done the thing it then asked you for.
 *
 * Deliberately nameless: a new account holds no identity, so its name is the host's placeholder and
 * it has no picture — a badge there is a placeholder dressed as a person. The same words on both
 * sides of the restart mean it is not a change of subject.
 */
const creatingAccountState: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center' },
  children: [
    { type: 'we-spinner', props: { size: 'sm' } },
    { type: 'we-text', props: { color: 'text-muted' }, children: ['Preparing new account...'] },
  ],
};

function startingState(account: string): SchemaNode {
  return {
    type: '$if',
    props: {
      // Rule 2 at the top of this file: the cache answers this on the first frame, and it carries
      // the switch target already marked active.
      condition: { $store: 'accountStore.activeAccount.hasAgent' },
      then: knownAccountState(account),
      else: {
        type: '$if',
        props: {
          condition: { $store: 'accountStore.isFirstRun' },
          // Fades in around the wordless spinner rather than replacing it. This only animates
          // because the condition is false at mount: `ConditionalRenderer` captures `startVisible`
          // at creation and skips the transition entirely when it is already true.
          enterTransition: { type: 'fade', duration: 300 },
          then: firstRunSplash,
          else: {
            type: '$if',
            props: {
              // An account we know about that holds no identity: being created, mid-restart.
              condition: { $store: 'accountStore.activeAccount' },
              then: creatingAccountState,
              // Nothing known at all — a first-ever launch, or storage cleared. Wordless, because
              // every label here would be a guess, which is what once flashed a deleted account's
              // name on a wiped machine.
              else: neutralWait,
            },
          },
        },
      },
    },
  };
}

/**
 * The returning-user wait: whose account this is, and that it is being opened.
 *
 * "Loading account", not "Signing in" — no password has been entered on either path — and not
 * "Starting", which sounds like it means the app. The badge says which account; this says why the
 * wait. Rendered on both sides of a switch, which is what makes the reload invisible.
 */
function knownAccountState(account: string): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '600', ax: 'center' },
    children: [
      // Gated on `canManageAccounts` — known synchronously from the platform adapter — rather than
      // on the account itself, which arrives over IPC a few frames later. Gating on the account
      // meant the badge was absent on the first frames after a reload and then appeared, resizing
      // everything under it. Here the slot exists from the start and only its contents fill in.
      {
        type: '$if',
        props: {
          condition: { $store: 'accountStore.canManageAccounts' },
          then: accountBadge(account),
        },
      },
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', height: '40px' },
        children: [
          { type: 'we-spinner', props: { size: 'sm' } },
          { type: 'we-text', props: { color: 'text-muted' }, children: ['Loading account...'] },
        ],
      },
    ],
  };
}

/** The unlock form: the account you are signing in to, and the password for it. */
const unlockForm: SchemaNode = {
  type: 'Column',
  props: { gap: '600', ax: 'center' },
  children: [
    // The account chip when the host knows about accounts; the generic heading otherwise, so web
    // is not left with an unexplained lock icon.
    {
      type: '$if',
      props: {
        condition: { $store: 'accountStore.activeAccount' },
        then: accountBadge('accountStore.activeAccount'),
        else: {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'key', color: 'accent-text' } },
            {
              type: 'we-text',
              props: { variant: 'heading-sm', fontWeight: 'regular' },
              children: ['Sign in'],
            },
          ],
        },
      },
    },
    {
      type: 'we-form-field',
      props: {
        error: { $: "sessionStore.passwordError ? 'Incorrect password' : ''" },
      },
      children: [
        // Field and submit on one row — the shape an OS sign-in uses when there is exactly one
        // thing to type and one thing to do with it. Deliberately NOT the `field` fragment: the
        // fragment renders a lone control, and collapsing this row to one lost the Login button,
        // the Enter handler and the error wiring — nothing could call sessionStore.login at all.
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'we-input',
              props: {
                width: '220px',
                type: 'password',
                // The reveal toggle is the input's own, not a button assembled beside it.
                revealable: true,
                placeholder: 'Password...',
                value: { $local: 'password' },
                // Editing the password retracts the verdict on it. "Incorrect password" is about
                // the string that was submitted, so it has nothing to say about the one being
                // typed to replace it — left up, it reads as a running judgement of the new one.
                onInput: [
                  { $setLocal: 'password', from: '$event.detail' },
                  { $action: 'sessionStore.clearPasswordError' },
                ],
                // Enter carries the same precondition as the button, or an empty field would
                // reach the executor, fail to unlock, and come back as "Incorrect password" —
                // the wrong diagnosis for a password that was never typed.
                onKeyDown: {
                  $if: {
                    condition: { $: "arg.detail.key == 'Enter' && local.password" },
                    then: { $action: 'sessionStore.login', args: [{ $local: 'password' }] },
                  },
                },
              },
            },
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                // Gated on the value, not on a validation rule. There is nothing to submit until
                // something is typed, which is a precondition rather than a judgement — and the
                // OS sign-in screens this follows all hold the button until there is.
                disabled: { $: '!local.password' },
                loading: { $store: 'sessionStore.loginLoading' },
                onClick: { $action: 'sessionStore.login', args: [{ $local: 'password' }] },
              },
              children: ['Login'],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * From clicking "Create account" until the app appears.
 *
 * One state, though it spans two phases: `createAgent` generates the keys, then the name and
 * picture are published. That seam is where the agent starts existing, which is meaningful to the
 * code and meaningless to whoever clicked.
 *
 * The condition covers the span without a gap — `createAgentLoading` goes false in a `finally`, by
 * which point `bootState` is already `finishing`. On failure both go false with the state back on
 * `createAgent`, so the form returns carrying its error. Hoisted per rule 1.
 */
const settingUpState: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "sessionStore.createAgentLoading || sessionStore.bootState == 'finishing'" },
    then: {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-spinner', props: { size: 'sm' } },
        { type: 'we-text', children: ['Setting up your account...'] },
      ],
    },
  },
};

/**
 * A switch in progress, whichever screen it was started from.
 *
 * Switching runs entirely before the reload — kill the executor, respawn it against the other
 * directory, wait for GraphQL — several seconds during which the screen would otherwise look
 * unresponsive.
 *
 * Hoisted per rule 1, and for a second reason: a switch is not a boot state. It can begin from
 * sign-in or from setup and should look identical either way. `startingState` reads the active
 * account, which moved to the target on the click, so the badge is the one being switched *to*.
 */
const switchingState: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'accountStore.switchingTo' },
    then: startingState('accountStore.activeAccount'),
  },
};

/**
 * The one boot outcome with nothing behind it.
 *
 * Every other state is a form or a wait; `error` had neither, so a backend that could not be
 * reached — a web session whose connection failed, an executor that did not come up — left the
 * background painted and nothing on it, with no way forward but closing the app. The message is
 * shown verbatim rather than translated: it comes from the layer that actually failed, and a
 * friendlier sentence in front of it would only describe the guess.
 */
const bootFailure: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "sessionStore.bootState == 'error'" },
    then: {
      type: 'Column',
      props: { gap: '400', ax: 'center', maxWidth: '420px' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'warning', color: 'danger-text' } },
            {
              type: 'we-text',
              props: { variant: 'heading-sm', fontWeight: 'regular' },
              children: ['Could not reach your data'],
            },
          ],
        },
        {
          type: 'we-text',
          props: { color: 'text-muted', textAlign: 'center' },
          children: ['WE could not connect to the data layer that holds your account.'],
        },
        {
          type: '$if',
          props: {
            condition: { $store: 'sessionStore.bootError' },
            then: {
              type: 'we-code',
              props: { block: true },
              children: [{ $store: 'sessionStore.bootError' }],
            },
          },
        },
        {
          type: 'we-button',
          props: { text: 'Try again', variant: 'primary', onClick: { $action: 'sessionStore.retryBoot' } },
        },
      ],
    },
  },
};

export const bootScreen: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "sessionStore.bootState != 'ready'" },
    exitTransition: { type: 'fade', duration: 500, easing: 'ease-out' },
    then: {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        ax: 'center',
        ay: 'center',
        gap: '400',
        // Colour beneath, fields above: `bg` emits the `background` shorthand but is assigned
        // before `background-image`, so the two compose. Swap `blobBackground` for
        // `hueSweepBackground` for the concentric version.
        bg: 'surface-sunken',
        bgImage: blobBackground,
        // Not `opacity`, which would take the heading and the form down with the background.
        bgImageOpacity: 0.3,
        position: 'absolute',
        zIndex: 9999,
      },
      children: [
        // Cornered rather than centred, so the middle of the screen is whoever is signing in.
        logoCorner,
        {
          type: 'Column',
          // The gap only bites on a first run, where the welcome and the form are both present:
          // every other state renders one branch, and a `$if` rendering nothing is not a flex item.
          props: { width: '100%', ax: 'center', ay: 'start', gap: '800' },
          children: [
            switchingState,
            settingUpState,
            // Hoisted per rule 1: it must survive `initialising` becoming `createAgent`, so the
            // form materialises underneath it rather than replacing it with a second copy.
            {
              type: '$if',
              props: {
                condition: {
                  $: "accountStore.isFirstRun && sessionStore.bootState == 'createAgent' && !sessionStore.createAgentLoading && !accountStore.switchingTo",
                },
                // Matched to the form's own fade below, so the heading and the fields it belongs to
                // arrive as one thing rather than in sequence.
                enterTransition: { type: 'fade', duration: 300 },
                // Arriving fades; leaving does not. An omitted exit mirrors the enter, which keeps
                // this mounted for 300ms after the state that justified it has gone — and the states
                // that replace it (`switchingState`, `settingUpState`) carry no transition, so they
                // paint immediately, above this one, while it fades. See the form below.
                exitTransition: { type: 'fade', duration: 0 },
                then: welcomeHeading,
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: "sessionStore.bootState == 'initialising'" },
                then: startingState('accountStore.activeAccount'),
              },
            },
            // Sign-in: unlock, switch, or create. Modes of one screen rather than separate boot
            // states, because they answer one question and only unlocking touches the session.
            {
              type: '$if',
              props: {
                condition: { $: "sessionStore.bootState == 'login' && !accountStore.switchingTo" },
                then: {
                  type: 'Column',
                  props: { gap: '400', ax: 'center' },
                  // No validation rules: signing in is a lock to try, not a form to check. The
                  // setup screen below has them, because a name and a confirmation can be judged.
                  $localState: {
                    password: { type: 'string', initial: '' },
                  },
                  children: [
                    {
                      type: '$if',
                      props: {
                        condition: { $store: 'accountStore.creating' },
                        then: creatingAccountState,
                        else: unlockForm,
                      },
                    },
                  ],
                },
              },
            },
            // Setup — this account has no identity yet. Reached on a first run and on the first
            // boot into a created account, and identical either way: name, then password. The name
            // commits by renaming the account, which is why it chains through accountStore.
            {
              type: '$if',
              props: {
                condition: {
                  $: "sessionStore.bootState == 'createAgent' && !sessionStore.createAgentLoading && !accountStore.switchingTo",
                },
                enterTransition: { type: 'fade', duration: 300 },
                /*
                  Leaving is instant, arriving fades.

                  Both ways out of this form hand over to a node that paints immediately —
                  `switchingState` when another account is clicked, `settingUpState` when this one
                  is submitted. An omitted `exitTransition` mirrors the enter, so the form stayed
                  mounted and fading for 300ms after either, and both are siblings *above* it in
                  this column: the account you just clicked appeared over the form you had just
                  left, for long enough to read as a glitch rather than a transition.

                  Fading out only works against something that is also fading in. Where the
                  replacement is instant, so is the departure.
                */
                exitTransition: { type: 'fade', duration: 0 },
                then: {
                  type: 'Column',
                  props: { gap: '700', ax: 'center', width: '100%', maxWidth: '300px' },
                  $localState: {
                    name: {
                      type: 'string',
                      // Blank, not seeded from the account: this is the name people will see, so
                      // offering "Main" or "New account" as a starting point invites accepting a
                      // placeholder as an identity.
                      initial: '',
                      validate: [{ rule: 'required', message: 'A name is required' }],
                    },
                    password: {
                      type: 'string',
                      initial: '',
                      // Deliberately only "required": no length or composition rules. Adding them
                      // later is easy; having them now blocks testing with throwaway passwords.
                      validate: [{ rule: 'required', message: 'Password is required' }],
                    },
                    confirm: {
                      type: 'string',
                      initial: '',
                      validate: [
                        { rule: 'required', message: 'Please confirm your password' },
                        { rule: 'match', field: 'password', message: 'Passwords do not match' },
                      ],
                    },
                    // One per field rather than one shared: each eye reveals only the input it sits in.
                  },
                  children: [
                    {
                      type: 'Column',
                      props: { gap: '700', ax: 'center', width: '100%' },
                      children: [
                        // Absent on a first run: the welcome hoisted above the boot-state branches
                        // is already the heading for this form, and it says the same thing without
                        // being torn down and rebuilt when the state changes underneath it. What is
                        // left here is the case it is actually for — adding an account to a machine
                        // that already has one, where "New account" answers a real question rather
                        // than "new compared to what?".
                        {
                          type: '$if',
                          props: {
                            condition: { $: '!accountStore.isFirstRun' },
                            then: {
                              type: 'Row',
                              props: { gap: '300', ay: 'center' },
                              children: [
                                { type: 'we-icon', props: { name: 'user-plus', color: 'accent-text' } },
                                {
                                  type: 'we-text',
                                  props: { variant: 'heading-md', fontWeight: 'regular' },
                                  children: ['New account'],
                                },
                              ],
                            },
                          },
                        },
                        // Form
                        {
                          type: 'Column',
                          props: { gap: '400', width: '100%' },
                          children: [
                            // Picture — optional, and held until an agent exists to upload to.
                            {
                              type: 'EditableImage',
                              props: {
                                src: { $store: 'profileStore.pendingAvatar' },
                                alt: 'Profile picture',
                                aspect: 1,
                                placeholderIcon: 'user',
                                uploadLabel: 'Add image',
                                editLabel: 'Change image',
                                fontSize: '200',
                                width: '120px',
                                height: '120px',
                                r: 'avatar',
                                alignSelf: 'center',
                                // mb: '100',
                                onImageChange: { $action: 'profileStore.setPendingAvatar', args: ['$arg'] },
                              },
                            },
                            // The profile's name, not a separate local label. One DID, one
                            // identity, one thing to type.
                            field({ name: 'name', label: 'Name', placeholder: 'Name...', validated: true }),
                            // Password + confirm.
                            //
                            // `type: 'password'` is not decoration here: `field` passes no type, so
                            // `we-input` defaulted to `text` and both of these rendered the password
                            // in the clear while it was typed — on the one screen where it is typed
                            // twice. `revealable` is the input's own toggle, matching the unlock
                            // form; on a field you cannot see, being able to check what you typed is
                            // worth more than on one you are only re-entering.
                            field({
                              name: 'password',
                              label: 'Password',
                              placeholder: 'Password...',
                              validated: true,
                              props: { type: 'password', revealable: true },
                            }),
                            field({
                              name: 'confirm',
                              label: 'Confirm password',
                              placeholder: 'Confirm password...',
                              validated: true,
                              props: { type: 'password', revealable: true },
                            }),
                          ],
                        },
                        {
                          type: 'we-button',
                          props: {
                            text: 'Create account',
                            mt: '300',
                            // Clickable whatever the fields say: the click is what asks the
                            // question, so it touches every field and the errors arrive together.
                            // Disabled only while the request is in flight.
                            loading: { $store: 'sessionStore.createAgentLoading' },
                            // One action rather than a chain: the ordering is load-bearing
                            // (the profile cannot be published until the agent exists) and the
                            // failure handling differs per step. See completeAccountSetup.
                            onClick: [
                              { $touch: '$all' },
                              {
                                $if: {
                                  condition: { $formValid: '$scope' },
                                  then: {
                                    $action: 'profileStore.completeAccountSetup',
                                    args: [{ $local: 'name' }, { $local: 'password' }],
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            bootFailure,
            // The other accounts, anchored to the window rather than to the centre column. Shown on
            // the states where a user might want a different account: signing in, and setting one
            // up. Not while loading or finishing, where the outcome is already decided.
            //
            // Create is offered on sign-in only — beside a setup form it would offer to start
            // over on the thing being started.
            //
            // The corner is this node, and the fade is the `$if` inside it. That split is what
            // keeps both correct. A transitioning `$if` renders its content inside a wrapper div,
            // and that wrapper copies `position` from the content but not the offsets that go with
            // it — so anchoring inside the transition put the list a screen-height below the
            // window, and not anchoring at all left the wrapper in the centre column's flow, where
            // a zero-height flex item still contributes the column's 48px `gap` and the whole
            // screen re-centred the moment the fade ended. Anchored here, out of flow, neither
            // applies: the wrapper only ever lays out inside a box that is already in the corner.
            {
              type: 'Column',
              props: { position: 'absolute', bottom: '300', left: '300', zIndex: 1 },
              children: [
                {
                  type: '$if',
                  props: {
                    // One node across all three states rather than one per state, so that moving
                    // between them is not an unmount and a remount of the same list — and so the
                    // exit below describes the list leaving rather than a boot state changing.
                    //
                    // Including `initialising` is the whole point of rendering this at the root.
                    // Gated on `login` alone it was absent for the first phase of every boot — so
                    // on a switch it vanished and returned even though its data was there the whole
                    // time, which read as the data being late rather than the node being unmounted.
                    //
                    // `createAgentLoading` closes it the moment the setup form is submitted, not
                    // one state later: that flag turns on while the state is still `createAgent`
                    // and only then becomes `finishing`, so gating on the state alone kept the list
                    // up through the first half of "Setting up your account..." and dropped it
                    // mid-message — two disappearances for one act. It is also a live escape hatch,
                    // and switching accounts restarts the app: leaving it clickable while the agent
                    // is being created and the profile published is offering to abandon a half-made
                    // identity.
                    condition: {
                      $: "sessionStore.bootState in ['initialising', 'login', 'createAgent', 'error'] && !sessionStore.createAgentLoading && accountStore.canManageAccounts && accountStore.activeAccount && !accountStore.isFirstRun",
                    },
                    // Faded out rather than cut, because this leaves at the same moment the form it
                    // sits beside does, and the form is replaced by a spinner rather than removed —
                    // one thing dissolving beside another arriving reads as a single change. No
                    // enter transition: on a switch it is meant to already be there, and fading it
                    // in would reintroduce the "data arriving late" impression the gate avoids.
                    exitTransition: { type: 'fade', duration: 300 },
                    then: accountSwitcher(),
                  },
                },
              ],
            },
            // Finishing state — non-interactive. The agent exists and the session is loaded; the name
            // and picture collected on the setup screen are being published. Everything was asked for
            // already, so this is a progress indicator rather than a step.
          ],
        },
      ],
    },
  },
};
