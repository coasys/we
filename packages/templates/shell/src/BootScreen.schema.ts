import type { SchemaNode } from '@we/schema-shared';

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
        // { type: 'WeCube', props: { width: '300px', height: '300px' } },
        // Initialising state
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'initialising'] },
            // condition: true,
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
        // Create-agent state — first run. Keys are generated on the device, so the passphrase is
        // the only thing standing between the user and an unrecoverable account: the copy says so
        // plainly and the confirm field is not optional.
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'createAgent'] },
            then: {
              type: 'Column',
              props: { mt: '200', gap: '400', ax: 'center', maxWidth: '380px' },
              $localState: {
                passphrase: {
                  type: 'string',
                  initial: '',
                  validate: [
                    { rule: 'required', message: 'Passphrase is required' },
                    { rule: 'minLength', value: 10, message: 'Use at least 10 characters' },
                  ],
                },
                confirm: {
                  type: 'string',
                  initial: '',
                  validate: [
                    { rule: 'required', message: 'Please confirm your passphrase' },
                    { rule: 'match', field: 'passphrase', message: 'Passphrases do not match' },
                  ],
                },
                showPassphrase: { type: 'boolean', initial: false },
              },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-icon', props: { name: 'user-plus', color: 'primary-600' } },
                    {
                      type: 'we-text',
                      props: { variant: 'heading-sm', fontWeight: 'regular' },
                      children: ['Create your agent'],
                    },
                  ],
                },
                {
                  type: 'we-text',
                  props: { variant: 'body', color: 'neutral-600', textAlign: 'center' },
                  children: [
                    'Your keys are generated here, on this device. Choose a passphrase to encrypt them — it cannot be recovered or reset, so store it somewhere safe.',
                  ],
                },
                // Passphrase + confirm
                {
                  type: 'we-form-field',
                  props: { error: { $error: 'passphrase' } },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '300' },
                      children: [
                        {
                          type: 'we-input',
                          props: {
                            height: '36px',
                            width: '260px',
                            placeholder: 'Passphrase...',
                            value: { $local: 'passphrase' },
                            onInput: { $setLocal: 'passphrase', from: '$event.detail' },
                            onBlur: { $touch: 'passphrase' },
                            type: {
                              $if: { condition: { $local: 'showPassphrase' }, then: 'text', else: 'password' },
                            },
                          },
                        },
                        {
                          type: 'we-button',
                          props: {
                            bg: 'primary-500',
                            height: '36px',
                            onClick: { $toggleLocal: 'showPassphrase' },
                          },
                          children: [
                            {
                              type: 'we-icon',
                              props: {
                                name: {
                                  $if: { condition: { $local: 'showPassphrase' }, then: 'eye', else: 'eye-slash' },
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
                        width: '260px',
                        placeholder: 'Confirm passphrase...',
                        value: { $local: 'confirm' },
                        onInput: { $setLocal: 'confirm', from: '$event.detail' },
                        onBlur: { $touch: 'confirm' },
                        type: {
                          $if: { condition: { $local: 'showPassphrase' }, then: 'text', else: 'password' },
                        },
                      },
                    },
                  ],
                },
                {
                  type: 'we-button',
                  props: {
                    mt: '200',
                    height: '36px',
                    text: 'Create agent',
                    color: 'neutral-0',
                    bg: 'primary-500',
                    disabled: { $not: { $formValid: '$scope' } },
                    loading: { $store: 'sessionStore.createAgentLoading' },
                    onClick: [
                      { $touch: '$all' },
                      {
                        $if: {
                          condition: { $formValid: '$scope' },
                          then: { $action: 'sessionStore.createAgent', args: [{ $local: 'passphrase' }] },
                        },
                      },
                    ],
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
        // Login state
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'login'] },
            // condition: false,
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
              },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-icon', props: { name: 'key', color: 'primary-600' } },
                    {
                      type: 'we-text',
                      props: { variant: 'heading-sm', fontWeight: 'regular' },
                      children: ['Unlock your agent'],
                    },
                  ],
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
                        // Password input
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
                            type: {
                              $if: { condition: { $local: 'showPassword' }, then: 'text', else: 'password' },
                            },
                          },
                        },
                        // Show/hide password button
                        {
                          type: 'we-button',
                          props: {
                            bg: 'primary-500',
                            height: '36px',
                            onClick: {
                              $if: {
                                condition: { $local: 'showPassword' },
                                then: { $setLocal: 'showPassword', value: false },
                                else: { $setLocal: 'showPassword', value: true },
                              },
                            },
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
                // Login button
                {
                  type: 'we-button',
                  props: {
                    mt: '200',
                    height: '36px',
                    text: 'Login',
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
              ],
            },
          },
        },
      ],
    },
  },
};
