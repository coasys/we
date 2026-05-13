/**
 * SpaceModal
 *
 * Rendered when the user clicks a Space pin on the discovery globe.
 * Fetches the selected Space via $each+$query bound to `spaceStore.selectedPin.id`.
 *
 * Layout:
 *   • Optional cover-image banner  ($item.coverImage)
 *   • Row: space avatar circle + name / description
 *   • Signal controls row
 *   • "Join Space" CTA button
 */
export const spaceModal = {
  type: 'we-modal',
  props: {
    close: { $action: 'spaceStore.clearSelectedPin', args: [] },
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
            model: 'Space',
            where: { id: { $store: 'spaceStore.selectedPin.id' } },
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
                    height: '160px',
                    fit: 'cover',
                    r: '300',
                  },
                },
              },
            },

            // ── Avatar + name / description row ────────────────
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
                      props: { name: 'globe', size: '60px', color: 'neutral-400' },
                    },
                  },
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold' },
                      children: ['$item.name'],
                    },
                    {
                      type: '$if',
                      props: {
                        condition: '$item.description',
                        then: {
                          type: 'we-text',
                          props: { fontSize: '400', color: 'neutral-500' },
                          children: ['$item.description'],
                        },
                      },
                    },
                  ],
                },
              ],
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

            // ── Join Space CTA ──────────────────────────────────
            {
              type: 'we-button',
              props: {
                text: 'Enter Space',
                bg: 'primary-500',
                color: 'neutral-0',
                height: '40px',
                onClick: [
                  { $action: 'adamStore.setCurrentPerspective', args: ['$item.uuid'] },
                  {
                    $action: 'routeStore.navigate',
                    args: [{ $concat: ['/space/', '$item.uuid', '/globe'] }],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};
