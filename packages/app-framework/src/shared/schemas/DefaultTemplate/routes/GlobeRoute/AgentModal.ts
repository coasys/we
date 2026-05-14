/**
 * AgentModal
 *
 * Rendered when the user clicks an Agent pin on the discovery globe.
 * Fetches the selected AgentProfile via $each+$query bound to `$local.selectedPin.id`.
 *
 * Layout:
 *   • Optional cover-image banner  ($item.coverImage)
 *   • Row: circular avatar  ($item.avatar)  + name / handle
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
      type: '$each',
      props: {
        as: 'item',
        items: {
          $query: {
            model: 'AgentProfile',
            where: { id: { $local: 'selectedPin.id' } },
            include: { signals: true },
            subscribe: false,
          },
        },
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
                condition: '$item.coverImage',
                then: {
                  type: 'we-image',
                  props: {
                    src: '$item.coverImage',
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
                    condition: '$item.avatar',
                    then: {
                      type: 'we-image',
                      props: {
                        src: '$item.avatar',
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
                          $concat: ['$item.firstName', ' ', '$item.lastName'],
                        },
                      ],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', color: 'neutral-400' },
                      children: [{ $concat: ['@', '$item.handle'] }],
                    },
                  ],
                },
              ],
            },

            // ── Optional bio ────────────────────────────────────
            {
              type: '$if',
              props: {
                condition: '$item.bio',
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-600' },
                  children: ['$item.bio'],
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
                  props: { items: { $query: { model: 'SignalType', subscribe: true } }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig',
                        aggregate: {
                          $count: {
                            items: {
                              $filter: {
                                items: '$item.signals',
                                where: { signalTypeId: '$sig.id' },
                              },
                            },
                          },
                        },
                        myValue: {
                          $find: {
                            items: '$item.signals',
                            where: {
                              signalTypeId: '$sig.id',
                              author: { $store: 'adamStore.me.did' },
                            },
                            select: 'value',
                          },
                        },
                        onSignal: {
                          $action: 'spaceStore.upsertSignal',
                          args: ['$item.id', '$sig.id', '$arg'],
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
