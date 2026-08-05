import type { OperatorToken, SchemaNode, SchemaProp } from '@we/schema-shared';

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
 */

/**
 * The signed-in-as chip, the way an OS sign-in screen leads.
 *
 * Takes a store *path* rather than a name, so the picture and the name always come from the same
 * account. They were bound separately before — the name from the argument, the picture hardcoded to
 * `activeAccount` — so switching showed the target's name above the previous account's face until
 * the reload caught up.
 *
 * Shows the cached picture when there is one, falling back to initials. The cache exists because
 * this screen renders while the agent is *locked*: the real picture lives inside the encrypted
 * store and cannot be read until after the password.
 */
function accountBadge(account: string): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '300', ax: 'center' },
    children: [
      {
        type: 'we-avatar',
        props: {
          image: { $store: `${account}.avatar` },
          initials: { $store: `${account}.name` },
          size: '100px',
          bg: 'primary-100',
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
 * `allowCreate` is false on the setup screen — offering "new account" beside the form that is
 * itself creating one is incoherent. Switching away stays, because a freshly created account boots
 * into an empty directory and lands on setup; without a way back an accidental create traps you
 * there.
 *
 * Rendered at the root, so it is anchored to the window rather than to whatever the centre column
 * happens to contain.
 */
function accountSwitcher({ allowCreate }: { allowCreate: boolean }): SchemaNode {
  const tile = (label: string | SchemaNode | OperatorToken, avatar: SchemaNode, onClick: SchemaProp): SchemaNode => ({
    type: 'we-button',
    // Not disabled while a switch is in flight. It faded out and came back at full opacity in the
    // next document, which is its own flicker — and clicking another account mid-switch is a
    // reasonable thing to want, which the store handles by simply switching again.
    props: { variant: 'bare', ax: 'start', p: '300', hoverProps: { bg: 'neutral-100' }, onClick },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [avatar, { type: 'we-text', props: { fontSize: '300', truncate: true }, children: [label] }],
      },
    ],
  });

  return {
    type: '$if',
    props: {
      condition: { $store: 'accountStore.canManageAccounts' },
      then: {
        type: 'Column',
        props: { position: 'absolute', bottom: '400', left: '400', gap: '300', maxWidth: '240px', zIndex: 1 },
        children: [
          // Failures from switching or creating surface here, beside the controls that cause them
          // — there is nowhere else on this screen that account errors belong.
          accountError,
          {
            type: '$each',
            props: {
              // Everyone but the account already signed in to — that one is the badge in the centre.
              items: { $filter: { items: { $store: 'accountStore.accounts' }, where: { active: false } } },
              as: 'account',
            },
            children: [
              tile(
                '$account.name',
                {
                  type: 'we-avatar',
                  props: { image: '$account.avatar', initials: '$account.name', size: 'lg', bg: 'primary-200' },
                },
                { $action: 'accountStore.switchAccount', args: ['$account.id'] },
              ),
            ],
          },
          ...(allowCreate
            ? [
                // Straight through, no confirmation. The step it replaced restated the button it
                // was reached from and asked again, and the action is undone in one click from
                // this same corner.
                tile(
                  'New account',
                  { type: 'we-avatar', props: { icon: 'plus', size: 'lg', bg: 'neutral-100' } },
                  { $action: 'accountStore.createAccount' },
                ),
              ]
            : []),
        ],
      },
    },
  };
}

/**
 * The waiting state: an account badge with a spinner where its password field will be.
 *
 * Used for *both* halves of a switch, deliberately identical. Switching kills the executor,
 * respawns it and reloads the window, so the renderer is destroyed halfway through and the new one
 * has no memory of having been asked to switch. Rather than persisting that across the reload,
 * both sides render this — so the reload becomes invisible instead of a second loading step with
 * different words and a badge popping in.
 *
 * "Loading account", not "Signing in": no password has been entered on either path, and not
 * "Starting", which sounds like it is talking about the app rather than the thing being waited on.
 * The badge above already says *which* account, so this only has to explain the wait.
 */
function startingState(account: string): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '400', ax: 'center' },
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
          { type: 'we-text', props: { color: 'neutral-600' }, children: ['Loading account...'] },
        ],
      },
    ],
  };
}

/** The unlock form: the account you are signing in to, and the password for it. */
const unlockForm: SchemaNode = {
  type: 'Column',
  props: { gap: '400', ax: 'center' },
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
            { type: 'we-icon', props: { name: 'key', color: 'primary-600' } },
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
        // One message, because there is only one thing that can be wrong. A password cannot be
        // judged locally — it is right or wrong only once the executor has tried it — so this
        // field carries no validation rules and the slot holds the executor's answer alone.
        // It deliberately says nothing about an empty field: the greyed-out button beside a
        // visibly empty input already explains itself, and an error there would be scolding
        // someone for a field they simply have not typed into yet.
        error: {
          $if: {
            condition: { $store: 'sessionStore.passwordError' },
            then: 'Incorrect password',
            else: '',
          },
        },
      },
      children: [
        // Field and submit on one row — the shape an OS sign-in uses when there is exactly one
        // thing to type and one thing to do with it. The setup screen keeps a full-width button
        // instead, because its submit applies to three fields rather than the one beside it.
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
                    condition: { $and: [{ $eq: ['$arg.detail.key', 'Enter'] }, { $local: 'password' }] },
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
                disabled: { $not: { $local: 'password' } },
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

export const bootScreen: SchemaNode = {
  type: '$if',
  props: {
    condition: { $ne: [{ $store: 'sessionStore.bootState' }, 'ready'] },
    exitTransition: { type: 'fade', duration: 500, easing: 'ease-out' },
    then: {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        ax: 'center',
        ay: 'center',
        gap: '400',
        bg: 'neutral-0',
        position: 'absolute',
        zIndex: 9999,
      },
      children: [
        // WE Logo
        {
          type: 'we-image',
          props: {
            src: '/we-text.svg',
            alt: 'WE Logo',
            width: '150px',
            height: '75px',
            gradient: 'primary',
            mb: '600',
          },
        },
        {
          type: 'Column',
          props: { width: '100%', ax: 'center', ay: 'start' },
          children: [
            // Initialising state
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'initialising'] },
                then: startingState('accountStore.activeAccount'),
              },
            },
            // Sign-in state — unlock, switch account, or create one. The three are modes of one
            // screen rather than separate boot states because they share the same question ("who is
            // using this app") and only one of them involves the session at all.
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'login'] },
                then: {
                  type: 'Column',
                  props: { gap: '400', ax: 'center' },
                  // No validation rules: signing in is not a form to be checked, it is a lock to
                  // be tried. The setup screen below does declare rules, because a name and a
                  // confirmation field genuinely can be judged before anything is submitted.
                  $localState: {
                    password: { type: 'string', initial: '' },
                  },
                  children: [
                    // Switching runs entirely before the reload — kill the executor, respawn it
                    // against the other directory, wait for GraphQL — several seconds during which the
                    // old form would otherwise sit there looking merely unresponsive. Rendering the
                    // *target's* badge here, with the same node the post-reload state uses, makes the
                    // whole switch one continuous screen: the identity swaps on the click and nothing
                    // moves again until the password field arrives.
                    {
                      type: '$if',
                      props: {
                        condition: { $store: 'accountStore.switchingTo' },
                        // The active flag moves on the click, so both sides of the restart read the same
                        // accessor and the badge does not change identity when the document does.
                        then: startingState('accountStore.activeAccount'),
                        else: {
                          type: '$if',
                          props: {
                            condition: { $store: 'accountStore.creating' },
                            then: {
                              type: 'Row',
                              props: { gap: '300', ay: 'center' },
                              children: [
                                { type: 'we-spinner', props: { size: 'sm' } },
                                { type: 'we-text', props: { color: 'neutral-600' }, children: ['Creating account...'] },
                              ],
                            },
                            else: unlockForm,
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
            // Setup state — this account has no identity yet. Reached on a genuine first run and on
            // the first boot into a newly created account, and it looks the same either way: name,
            // then password. The name is committed by renaming the account (seeded as "Main" on first
            // run, provisional on a created one), which is why it chains through accountStore.
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'createAgent'] },
                then: {
                  type: 'Column',
                  props: { gap: '400', ax: 'center', maxWidth: '380px' },
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
                      props: { gap: '400', ax: 'center' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300', ay: 'center' },
                          children: [
                            { type: 'we-icon', props: { name: 'user-plus', color: 'primary-600' } },
                            {
                              type: 'we-text',
                              props: { variant: 'heading-sm', fontWeight: 'regular' },
                              children: ['Create account'],
                            },
                          ],
                        },
                        // Form
                        {
                          type: 'Column',
                          props: { gap: '400' },
                          children: [
                            // Picture — optional, and held until an agent exists to upload to.
                            {
                              type: 'EditableImage',
                              props: {
                                src: { $store: 'profileStore.pendingAvatar' },
                                alt: 'Profile picture',
                                aspect: 1,
                                placeholderIcon: 'user',
                                width: '96px',
                                height: '96px',
                                onImageChange: { $action: 'profileStore.setPendingAvatar', args: ['$arg'] },
                              },
                            },
                            // The profile's name, not a separate local label. One DID, one
                            // identity, one thing to type.
                            {
                              type: 'we-form-field',
                              props: { label: 'Your name', error: { $error: 'name' } },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    placeholder: 'Name...',
                                    value: { $local: 'name' },
                                    onInput: { $setLocal: 'name', from: '$event.detail' },
                                    onBlur: { $touch: 'name' },
                                  },
                                },
                              ],
                            },
                            // Password + confirm
                            {
                              type: 'we-form-field',
                              props: { label: 'Password', error: { $error: 'password' } },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    width: '100%',
                                    type: 'password',
                                    revealable: true,
                                    placeholder: 'Password...',
                                    value: { $local: 'password' },
                                    onInput: { $setLocal: 'password', from: '$event.detail' },
                                    onBlur: { $touch: 'password' },
                                  },
                                },
                              ],
                            },
                            {
                              type: 'we-form-field',
                              props: {
                                label: 'Confirm password',
                                error: {
                                  $if: {
                                    condition: { $error: 'confirm' },
                                    then: { $error: 'confirm' },
                                    else: { $store: 'sessionStore.createAgentError' },
                                  },
                                },
                              },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    width: '100%',
                                    type: 'password',
                                    // Each field's toggle is its own — the primitive keeps the
                                    // reveal state per instance, so revealing one does not
                                    // reveal the other.
                                    revealable: true,
                                    placeholder: 'Confirm password...',
                                    value: { $local: 'confirm' },
                                    onInput: { $setLocal: 'confirm', from: '$event.detail' },
                                    onBlur: { $touch: 'confirm' },
                                  },
                                },
                              ],
                            },
                            // The one thing that is not obvious: there is no reset. Every other app
                            // has taught the user that a forgotten password is recoverable by email.
                            {
                              type: 'we-text',
                              props: { variant: 'footnote', color: 'neutral-500', textAlign: 'center' },
                              children: ["If you lose this password, the account can't be recovered."],
                            },
                          ],
                        },
                        {
                          type: 'we-button',
                          props: {
                            text: 'Create account',
                            color: 'neutral-0',
                            bg: 'primary-500',
                            // A hard gate, paired with the per-field onBlur touches above: this
                            // form is filled in sequence and its rules are worth answering as
                            // each field is left, so the errors are already reachable without a
                            // submit-time $touch. A { $touch: '$all' } here would be dead — the
                            // button cannot be clicked in the state that would reveal anything.
                            disabled: { $not: { $formValid: '$scope' } },
                            loading: { $store: 'sessionStore.createAgentLoading' },
                            // One action rather than a chain: the ordering is load-bearing
                            // (the profile cannot be published until the agent exists) and the
                            // failure handling differs per step. See completeAccountSetup.
                            onClick: {
                              $action: 'profileStore.completeAccountSetup',
                              args: [{ $local: 'name' }, { $local: 'password' }],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            // The other accounts, anchored to the window rather than to the centre column. Shown on
            // the two states where a user might want a different account: signing in, and setting
            // one up. Not while loading or finishing, where the outcome is already decided.
            //
            // Create is offered on sign-in only — beside a setup form it would offer to start
            // over on the thing being started.
            {
              type: '$if',
              props: {
                // Including `initialising` is the whole point of rendering this at the root.
                // Gated on `login` alone it was absent for the first phase of every boot — so on
                // a switch it vanished and returned even though its data was there the whole
                // time, which read as the data being late rather than the node being unmounted.
                condition: { $in: [{ $store: 'sessionStore.bootState' }, ['initialising', 'login']] },
                then: accountSwitcher({ allowCreate: true }),
              },
            },
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'createAgent'] },
                then: accountSwitcher({ allowCreate: false }),
              },
            },
            // Finishing state — non-interactive. The agent exists and the session is loaded; the name
            // and picture collected on the setup screen are being published. Everything was asked for
            // already, so this is a progress indicator rather than a step.
            {
              type: '$if',
              props: {
                condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'finishing'] },
                then: {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-spinner', props: { size: 'sm' } },
                    { type: 'we-text', children: ['Setting up your account...'] },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  },
};
