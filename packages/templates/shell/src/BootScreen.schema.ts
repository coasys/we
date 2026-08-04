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
 * Shows the cached profile picture when there is one, falling back to initials. The cache exists
 * because this screen renders while the agent is *locked* — the real picture lives inside the
 * encrypted store and cannot be read until after the password. See `Account.avatar`.
 */
function accountBadge(name: SchemaNode | string | OperatorToken, size: 'lg' | 'md' = 'lg'): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '300', ax: 'center' },
    children: [
      {
        type: 'we-avatar',
        props: {
          image: { $store: 'accountStore.activeAccount.avatar' },
          initials: name as SchemaProp,
          size,
          bg: 'primary-100',
        },
      },
      { type: 'we-text', props: { variant: 'heading-sm', fontWeight: 'regular' }, children: [name] },
    ],
  };
}

/** A text button for the row of secondary actions under the unlock form. */
function linkButton(text: string, icon: string, onClick: SchemaProp): SchemaNode {
  return {
    type: 'we-button',
    props: { variant: 'ghost', size: 'sm', onClick },
    children: [
      { type: 'we-icon', props: { name: icon } },
      { type: 'we-text', props: { variant: 'label' }, children: [text] },
    ],
  };
}

/** The switch-account escape hatch. Renders nothing when there is nowhere else to go. */
const switchAccountLink: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'accountStore.hasOtherAccounts' },
    then: linkButton('Switch account', 'users', { $setLocal: 'mode', value: 'accounts' }),
  },
};

/**
 * Secondary actions under a form.
 *
 * `create` is false on the setup screen: offering "create new account" beside the form that *is*
 * creating one is incoherent, and on a genuine first run there are no accounts for the phrasing to
 * even make sense against. Switch stays there, because that is the escape hatch that matters — a
 * freshly created account boots into an empty directory and lands on setup, and without a way back
 * an accidental create traps you on a form for an account you did not want. It gates itself on
 * there being somewhere to go, so first run shows nothing at all.
 */
function accountActions({ create }: { create: boolean }): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $store: 'accountStore.canManageAccounts' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center', mt: '300' },
        children: [
          switchAccountLink,
          ...(create ? [linkButton('Create new account', 'user-plus', { $setLocal: 'mode', value: 'create' })] : []),
        ],
      },
    },
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
 * Confirming a new account. Not a form: the name and password are both collected afterwards, on
 * the setup screen, so that adding an account and a genuine first run reach the *same* single page
 * rather than splitting the same two questions across different places.
 *
 * A confirmation step at all only because the action relaunches the app, which is startling with
 * no warning — not because there is anything to fill in.
 */
const createAccountConfirm: SchemaNode = {
  type: 'Column',
  props: { gap: '400', ax: 'center', maxWidth: '340px' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'user-plus', color: 'primary-600' } },
        {
          type: 'we-text',
          props: { variant: 'heading-sm', fontWeight: 'regular' },
          children: ['Create a new account'],
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'body', color: 'neutral-600', textAlign: 'center' },
      children: ['WE will restart so you can set it up. Your current account stays as it is.'],
    },
    accountError,
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: {
            height: '36px',
            text: 'Cancel',
            variant: 'ghost',
            onClick: [{ $setLocal: 'mode', value: 'unlock' }, { $action: 'accountStore.clearError' }],
          },
        },
        {
          type: 'we-button',
          props: {
            height: '36px',
            text: 'Continue',
            color: 'neutral-0',
            bg: 'primary-500',
            loading: { $store: 'accountStore.busy' },
            onClick: { $action: 'accountStore.createAccount' },
          },
        },
      ],
    },
  ],
};

/** The account picker. Selecting one restarts the app into it. */
const accountPicker: SchemaNode = {
  type: 'Column',
  props: { gap: '400', ax: 'center', maxWidth: '340px', width: '100%' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm', fontWeight: 'regular' }, children: ['Choose an account'] },
    accountError,
    {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $store: 'accountStore.accounts' }, as: 'account' },
          children: [
            {
              type: 'we-button',
              props: {
                width: '100%',
                variant: { $if: { condition: '$account.active', then: 'secondary', else: 'ghost' } },
                disabled: { $store: 'accountStore.busy' },
                onClick: { $action: 'accountStore.switchAccount', args: ['$account.id'] },
              },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', width: '100%' },
                  children: [
                    {
                      type: 'we-avatar',
                      props: { image: '$account.avatar', initials: '$account.name', size: 'sm', bg: 'primary-100' },
                    },
                    { type: 'we-text', props: { variant: 'label' }, children: ['$account.name'] },
                    {
                      type: '$if',
                      props: {
                        condition: '$account.active',
                        then: {
                          type: 'we-badge',
                          props: { variant: 'primary', size: 'xs', ml: '200' },
                          children: ['Current'],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        linkButton('Back', 'arrow-left', { $setLocal: 'mode', value: 'unlock' }),
        linkButton('Create new account', 'user-plus', { $setLocal: 'mode', value: 'create' }),
      ],
    },
  ],
};

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
        then: accountBadge({ $store: 'accountStore.activeAccount.name' }),
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
        error: {
          $if: {
            condition: { $error: 'password' },
            then: { $error: 'password' },
            else: {
              $if: {
                condition: { $store: 'sessionStore.passwordError' },
                then: 'Incorrect password',
                else: '',
              },
            },
          },
        },
      },
      children: [
        {
          type: 'Row',
          props: { gap: '300' },
          children: [
            {
              type: 'we-input',
              props: {
                height: '36px',
                width: '200px',
                placeholder: 'Password...',
                value: { $local: 'password' },
                onInput: { $setLocal: 'password', from: '$event.detail' },
                onBlur: { $touch: 'password' },
                onKeyDown: {
                  $if: {
                    condition: { $eq: ['$arg.detail.key', 'Enter'] },
                    then: { $action: 'sessionStore.login', args: [{ $local: 'password' }] },
                  },
                },
                type: { $if: { condition: { $local: 'showPassword' }, then: 'text', else: 'password' } },
              },
            },
            {
              type: 'we-button',
              props: { bg: 'primary-500', height: '36px', onClick: { $toggleLocal: 'showPassword' } },
              children: [
                {
                  type: 'we-icon',
                  props: {
                    name: { $if: { condition: { $local: 'showPassword' }, then: 'eye', else: 'eye-slash' } },
                    color: 'neutral-0',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        height: '36px',
        text: 'Sign in',
        color: 'neutral-0',
        bg: 'primary-500',
        disabled: { $not: { $formValid: '$scope' } },
        loading: { $store: 'sessionStore.loginLoading' },
        onClick: [
          { $touch: '$all' },
          {
            $if: {
              condition: { $formValid: '$scope' },
              then: { $action: 'sessionStore.login', args: [{ $local: 'password' }] },
            },
          },
        ],
      },
    },
    accountActions({ create: true }),
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
          props: { src: '/we-text.svg', alt: 'WE Logo', width: '150px', height: '75px', gradient: 'primary' },
        },
        // Initialising state
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'initialising'] },
            then: {
              type: 'Row',
              props: { mt: '200', gap: '300', ay: 'center' },
              children: [
                { type: 'we-spinner', props: { size: 'sm' } },
                { type: 'we-text', children: ['Initialising AD4M client...'] },
              ],
            },
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
              props: { mt: '200', gap: '400', ax: 'center' },
              $localState: {
                password: {
                  type: 'string',
                  initial: '',
                  validate: [{ rule: 'required', message: 'Password is required' }],
                },
                showPassword: { type: 'boolean', initial: false },
                mode: { type: 'string', initial: 'unlock' },
              },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $eq: [{ $local: 'mode' }, 'accounts'] },
                    then: accountPicker,
                    // A block-level `$if` NODE, not a `{ $if: … }` prop token: the renderer hands
                    // `then`/`else` straight to renderNode, so a token here has no `type` and
                    // renders nothing at all.
                    else: {
                      type: '$if',
                      props: {
                        condition: { $eq: [{ $local: 'mode' }, 'create'] },
                        then: createAccountConfirm,
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
              props: { mt: '200', gap: '400', ax: 'center', maxWidth: '380px' },
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
                showPassword: { type: 'boolean', initial: false },
                showConfirm: { type: 'boolean', initial: false },
                mode: { type: 'string', initial: 'unlock' },
              },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $eq: [{ $local: 'mode' }, 'accounts'] },
                    then: accountPicker,
                    // Block-level `$if` NODE — see the note on the sign-in state above.
                    else: {
                      type: '$if',
                      props: {
                        condition: { $eq: [{ $local: 'mode' }, 'create'] },
                        then: createAccountConfirm,
                        else: {
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
                                      type: 'Row',
                                      props: { gap: '300' },
                                      children: [
                                        {
                                          type: 'we-input',
                                          props: {
                                            width: '100%',
                                            placeholder: 'Password...',
                                            value: { $local: 'password' },
                                            onInput: { $setLocal: 'password', from: '$event.detail' },
                                            onBlur: { $touch: 'password' },
                                            type: {
                                              $if: {
                                                condition: { $local: 'showPassword' },
                                                then: 'text',
                                                else: 'password',
                                              },
                                            },
                                          },
                                        },
                                        {
                                          type: 'we-button',
                                          props: {
                                            bg: 'primary-500',
                                            onClick: { $toggleLocal: 'showPassword' },
                                          },
                                          children: [
                                            {
                                              type: 'we-icon',
                                              props: {
                                                name: {
                                                  $if: {
                                                    condition: { $local: 'showPassword' },
                                                    then: 'eye',
                                                    else: 'eye-slash',
                                                  },
                                                },
                                                color: 'neutral-0',
                                              },
                                            },
                                          ],
                                        },
                                      ],
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
                                      type: 'Row',
                                      props: { gap: '300' },
                                      children: [
                                        {
                                          type: 'we-input',
                                          props: {
                                            width: '100%',
                                            placeholder: 'Confirm password...',
                                            value: { $local: 'confirm' },
                                            onInput: { $setLocal: 'confirm', from: '$event.detail' },
                                            onBlur: { $touch: 'confirm' },
                                            type: {
                                              $if: {
                                                condition: { $local: 'showConfirm' },
                                                then: 'text',
                                                else: 'password',
                                              },
                                            },
                                          },
                                        },
                                        // Its own state, not the one above. A control sitting
                                        // inside this field that silently revealed the field above
                                        // it would be lying about its scope — and revealing only
                                        // the field you are actively fixing exposes less.
                                        {
                                          type: 'we-button',
                                          props: {
                                            bg: 'primary-500',
                                            onClick: { $toggleLocal: 'showConfirm' },
                                          },
                                          children: [
                                            {
                                              type: 'we-icon',
                                              props: {
                                                name: {
                                                  $if: {
                                                    condition: { $local: 'showConfirm' },
                                                    then: 'eye',
                                                    else: 'eye-slash',
                                                  },
                                                },
                                                color: 'neutral-0',
                                              },
                                            },
                                          ],
                                        },
                                      ],
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
                                mt: '200',
                                text: 'Create account',
                                color: 'neutral-0',
                                bg: 'primary-500',
                                disabled: { $not: { $formValid: '$scope' } },
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
                            accountActions({ create: false }),
                          ],
                        },
                      },
                    },
                  },
                },
              ],
            },
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
              props: { mt: '200', gap: '300', ay: 'center' },
              children: [
                { type: 'we-spinner', props: { size: 'sm' } },
                { type: 'we-text', children: ['Setting up your account...'] },
              ],
            },
          },
        },
      ],
    },
  },
};
