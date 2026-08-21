/**
 * AgentModal
 *
 * Rendered when the user clicks an Agent pin on the discovery globe.
 * Fetches the selected agent's profile via $agent bound to `$local.selectedPin.id` (DID).
 *
 * Layout:
 *   • Row: circular avatar  ($agent.avatar)  + name / handle
 *   • Optional bio
 *   • Signal controls row
 *   • Close button
 */
export const agentModal = {
  type: 'we-modal',
  props: {
    close: { $setLocal: 'selectedPin', value: null },
    maxWidth: '520px',
    width: '100%',
  },
  children: [
    {
      type: '$agent',
      props: { did: { $local: 'selectedPin.id' }, as: 'agent' },
      children: [
        {
          type: 'Column',
          props: { gap: '400' },
          children: [
            // ── Circular avatar + name / handle row ────────────
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: '$agent.avatar',
                    then: {
                      type: 'we-image',
                      props: {
                        src: '$agent.avatar',
                        width: '60px',
                        height: '60px',
                        fit: 'cover',
                        r: 'full',
                      },
                    },
                    else: {
                      type: 'we-icon',
                      props: { name: 'user-circle', size: 'xl', color: 'textFaint' },
                    },
                  },
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'heading-sm' },
                      children: ['$agent.name'],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'textFaint' },
                      children: [{ $concat: ['@', '$agent.handle'] }],
                    },
                  ],
                },
              ],
            },

            // ── Optional bio ────────────────────────────────────
            {
              type: '$if',
              props: {
                condition: '$agent.bio',
                then: {
                  type: 'we-text',
                  props: { variant: 'body' },
                  children: ['$agent.bio'],
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
                  props: { items: { $query: { entity: 'SignalType', subscribe: true } }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig',
                        signals: [],
                        myDid: '$me.did',
                        onSignal: {
                          $action: 'spaceStore.upsertSignal',
                          args: ['$agent.did', '$sig.id', '$arg'],
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
  ],
};
