import type { SchemaNode } from '@we/schema-renderer/shared';

export const bootScreenSchema: SchemaNode = {
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
        bg: 'ui-0',
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
            gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    { type: 'we-icon', props: { name: 'key', color: 'primary-600', size: '30px' } },
                    { type: 'we-text', props: { size: '600' }, children: ['Unlock your agent'] },
                  ],
                },
                {
                  type: 'Row',
                  props: { gap: '300' },
                  children: [
                    // Password input
                    {
                      type: 'we-input',
                      props: {
                        // height: '60px',
                        width: '200px',
                        placeholder: 'Password...',
                        value: { $store: 'adamStore.password' },
                        onInput: { $action: 'adamStore.setPassword', args: ['$arg.target.value'] },
                        onKeyDown: {
                          $if: {
                            condition: { $eq: ['$arg.key', 'Enter'] },
                            then: { $action: 'adamStore.unlockAgent' },
                          },
                        },
                        error: { $store: 'adamStore.passwordError' },
                        errortext: 'Incorrect password',
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
                            color: 'ui-0',
                          },
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
                    text: 'Login',
                    color: 'ui-0',
                    bg: 'primary-500',
                    loading: { $store: 'adamStore.loginLoading' },
                    onClick: { $action: 'adamStore.unlockAgent' },
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
