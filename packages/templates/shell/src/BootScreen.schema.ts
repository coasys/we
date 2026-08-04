import type { OperatorToken, SchemaNode, SchemaProp } from '@we/schema-shared';

/**
 * The boot screen: the four states a session can be in before the app is usable.
 *
 * Modelled on an OS sign-in screen, because that is the thing it actually is — pick an account,
 * prove it, or make a new one. `initialising` and `login` are the common paths; `createAgent` and
 * `onboarding` are the first run through a given account.
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

/** The signed-in-as chip: an initial and a name, the way an OS sign-in screen leads. */
function accountBadge(name: SchemaNode | string | OperatorToken, size: 'lg' | 'md' = 'lg'): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '300', ax: 'center' },
    children: [
      { type: 'we-avatar', props: { initials: name as SchemaProp, size, bg: 'primary-100' } },
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

/**
 * Switch-account and create-account, shown wherever a user could otherwise be stranded.
 *
 * That includes the setup screen. A freshly created account boots into an empty directory and
 * lands there — without a way back, creating an account by mistake traps you on a setup form for
 * an account you did not want, with the one you were using a restart away and no route to it.
 */
function accountActions(showSwitch: boolean): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $store: 'accountStore.canManageAccounts' },
      then: {
        type: 'Row',
        props: { gap: '200', ay: 'center', mt: '300' },
        children: [
          ...(showSwitch
            ? [
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'accountStore.hasOtherAccounts' },
                    then: linkButton('Switch account', 'users', { $setLocal: 'mode', value: 'accounts' }),
                  },
                } as SchemaNode,
              ]
            : []),
          linkButton('Create new account', 'user-plus', { $setLocal: 'mode', value: 'create' }),
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
                    { type: 'we-avatar', props: { initials: '$account.name', size: 'sm', bg: 'primary-100' } },
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
    accountActions(true),
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
                accountName: {
                  type: 'string',
                  // Seeded from the account being set up, so first run offers "Main" and a created
                  // account offers its provisional name — both editable, neither blank.
                  initial: { $store: 'accountStore.activeAccount.name' },
                  validate: [{ rule: 'required', message: 'An account name is required' }],
                },
                password: {
                  type: 'string',
                  initial: '',
                  validate: [
                    { rule: 'required', message: 'Password is required' },
                    { rule: 'minLength', value: 10, message: 'Use at least 10 characters' },
                  ],
                },
                confirm: {
                  type: 'string',
                  initial: '',
                  validate: [
                    { rule: 'required', message: 'Please confirm your password' },
                    { rule: 'match', field: 'password', message: 'Passwords do not match' },
                  ],
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
                                  children: ['Set up your account'],
                                },
                              ],
                            },
                            // Name
                            {
                              type: 'we-form-field',
                              props: { label: 'Account name', error: { $error: 'accountName' } },
                              children: [
                                {
                                  type: 'we-input',
                                  props: {
                                    height: '36px',
                                    width: '300px',
                                    value: { $local: 'accountName' },
                                    onInput: { $setLocal: 'accountName', from: '$event.detail' },
                                    onBlur: { $touch: 'accountName' },
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
                                        height: '36px',
                                        width: '256px',
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
                                        height: '36px',
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
                                    height: '36px',
                                    width: '300px',
                                    placeholder: 'Confirm password...',
                                    value: { $local: 'confirm' },
                                    onInput: { $setLocal: 'confirm', from: '$event.detail' },
                                    onBlur: { $touch: 'confirm' },
                                    type: {
                                      $if: {
                                        condition: { $local: 'showPassword' },
                                        then: 'text',
                                        else: 'password',
                                      },
                                    },
                                  },
                                },
                              ],
                            },
                            // The one thing that is not obvious: there is no reset. Every other app
                            // has taught the user that a forgotten password is recoverable by email.
                            {
                              type: 'we-text',
                              props: { variant: 'footnote', color: 'neutral-500', textAlign: 'center' },
                              children: ["At least 10 characters. If you lose it, this account can't be recovered."],
                            },
                            {
                              type: 'we-button',
                              props: {
                                mt: '200',
                                height: '36px',
                                text: 'Create account',
                                color: 'neutral-0',
                                bg: 'primary-500',
                                disabled: { $not: { $formValid: '$scope' } },
                                loading: { $store: 'sessionStore.createAgentLoading' },
                                // Name first, identity second: renameActive resolves without doing
                                // anything where there are no accounts to rename (web), so the
                                // chain needs no platform branch.
                                onClick: [
                                  { $touch: '$all' },
                                  {
                                    $if: {
                                      condition: { $formValid: '$scope' },
                                      then: {
                                        $action: 'accountStore.renameActive',
                                        args: [{ $local: 'accountName' }],
                                        onSuccess: [
                                          {
                                            $action: 'sessionStore.createAgent',
                                            args: [{ $local: 'password' }],
                                          },
                                        ],
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                            accountActions(true),
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
        // Onboarding state — the agent exists and the session is loaded; this is the last screen
        // before the app. Every field is optional: a profile is worth asking for once, at the only
        // moment the user is definitely looking, but never worth blocking on.
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'onboarding'] },
            then: {
              type: 'Column',
              props: { mt: '200', gap: '400', ax: 'center', maxWidth: '380px' },
              $localState: {
                handle: { type: 'string', initial: '' },
                firstName: { type: 'string', initial: '' },
                lastName: { type: 'string', initial: '' },
              },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-icon', props: { name: 'user', color: 'primary-600' } },
                    {
                      type: 'we-text',
                      props: { variant: 'heading-sm', fontWeight: 'regular' },
                      children: ['Introduce yourself'],
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'body', color: 'neutral-600', textAlign: 'center' },
                  children: [
                    'This is how you appear to other people in shared spaces. You can change it, or fill it in later, from your profile.',
                  ],
                },
                {
                  type: 'we-form-field',
                  props: { label: 'Handle' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        height: '36px',
                        width: '300px',
                        placeholder: 'handle',
                        value: { $local: 'handle' },
                        onInput: { $setLocal: 'handle', from: '$event.detail' },
                      },
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { gap: '300' },
                  children: [
                    {
                      type: 'we-form-field',
                      props: { label: 'First name' },
                      children: [
                        {
                          type: 'we-input',
                          props: {
                            height: '36px',
                            width: '144px',
                            value: { $local: 'firstName' },
                            onInput: { $setLocal: 'firstName', from: '$event.detail' },
                          },
                        },
                      ],
                    },
                    {
                      type: 'we-form-field',
                      props: { label: 'Last name' },
                      children: [
                        {
                          type: 'we-input',
                          props: {
                            height: '36px',
                            width: '144px',
                            value: { $local: 'lastName' },
                            onInput: { $setLocal: 'lastName', from: '$event.detail' },
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { mt: '200', gap: '300', ay: 'center' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        height: '36px',
                        text: 'Skip for now',
                        variant: 'ghost',
                        onClick: { $action: 'sessionStore.finishOnboarding' },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        height: '36px',
                        text: 'Continue',
                        color: 'neutral-0',
                        bg: 'primary-500',
                        // finishOnboarding runs on success rather than alongside: a publish that
                        // fails should leave the user on this screen, able to try again, instead
                        // of dropping them into the app with a profile that silently never saved.
                        onClick: {
                          $action: 'profileStore.updateOwnProfile',
                          args: [
                            {
                              handle: { $local: 'handle' },
                              firstName: { $local: 'firstName' },
                              lastName: { $local: 'lastName' },
                            },
                          ],
                          onSuccess: [{ $action: 'sessionStore.finishOnboarding' }],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  },
};
