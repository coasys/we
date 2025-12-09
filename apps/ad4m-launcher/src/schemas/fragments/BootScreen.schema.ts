import type { SchemaNode } from '@we/schema-renderer/shared';

export const bootScreenSchema: SchemaNode = {
  type: '$if',
  props: {
    condition: { $ne: [{ $store: 'adamStore.bootState' }, 'ready'] },
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
        // opacity: 0.8,
      },
      children: [
        { type: 'we-text', props: { size: '800', weight: '600' }, children: ['WE'] },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'adamStore.bootState' }, 'initialising'] },
            then: {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-spinner', props: { size: 'sm' } },
                { type: 'we-text', children: ['Initialising AD4M client...'] },
              ],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $store: 'adamStore.bootState' }, 'login'] },
            then: {
              type: 'Column',
              props: { gap: '400', ax: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'key', color: 'ui-600', size: 'lg' } },
                { type: 'we-text', props: { size: '600', weight: '600' }, children: ['Unlock your agent'] },
                {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        placeholder: 'Password...',
                        value: { $store: 'adamStore.password' },
                        onInput: { $action: 'adamStore.setPassword' },
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
                    {
                      type: 'we-button',
                      props: {
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
                            color: 'ui-1000',
                          },
                        },
                      ],
                    },
                  ],
                },
                { type: 'we-button', props: { text: 'Login', onClick: { $action: 'adamStore.unlockAgent' } } },
              ],
            },
          },
        },
      ],
    },
  },
};
