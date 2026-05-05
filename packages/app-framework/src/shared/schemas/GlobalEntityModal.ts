/**
 * GlobalEntityModal
 *
 * Rendered when the user clicks a pin on the discovery globe (/discover route).
 * Reads `globalStore.selectedGlobalEntity` and renders either a Space card
 * or an AgentProfile card depending on the `kind` field.
 *
 * Dismiss: click anywhere outside the modal (we-modal close handler) or the
 * explicit close button — both call `globalStore.clearSelectedEntity`.
 */
export const globalEntityModal = {
  type: 'we-modal',
  props: {
    close: { $action: 'globalStore.clearSelectedEntity', args: [] },
    maxWidth: '520px',
    width: '100%',
  },
  children: [
    // ── Space card ──────────────────────────────────────────
    {
      type: '$if',
      props: {
        condition: {
          $eq: [{ $store: 'globalStore.selectedGlobalEntity.kind' }, 'space'],
        },
        then: {
          type: 'Column',
          props: { gap: '400' },
          children: [
            // Thumbnail banner
            {
              type: '$if',
              props: {
                condition: { $store: 'globalStore.selectedGlobalEntity.thumbnail' },
                then: {
                  type: 'we-image',
                  props: {
                    src: { $store: 'globalStore.selectedGlobalEntity.thumbnail' },
                    width: '100%',
                    height: '160px',
                    fit: 'cover',
                    r: '300',
                  },
                },
              },
            },
            // Name + description
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold' },
                  children: [{ $store: 'globalStore.selectedGlobalEntity.name' }],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $store: 'globalStore.selectedGlobalEntity.description' }],
                },
              ],
            },
            // Actions
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true, mb: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'globalStore.selectedEntitySignalData' }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig.signalType',
                        myValue: '$sig.myValue',
                        aggregate: '$sig.totalValue',
                        onSignal: {
                          $action: 'globalStore.upsertGlobalSignal',
                          args: ['$sig.nodeId', '$sig.signalType.id', '$arg'],
                        },
                      },
                    },
                  ],
                },
              ],
            },
            // Actions
            {
              type: 'Row',
              props: { gap: '300', ax: 'end', mt: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    text: 'Close',
                    onClick: { $action: 'globalStore.clearSelectedEntity', args: [] },
                  },
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
                      args: [
                        {
                          $concat: ['/join/', { $store: 'globalStore.selectedGlobalEntity.url' }],
                        },
                      ],
                    },
                  },
                },
              ],
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
          $eq: [{ $store: 'globalStore.selectedGlobalEntity.kind' }, 'agent'],
        },
        then: {
          type: 'Column',
          props: { gap: '400' },
          children: [
            // Cover image
            {
              type: '$if',
              props: {
                condition: { $store: 'globalStore.selectedGlobalEntity.coverImage' },
                then: {
                  type: 'we-image',
                  props: {
                    src: { $store: 'globalStore.selectedGlobalEntity.coverImage' },
                    width: '100%',
                    height: '140px',
                    fit: 'cover',
                    r: '300',
                  },
                },
              },
            },
            // Avatar + name row
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'globalStore.selectedGlobalEntity.profileImage' },
                    then: {
                      type: 'we-image',
                      props: {
                        src: { $store: 'globalStore.selectedGlobalEntity.profileImage' },
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
                            { $store: 'globalStore.selectedGlobalEntity.firstName' },
                            ' ',
                            { $store: 'globalStore.selectedGlobalEntity.lastName' },
                          ],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', color: 'neutral-400' },
                      children: [{ $concat: ['@', { $store: 'globalStore.selectedGlobalEntity.handle' }] }],
                    },
                  ],
                },
              ],
            },
            // Bio
            {
              type: '$if',
              props: {
                condition: { $store: 'globalStore.selectedGlobalEntity.bio' },
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-600' },
                  children: [{ $store: 'globalStore.selectedGlobalEntity.bio' }],
                },
              },
            },
            // React bar
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true, mt: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'globalStore.selectedEntitySignalData' }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig.signalType',
                        myValue: '$sig.myValue',
                        aggregate: '$sig.totalValue',
                        onSignal: {
                          $action: 'globalStore.upsertGlobalSignal',
                          args: ['$sig.nodeId', '$sig.signalType.id', '$arg'],
                        },
                      },
                    },
                  ],
                },
              ],
            },
            // Close button
            {
              type: 'Row',
              props: { ax: 'end', mt: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    text: 'Close',
                    onClick: { $action: 'globalStore.clearSelectedEntity', args: [] },
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
