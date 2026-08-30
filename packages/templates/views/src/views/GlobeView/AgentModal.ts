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
import { OFFERED_SIGNAL_TYPES } from '@we/template-kit';

export const agentModal = {
  type: 'we-modal',
  props: { size: 'md', close: { $setLocal: 'selectedPin', value: null } },
  children: [
    {
      type: '$agent',
      props: { did: { $: 'local.selectedPin.id' }, as: 'agent' },
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
                    condition: { $: 'agent.avatar' },
                    then: {
                      type: 'we-image',
                      props: {
                        src: { $: 'agent.avatar' },
                        width: '60px',
                        height: '60px',
                        fit: 'cover',
                        r: 'full',
                      },
                    },
                    else: {
                      type: 'we-icon',
                      props: { name: 'user-circle', size: 'xl', color: 'text-faint' },
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
                      children: [{ $: 'agent.name' }],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-faint' },
                      children: [{ $: '`@${agent.handle}`' }],
                    },
                  ],
                },
              ],
            },

            // ── Optional bio ────────────────────────────────────
            {
              type: '$if',
              props: {
                condition: { $: 'agent.bio' },
                then: {
                  type: 'we-text',
                  props: { variant: 'body' },
                  children: [{ $: 'agent.bio' }],
                },
              },
            },

            // ── Signal controls ─────────────────────────────────
            {
              // Hoisted so a retired type can be filtered out client-side, and hoisted because
              // `filter()` cannot name an inline `$query`'s results. See `SpaceModal` for why the
              // filter is not a `where`, and `OFFERED_SIGNAL_TYPES` for the rule.
              type: 'Row',
              props: { gap: '200', ay: 'center', wrap: true },
              $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
              children: [
                {
                  type: '$each',
                  props: { items: { $: OFFERED_SIGNAL_TYPES }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: { $: 'sig' },
                        signals: [],
                        myDid: { $: 'me.did' },
                        onSignal: {
                          $action: 'spaceStore.upsertSignal',
                          args: [{ $: 'agent.did' }, { $: 'sig.id' }, { $: 'arg' }],
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
