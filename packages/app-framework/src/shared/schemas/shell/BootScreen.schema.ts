import type { SchemaNode } from '@we/schema-shared';

export const bootScreen: SchemaNode = {
  type: '$if',
  props: {
    condition: { $ne: [{ $store: 'adamStore.bootState' }, 'ready'] },
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
          },
        },
        // { type: 'WeCube', props: { width: '300px', height: '300px' } },
        // Initialising state
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'adamStore.bootState' }, 'initialising'] },
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
        // Login state
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'adamStore.bootState' }, 'login'] },
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
                    { type: 'we-icon', props: { name: 'key', color: 'primary-600', size: '30px' } },
                    { type: 'we-text', props: { fontSize: '600' }, children: ['Unlock your agent'] },
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
                            condition: { $store: 'adamStore.passwordError' },
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
                                then: { $action: 'adamStore.login', args: [{ $local: 'password' }] },
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
                    loading: { $store: 'adamStore.loginLoading' },
                    onClick: [
                      { $touch: '$all' },
                      {
                        $if: {
                          condition: { $formValid: '$scope' },
                          then: { $action: 'adamStore.login', args: [{ $local: 'password' }] },
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
