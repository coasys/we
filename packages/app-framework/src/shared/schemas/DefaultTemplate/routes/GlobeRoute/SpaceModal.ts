/**
 * SpaceModal
 *
 * Rendered when the user clicks a Space pin on the discovery globe.
 * Reads `spaceStore.selectedSpace` (set when `selectedPin.kind === 'space'`).
 *
 * Layout:
 *   • Optional cover-image banner  (selectedSpace.coverImage)
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
      type: 'Column',
      props: { gap: '400' },
      children: [
        // ── Cover image banner ──────────────────────────────
        {
          type: '$if',
          props: {
            condition: { $store: 'spaceStore.selectedSpace.coverImage' },
            then: {
              type: 'we-image',
              props: {
                src: { $store: 'spaceStore.selectedSpace.coverImage' },
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
                condition: { $store: 'spaceStore.selectedSpace.avatar' },
                then: {
                  type: 'we-image',
                  props: {
                    src: { $store: 'spaceStore.selectedSpace.avatar' },
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
                  children: [{ $store: 'spaceStore.selectedSpace.name' }],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.selectedSpace.description' },
                    then: {
                      type: 'we-text',
                      props: { fontSize: '400', color: 'neutral-500' },
                      children: [{ $store: 'spaceStore.selectedSpace.description' }],
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
              { $action: 'adamStore.setCurrentPerspective', args: [{ $store: 'spaceStore.selectedSpace.uuid' }] },
              {
                $action: 'routeStore.navigate',
                args: [{ $concat: ['/space/', { $store: 'spaceStore.selectedSpace.uuid' }, '/globe'] }],
              },
            ],
          },
        },
      ],
    },
  ],
};
