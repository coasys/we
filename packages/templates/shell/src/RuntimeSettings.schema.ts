import type { SchemaNode } from '@we/schema-shared';
import { adminSection, emptyNote } from '@we/template-kit';

/** The five the backend's logger accepts; anything else it silently drops. */
const LOG_LEVEL_OPTIONS = [
  { label: 'Error', value: 'error' },
  { label: 'Warning', value: 'warn' },
  { label: 'Info', value: 'info' },
  { label: 'Debug', value: 'debug' },
  { label: 'Trace', value: 'trace' },
];

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
    condition: { $: 'runtimeStore.error' },
    then: {
      type: 'we-alert',
      props: { variant: 'danger' },
      children: [{ $: 'runtimeStore.error' }],
    },
  },
};

/** Apps holding credentials against this agent. Feature-detected — absent if the backend cannot. */
export const connectedApps: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canManageApps' },
    then: adminSection({
      title: 'Connected apps',
      icon: 'squares-four',
      refresh: 'runtimeStore.loadAuthorizedApps',
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'count(runtimeStore.authorizedApps)' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'runtimeStore.authorizedApps' }, as: 'app' },
                  children: [
                    {
                      type: 'Card',
                      props: { bg: 'surface' },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '300', ay: 'center', ax: 'between' },
                          children: [
                            {
                              type: 'Row',
                              props: { gap: '300', ay: 'center' },
                              children: [
                                { type: 'we-avatar', props: { image: { $: 'app.iconUrl' }, size: 'sm' } },
                                {
                                  type: 'Column',
                                  props: { gap: '100' },
                                  children: [
                                    {
                                      type: 'Row',
                                      props: { gap: '200', ay: 'center' },
                                      children: [
                                        { type: 'we-text', props: { variant: 'label' }, children: [{ $: 'app.name' }] },
                                        {
                                          type: '$if',
                                          props: {
                                            condition: { $: 'app.revoked' },
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
                                      props: { variant: 'footnote', color: 'text-muted' },
                                      children: [{ $: 'app.url' }],
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
                                    condition: { $: '!app.revoked' },
                                    then: {
                                      type: 'we-button',
                                      props: {
                                        text: 'Revoke',
                                        variant: 'ghost',
                                        size: 'sm',
                                        onClick: { $action: 'runtimeStore.revokeApp', args: [{ $: 'app.id' }] },
                                      },
                                    },
                                  },
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'ghost',
                                    size: 'sm',
                                    onClick: { $action: 'runtimeStore.removeApp', args: [{ $: 'app.id' }] },
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
      ],
    }),
  },
};

/** Peers this agent explicitly trusts. */
export const trustedAgents: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canManageTrust' },
    then: adminSection({
      title: 'Trusted agents',
      icon: 'shield-check',
      refresh: 'runtimeStore.loadTrustedAgents',
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'count(runtimeStore.trustedAgents)' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'runtimeStore.trustedAgents' }, as: 'did' },
                  children: [
                    {
                      type: 'Row',
                      props: {
                        gap: '300',
                        ay: 'center',
                        ax: 'between',
                        bg: 'surface-sunken',
                        r: '300',
                        px: '300',
                        py: '200',
                      },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'footnote' },
                          children: [{ $: 'did' }],
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'sm',
                            onClick: { $action: 'runtimeStore.untrustAgent', args: [{ $: 'did' }] },
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
                value: { $: 'local.newTrustedAgent' },
                onInput: { $setLocal: 'newTrustedAgent', value: { $: 'event.detail' } },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Trust',
                size: 'sm',
                variant: 'secondary',
                disabled: { $: '!local.newTrustedAgent' },
                onClick: {
                  $action: 'runtimeStore.trustAgent',
                  args: [{ $: 'local.newTrustedAgent' }],
                  onSuccess: [{ $setLocal: 'newTrustedAgent', value: '' }],
                },
              },
            },
          ],
        },
      ],
    }),
  },
};

/**
 * The Model Context Protocol server, which this host starts the backend with or without.
 *
 * On the Connections page rather than Network: what it connects is local AI tooling to this agent's
 * data, which is the same kind of thing as an app holding a credential — not peer networking.
 *
 * Every control here is a setting for the *next* start, so the restart notice is part of the
 * section rather than a toast: a switch that appears to do nothing is worse than one that says
 * what it is waiting for.
 */
export const mcpServer: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canConfigureExecutor' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'plugs-connected', color: 'text-muted' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['AI tool access (MCP)'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [
            'Lets AI tools on this machine — editors, agents, desktop assistants — read and write your data through the Model Context Protocol. Off unless you turn it on.',
          ],
        },
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', wrap: true },
          children: [
            {
              type: 'we-switch',
              props: {
                checked: { $: 'runtimeStore.mcpEnabled' },
                onChange: { $action: 'runtimeStore.setMcpEnabled', args: [{ $: 'event.detail' }] },
              },
            },
            { type: 'we-text', props: { variant: 'label' }, children: ['Serve MCP'] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', ml: '300' },
              children: ['Port'],
            },
            {
              type: 'we-number-input',
              props: {
                width: '120px',
                size: 'sm',
                min: 1024,
                max: 65535,
                step: 1,
                value: { $: 'runtimeStore.mcpPort' },
                onChange: { $action: 'runtimeStore.setMcpPort', args: [{ $: 'event.detail' }] },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.executorRestartPending' },
            then: {
              type: 'Row',
              props: { gap: '300', ay: 'center', ax: 'between', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote' },
                  children: ['Saved. It takes effect when the data layer restarts.'],
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Restart now',
                    size: 'sm',
                    variant: 'secondary',
                    onClick: { $action: 'runtimeStore.restartExecutor' },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  },
};

/**
 * Export and import of everything this agent holds.
 *
 * Gated on one flag covering both halves: the backend writes the file and the host is what can name
 * one, and neither is any use alone. On web that means it is absent — the path would be on somebody
 * else's filesystem, which is not a file the user could go and find.
 *
 * The status line is the whole feedback. An export writes somewhere the app cannot read back, and
 * an import's effect is spread across data the user has to go and look at, so neither leaves a
 * visible result of its own.
 */
export const backup: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canBackUp' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'archive', color: 'text-muted' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Backup'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [
            'Write everything this account holds to a file, or read a file back in. The file is written by the data layer, on this machine.',
          ],
        },
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Export',
                size: 'sm',
                variant: 'secondary',
                loading: { $: 'runtimeStore.loading' },
                onClick: { $action: 'runtimeStore.exportDatabase' },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Import',
                size: 'sm',
                variant: 'ghost',
                loading: { $: 'runtimeStore.loading' },
                onClick: { $action: 'runtimeStore.importDatabase' },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.backupStatus' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: 'runtimeStore.backupStatus' }],
            },
          },
        },
      ],
    },
  },
};

/**
 * Per-crate log levels for the backend.
 *
 * Overrides only — anything not listed keeps the backend's own default, which is why an empty list
 * says so rather than showing a table of defaults nobody set. That also keeps the crate names out
 * of WE: they belong to whatever the backend is built from, and hardcoding today's four here would
 * make them look like a contract.
 *
 * A host setting, like MCP: the levels are read when the backend starts.
 */
export const logging: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canConfigureExecutor' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'file-text', color: 'text-muted' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Logging'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ['Raise the log level for part of the data layer when you need to see what it is doing.'],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'count(runtimeStore.logLevels)' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $: 'runtimeStore.logLevels' }, as: 'entry' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center', bg: 'surface-sunken', r: '300', px: '300', py: '200' },
                      children: [
                        { type: 'we-code', props: { flex: '1' }, children: [{ $: 'entry.crate' }] },
                        {
                          type: 'we-select',
                          props: {
                            width: '140px',
                            size: 'sm',
                            value: { $: 'entry.level' },
                            options: LOG_LEVEL_OPTIONS,
                            onChange: {
                              $action: 'runtimeStore.setLogLevel',
                              args: [{ $: 'entry.crate' }, { $: 'event.detail' }],
                            },
                          },
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'sm',
                            onClick: { $action: 'runtimeStore.removeLogLevel', args: [{ $: 'entry.crate' }] },
                          },
                          children: [{ type: 'we-icon', props: { name: 'x' } }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            else: emptyNote('The data layer is using its own default levels.'),
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
                // Named rather than offered as a list: the parts of a backend are its own business,
                // and a picker here would go stale the moment one of them was renamed.
                placeholder: 'Part of the data layer, e.g. rust_executor or holochain',
                value: { $: 'local.newLogCrate' },
                onInput: { $setLocal: 'newLogCrate', value: { $: 'event.detail' } },
              },
            },
            {
              type: 'we-select',
              props: {
                width: '140px',
                size: 'sm',
                value: { $: 'local.newLogLevel' },
                options: LOG_LEVEL_OPTIONS,
                onChange: { $setLocal: 'newLogLevel', value: { $: 'event.detail' } },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Set',
                size: 'sm',
                variant: 'secondary',
                disabled: { $: '!local.newLogCrate' },
                onClick: {
                  $action: 'runtimeStore.setLogLevel',
                  args: [{ $: 'local.newLogCrate' }, { $: 'local.newLogLevel' }],
                  onSuccess: [{ $setLocal: 'newLogCrate', value: '' }],
                },
              },
            },
          ],
        },
      ],
    },
  },
};

/** Local state for the row that adds one. Declared by the page that renders `logging`. */
export const loggingLocalState = {
  newLogCrate: { type: 'string', initial: '' },
  newLogLevel: { type: 'string', initial: 'debug' },
} as const;

/** Diagnostics and out-of-band peer exchange for the networking layer. */
export const peerNetwork: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canManageNetwork' },
    then: adminSection({
      title: 'Peer network',
      icon: 'globe',
      refresh: 'runtimeStore.loadNetworkMetrics',
      children: [
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
                loading: { $: 'runtimeStore.loading' },
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
            condition: { $: 'runtimeStore.networkMetrics' },
            then: {
              type: 'we-scroll-area',
              props: { maxHeight: '200px' },
              children: [
                {
                  type: 'we-code',
                  props: { block: true },
                  children: [{ $: 'runtimeStore.networkMetrics' }],
                },
              ],
            },
          },
        },
        // Manual peer exchange — the escape hatch for when discovery cannot find anyone.
        {
          type: '$if',
          props: {
            condition: { $: 'local.showPeerExchange' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted' },
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
                          props: { items: { $: 'runtimeStore.peerInfos' }, as: 'info' },
                          children: [
                            {
                              type: 'we-code',
                              props: { block: true },
                              children: [{ $: 'info' }],
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
                    value: { $: 'local.peerInfoText' },
                    onInput: { $setLocal: 'peerInfoText', value: { $: 'event.detail' } },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Add peer info',
                    size: 'sm',
                    variant: 'secondary',
                    disabled: { $: '!local.peerInfoText' },
                    onClick: {
                      $action: 'runtimeStore.addPeerInfos',
                      args: [{ $: 'local.peerInfoText' }],
                      onSuccess: [{ $setLocal: 'peerInfoText', value: '' }],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    }),
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
