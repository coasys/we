/**
 * AgentModal
 *
 * Rendered when the user clicks an Agent pin on the discovery globe.
 * Reads `spaceStore.selectedAgent` (set when `selectedPin.kind === 'agent'`).
 *
 * Layout:
 *   • Optional cover-image banner  (selectedAgent.coverImage)
 *   • Row: circular avatar  (selectedAgent.avatar)  + name / handle
 *   • Optional bio
 *   • Signal controls row
 *   • Close button
 */
export const agentModal = {
  type: 'we-modal',
  props: {
    close: { $action: 'spaceStore.clearSelectedPin', args: [] },
    maxWidth: '520px',
    width: '100%',
  },
  children: [
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        // ── Cover image banner ──────────────────────────────
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

        // ── Circular avatar + name / handle row ────────────
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.selectedAgent.avatar' },
                then: {
                  type: 'we-image',
                  props: {
                    src: { $store: 'spaceStore.selectedAgent.avatar' },
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

        // ── Optional bio ────────────────────────────────────
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

        // ── Signal controls ─────────────────────────────────
        {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
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

        // ── Close button ────────────────────────────────────
        {
          type: 'Row',
          props: { ax: 'end' },
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
  ],
};
