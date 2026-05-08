/**
 * GlobalEntityModal
 *
 * Rendered when the user clicks a pin on the discovery globe (/discover route).
 * Reads `spaceStore.selectedPin` and renders either a Space card
 * or an AgentProfile card depending on the `kind` field.
 *
 * Dismiss: click anywhere outside the modal (we-modal close handler) or the
 * explicit close button — both call `spaceStore.clearSelectedPin`.
 */
export const globalEntityModal = {
  type: 'we-modal',
  props: {
    close: { $action: 'spaceStore.clearSelectedPin', args: [] },
    maxWidth: '520px',
    width: '100%',
  },
  children: [
    // ── Space card ──────────────────────────────────────────
    {
      type: '$if',
      props: {
        condition: {
          $eq: [{ $store: 'spaceStore.selectedPin.kind' }, 'space'],
        },
        then: {
          type: 'Column',
          props: { gap: '400' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.selectedSpace.thumbnail' },
                then: {
                  type: 'we-image',
                  props: {
                    src: { $store: 'spaceStore.selectedSpace.thumbnail' },
                    width: '100%',
                    height: '160px',
                    fit: 'cover',
                    r: '300',
                  },
                },
              },
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold' },
                  children: [{ $store: 'spaceStore.selectedSpace.name' }],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $store: 'spaceStore.selectedSpace.description' }],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true, mb: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'spaceStore.selectedEntitySignalData' }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig.signalType',
                        myValue: '$sig.myValue',
                        aggregate: '$sig.totalValue',
                        onSignal: {
                          $action: 'spaceStore.upsertEntitySignal',
                          args: ['$sig.signalType.id', '$arg'],
                        },
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-button',
              props: {
                text: 'Join Space',
                bg: 'primary-500',
                color: 'neutral-0',
                height: '40px',
                onClick: {
                  $action: 'routeStore.navigate',
                  args: [{ $concat: ['/join/', { $store: 'spaceStore.selectedSpace.url' }] }],
                },
              },
            },
          ],
        },
      },
    },
    // ── Agent card ──────────────────────────────────────────
    {
      type: '$if',
      props: {
        condition: {
          $eq: [{ $store: 'spaceStore.selectedPin.kind' }, 'agent'],
        },
        then: {
          type: 'Column',
          props: { gap: '400' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.selectedAgent.coverImage' },
                then: {
                  type: 'we-image',
                  props: {
                    src: { $store: 'spaceStore.selectedAgent.coverImage' },
                    width: '100%',
                    height: '140px',
                    fit: 'cover',
                    r: '300',
                  },
                },
              },
            },
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.selectedAgent.profileImage' },
                    then: {
                      type: 'we-image',
                      props: {
                        src: { $store: 'spaceStore.selectedAgent.profileImage' },
                        width: '60px',
                        height: '60px',
                        fit: 'cover',
                        r: 'full',
                      },
                    },
                    else: {
                      type: 'we-icon',
                      props: { name: 'user-circle', size: '60px', color: 'neutral-400' },
                    },
                  },
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '600', fontWeight: 'bold' },
                      children: [
                        {
                          $concat: [
                            { $store: 'spaceStore.selectedAgent.firstName' },
                            ' ',
                            { $store: 'spaceStore.selectedAgent.lastName' },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', color: 'neutral-400' },
                      children: [{ $concat: ['@', { $store: 'spaceStore.selectedAgent.handle' }] }],
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.selectedAgent.bio' },
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-600' },
                  children: [{ $store: 'spaceStore.selectedAgent.bio' }],
                },
              },
            },
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true, mt: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'spaceStore.selectedEntitySignalData' }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig.signalType',
                        myValue: '$sig.myValue',
                        aggregate: '$sig.totalValue',
                        onSignal: {
                          $action: 'spaceStore.upsertEntitySignal',
                          args: ['$sig.signalType.id', '$arg'],
                        },
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'Row',
              props: { ax: 'end', mt: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    text: 'Close',
                    onClick: { $action: 'spaceStore.clearSelectedPin', args: [] },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  ],
};
