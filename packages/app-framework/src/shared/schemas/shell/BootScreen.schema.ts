import type { SchemaNode } from '@we/schema-shared';

export const bootScreen: SchemaNode = {
  type: '$if',
  props: {
    condition: { $ne: [{ $store: 'adamStore.bootState' }, 'ready'] },
    exitTransition: {
      type: 'fade',
      duration: 500,
      easing: 'ease-out',
    },
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
        zIndex: '9999',
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
            gradient: 'var(--we-gradient-primary)',
          },
        },
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
              $localState: { password: { type: 'string', initial: '' } },
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
                        condition: { $store: 'adamStore.passwordError' },
                        then: 'Incorrect password',
                        else: '',
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
                            // height: '60px',
                            height: '36px',
                            width: '200px',
                            placeholder: 'Password...',
                            value: { $local: 'password' },
                            onInput: { $setLocal: 'password', from: '$event.detail' },
                            onKeyDown: {
                              $if: {
                                condition: { $eq: ['$arg.detail.key', 'Enter'] },
                                then: { $action: 'adamStore.unlockAgent', args: [{ $local: 'password' }] },
                              },
                            },
                            type: {
                              $if: {
                                condition: { $store: 'adamStore.showPassword' },
                                then: 'text',
                                else: 'password',
                              },
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
                              $action: 'adamStore.setShowPassword',
                              args: [{ $not: { $store: 'adamStore.showPassword' } }],
                            },
                          },
                          children: [
                            {
                              type: 'we-icon',
                              props: {
                                name: {
                                  $if: {
                                    condition: { $store: 'adamStore.showPassword' },
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
                    loading: { $store: 'adamStore.loginLoading' },
                    onClick: { $action: 'adamStore.unlockAgent', args: [{ $local: 'password' }] },
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
