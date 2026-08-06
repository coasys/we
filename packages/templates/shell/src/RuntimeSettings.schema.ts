import type { SchemaNode } from '@we/schema-shared';

import { emptyNote, section } from './settingsSection.ts';

/**
 * RuntimeSettings — the backend process's own settings, as sections of the settings pages.
 *
 * These are the screens the ADAM launcher owns. On web the launcher is a separate app the user can
 * open; on the desktop hosts, which bundle the executor, there is no launcher and these settings
 * were simply unreachable.
 *
 * Every subsection gates on a `runtimeStore.canManage*` flag rather than on the platform. That is
 * not the same check dressed differently: what makes the trust list renderable is the backend
 * exposing peer trust, not the app running in Electron. A remote-hosted web session can administer
 * trust perfectly well, and a future backend might expose apps but not networking — a platform
 * check gets both of those wrong.
 *
 * Exported piece by piece rather than as one block: the network sections and the connected-apps
 * section now live on different pages, and a deployment that would rather not show users the guts
 * of their data layer drops a route.
 */

/**
 * One shared error slot. Every runtime action routes through it, so a failure is visible wherever
 * it happened rather than only where someone remembered to render it. Each page that carries a
 * runtime section carries one.
 */
export const runtimeError: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.error' },
    then: {
      type: 'we-alert',
      props: { variant: 'danger' },
      children: [{ $store: 'runtimeStore.error' }],
    },
  },
};

/** Apps holding credentials against this agent. Feature-detected — absent if the backend cannot. */
export const connectedApps: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.canManageApps' },
    then: section('Connected apps', 'squares-four', 'runtimeStore.loadAuthorizedApps', [
      {
        type: '$if',
        props: {
          condition: { $count: { items: { $store: 'runtimeStore.authorizedApps' } } },
          then: {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: '$each',
                props: { items: { $store: 'runtimeStore.authorizedApps' }, as: 'app' },
                children: [
                  {
                    type: 'Card',
                    props: { bg: 'neutral-100' },
                    children: [
                      {
                        type: 'Row',
                        props: { gap: '300', ay: 'center', ax: 'between' },
                        children: [
                          {
                            type: 'Row',
                            props: { gap: '300', ay: 'center' },
                            children: [
                              { type: 'we-avatar', props: { image: '$app.iconUrl', size: 'sm' } },
                              {
                                type: 'Column',
                                props: { gap: '100' },
                                children: [
                                  {
                                    type: 'Row',
                                    props: { gap: '200', ay: 'center' },
                                    children: [
                                      { type: 'we-text', props: { variant: 'label' }, children: ['$app.name'] },
                                      {
                                        type: '$if',
                                        props: {
                                          condition: '$app.revoked',
                                          then: {
                                            type: 'we-badge',
                                            props: { variant: 'neutral', size: 'xs' },
                                            children: ['Revoked'],
                                          },
                                        },
                                      },
                                    ],
                                  },
                                  {
                                    type: 'we-text',
                                    props: { variant: 'footnote', color: 'neutral-500' },
                                    children: ['$app.url'],
                                  },
                                ],
                              },
                            ],
                          },
                          {
                            type: 'Row',
                            props: { gap: '200' },
                            children: [
                              // Revoke stays available while unrevoked; remove always is,
                              // so a stale entry can be cleared without revoking first.
                              {
                                type: '$if',
                                props: {
                                  condition: { $not: '$app.revoked' },
                                  then: {
                                    type: 'we-button',
                                    props: {
                                      text: 'Revoke',
                                      variant: 'ghost',
                                      size: 'sm',
                                      onClick: { $action: 'runtimeStore.revokeApp', args: ['$app.id'] },
                                    },
                                  },
                                },
                              },
                              {
                                type: 'we-button',
                                props: {
                                  variant: 'ghost',
                                  size: 'sm',
                                  onClick: { $action: 'runtimeStore.removeApp', args: ['$app.id'] },
                                },
                                children: [{ type: 'we-icon', props: { name: 'trash' } }],
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
          },
          else: emptyNote('No apps have been granted access to your agent.'),
        },
      },
    ]),
  },
};

/** Peers this agent explicitly trusts. */
export const trustedAgents: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.canManageTrust' },
    then: section('Trusted agents', 'shield-check', 'runtimeStore.loadTrustedAgents', [
      {
        type: '$if',
        props: {
          condition: { $count: { items: { $store: 'runtimeStore.trustedAgents' } } },
          then: {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: '$each',
                props: { items: { $store: 'runtimeStore.trustedAgents' }, as: 'did' },
                children: [
                  {
                    type: 'Row',
                    props: {
                      gap: '300',
                      ay: 'center',
                      ax: 'between',
                      bg: 'neutral-100',
                      r: '300',
                      px: '300',
                      py: '200',
                    },
                    children: [
                      {
                        type: 'we-text',
                        props: { variant: 'footnote', styles: { 'word-break': 'break-all' } },
                        children: ['$did'],
                      },
                      {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: { $action: 'runtimeStore.untrustAgent', args: ['$did'] },
                        },
                        children: [{ type: 'we-icon', props: { name: 'x' } }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          else: emptyNote('No agents are explicitly trusted yet.'),
        },
      },
      {
        type: 'Row',
        props: { gap: '200' },
        children: [
          {
            type: 'we-input',
            props: {
              flex: '1',
              size: 'sm',
              placeholder: 'did:key:...',
              value: { $local: 'newTrustedAgent' },
              onInput: { $setLocal: 'newTrustedAgent', from: '$event.detail' },
            },
          },
          {
            type: 'we-button',
            props: {
              text: 'Trust',
              size: 'sm',
              variant: 'secondary',
              disabled: { $not: { $local: 'newTrustedAgent' } },
              onClick: {
                $action: 'runtimeStore.trustAgent',
                args: [{ $local: 'newTrustedAgent' }],
                onSuccess: [{ $setLocal: 'newTrustedAgent', value: '' }],
              },
            },
          },
        ],
      },
    ]),
  },
};

/** Diagnostics and out-of-band peer exchange for the networking layer. */
export const peerNetwork: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.canManageNetwork' },
    then: section('Peer network', 'globe', 'runtimeStore.loadNetworkMetrics', [
      {
        type: 'Row',
        props: { gap: '200', wrap: true },
        children: [
          {
            type: 'we-button',
            props: {
              text: 'Restart networking',
              size: 'sm',
              variant: 'secondary',
              loading: { $store: 'runtimeStore.loading' },
              onClick: { $action: 'runtimeStore.restartNetwork' },
            },
          },
          {
            type: 'we-button',
            props: {
              text: 'Exchange peer info',
              size: 'sm',
              variant: 'ghost',
              onClick: [{ $toggleLocal: 'showPeerExchange' }, { $action: 'runtimeStore.loadPeerInfos' }],
            },
          },
        ],
      },
      // Diagnostics are opt-in: the blob is long, unformatted, and meaningless unless
      // something is already wrong.
      {
        type: '$if',
        props: {
          condition: { $store: 'runtimeStore.networkMetrics' },
          then: {
            type: 'we-scroll-area',
            props: { maxHeight: '200px' },
            children: [
              {
                type: 'we-code',
                props: { block: true },
                children: [{ $store: 'runtimeStore.networkMetrics' }],
              },
            ],
          },
        },
      },
      // Manual peer exchange — the escape hatch for when discovery cannot find anyone.
      {
        type: '$if',
        props: {
          condition: { $local: 'showPeerExchange' },
          then: {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: 'we-text',
                props: { variant: 'footnote', color: 'neutral-500' },
                children: [
                  'Share these records with a peer who cannot find you, and paste theirs below. Only needed when automatic discovery fails.',
                ],
              },
              // One block per record rather than the whole array as children: the array
              // would stringify, and each record is separately copyable this way.
              {
                type: 'we-scroll-area',
                props: { maxHeight: '120px' },
                children: [
                  {
                    type: 'Column',
                    props: { gap: '200' },
                    children: [
                      {
                        type: '$each',
                        props: { items: { $store: 'runtimeStore.peerInfos' }, as: 'info' },
                        children: [
                          {
                            type: 'we-code',
                            props: { block: true, styles: { 'word-break': 'break-all' } },
                            children: ['$info'],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'we-textarea',
                props: {
                  rows: 3,
                  placeholder: "Paste a peer's info here...",
                  value: { $local: 'peerInfoText' },
                  onInput: { $setLocal: 'peerInfoText', from: '$event.detail' },
                },
              },
              {
                type: 'we-button',
                props: {
                  text: 'Add peer info',
                  size: 'sm',
                  variant: 'secondary',
                  disabled: { $not: { $local: 'peerInfoText' } },
                  onClick: {
                    $action: 'runtimeStore.addPeerInfos',
                    args: [{ $local: 'peerInfoText' }],
                    onSuccess: [{ $setLocal: 'peerInfoText', value: '' }],
                  },
                },
              },
            ],
          },
        },
      },
    ]),
  },
};

/**
 * Local state the network sections need: two input buffers and a disclosure toggle. Declared by
 * whichever page renders those sections, since `$localState` is scoped to the node that declares it.
 */
export const networkLocalState = {
  newTrustedAgent: { type: 'string', initial: '' },
  peerInfoText: { type: 'string', initial: '' },
  showPeerExchange: { type: 'boolean', initial: false },
} as const;
