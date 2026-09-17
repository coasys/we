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
                loading: { $: "'exportDatabase' in runtimeStore.pending" },
                onClick: { $action: 'runtimeStore.exportDatabase' },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'Import',
                size: 'sm',
                variant: 'ghost',
                loading: { $: "'importDatabase' in runtimeStore.pending" },
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

/**
 * The network metrics, in a viewer that can be read.
 *
 * Diagnostics are opt-in: the dump is long and means nothing unless something is already wrong, so
 * it is fetched on the press and never on opening the page. A modal rather than the inline block it
 * replaced because the dump is hundreds of lines of nested structure — a 200px well gave it a
 * keyhole, where somebody debugging a sync problem wants to fold away the spaces they are not
 * asking about and read the one they are.
 *
 * The backend has already indented it and turned its hashes into strings (see the port's
 * `networkMetrics`), so this only has to show it.
 */
const networkMetricsModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'local.showNetworkMetrics' },
    then: {
      type: 'we-modal',
      props: { size: 'lg', close: { $setLocal: 'showNetworkMetrics', value: false } },
      children: [
        {
          type: 'Row',
          slot: 'header',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'chart-line-up', color: 'text-muted' } },
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Network metrics'] },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'runtimeStore.networkMetrics' },
            then: {
              type: 'CodeEditor',
              props: {
                code: { $: 'runtimeStore.networkMetrics' },
                language: 'json',
                // A snapshot of the conductor, not a setting: nothing typed here could be applied.
                readOnly: true,
                // The editor's own scroller rather than the modal's, so its fold gutter and search
                // stay beside the text while it scrolls.
                maxHeight: '60dvh',
                styles: { width: '100%' },
              },
            },
            else: {
              type: '$if',
              props: {
                condition: { $: "runtimeStore.error && !('loadNetworkMetrics' in runtimeStore.pending)" },
                then: {
                  type: 'we-alert',
                  props: { variant: 'danger' },
                  children: [{ $: '`Could not get the network metrics: ${runtimeStore.error}`' }],
                },
                else: {
                  type: 'Column',
                  props: { ax: 'center', ay: 'center', gap: '300', p: '600' },
                  children: [
                    { type: 'we-spinner' },
                    {
                      type: 'we-text',
                      props: { color: 'text-muted' },
                      children: ['Asking the conductor for its metrics…'],
                    },
                  ],
                },
              },
            },
          },
        },
        {
          type: 'Row',
          slot: 'footer',
          props: { gap: '200', ax: 'end', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                // Disabled rather than spinning: the body already shows the fetch in progress, and a
                // second spinner in the button said the same thing twice.
                disabled: { $: "'loadNetworkMetrics' in runtimeStore.pending" },
                onClick: { $action: 'runtimeStore.loadNetworkMetrics' },
              },
              children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }, 'Refresh'],
            },
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                disabled: { $: '!runtimeStore.networkMetrics' },
                onClick: { $action: 'runtimeStore.copyNetworkMetrics' },
              },
              children: [{ type: 'we-icon', props: { name: 'copy' } }, 'Copy to clipboard'],
            },
          ],
        },
      ],
    },
  },
};

/**
 * Swapping peer records by hand, for when discovery cannot introduce two nodes.
 *
 * A modal rather than the inline disclosure it replaced. The disclosure opened under a button that
 * said "Exchange peer info" and nothing else, into a 120px well of records with no way to copy them
 * and nothing on screen while they loaded — which on a busy node is up to half a minute of an empty
 * box. Somebody who pressed it could not tell what it was for, whether it was doing anything, or
 * what they were meant to do with what appeared.
 *
 * Opening it empties the paste box: one field, and the peer's records are still wherever they were
 * sent from, where a blob left over from last time would be added by mistake. (On open rather than
 * on close because a modal's `close` takes one handler; only `on…` props take a list.)
 */
const peerExchangeModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'local.showPeerExchange' },
    then: {
      type: 'we-modal',
      props: { size: 'md', close: { $setLocal: 'showPeerExchange', value: false } },
      children: [
        {
          type: 'Row',
          slot: 'header',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'handshake', color: 'text-muted' } },
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Exchange peer info'] },
          ],
        },
        {
          type: 'Column',
          props: { gap: '500' },
          children: [
            {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: [
                'Nodes normally find each other through a discovery service. When that cannot connect you and a peer — a blocked network, or a discovery server that is down — you can swap these records by hand instead: send them yours, and add theirs below.',
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: 'runtimeStore.error && !count(runtimeStore.pending)' },
                then: { type: 'we-alert', props: { variant: 'danger' }, children: [{ $: 'runtimeStore.error' }] },
              },
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
                  children: [
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Records to send'] },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted' },
                          children: ["This node's own, and those of any peers it already knows."],
                        },
                      ],
                    },
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'secondary',
                        disabled: { $: '!count(runtimeStore.peerInfos)' },
                        onClick: { $action: 'runtimeStore.copyPeerInfos' },
                      },
                      children: [{ type: 'we-icon', props: { name: 'copy' } }, 'Copy all'],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'count(runtimeStore.peerInfos)' },
                    /*
                      The decoded records, not the raw ones. A raw record keeps its useful half as a
                      JSON document escaped inside a string — the signature is over those bytes — so
                      shown as it arrives it is one unreadable line. The backend unpacks it for
                      display; "Copy all" still sends the originals, which is what a peer can add.
                    */
                    then: {
                      type: 'CodeEditor',
                      props: {
                        code: { $: 'runtimeStore.peerInfosReadable' },
                        language: 'json',
                        readOnly: true,
                        // Lower than the metrics viewer's: the paste box shares this modal.
                        maxHeight: '240px',
                        styles: { width: '100%' },
                      },
                    },
                    else: {
                      type: '$if',
                      props: {
                        condition: { $: "'loadPeerInfos' in runtimeStore.pending" },
                        then: {
                          type: 'Row',
                          props: { gap: '300', ay: 'center', p: '400', ax: 'center' },
                          children: [
                            { type: 'we-spinner', props: { size: 'sm' } },
                            {
                              type: 'we-text',
                              props: { color: 'text-muted' },
                              children: ['Fetching records — this can take a while on a busy node…'],
                            },
                          ],
                        },
                        else: {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted' },
                          children: ['No records yet. A node has records once it has joined a shared space.'],
                        },
                      },
                    },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: "Your peer's records" },
              children: [
                {
                  type: 'we-textarea',
                  props: {
                    rows: 4,
                    placeholder: 'Paste the records your peer copied…',
                    value: { $: 'local.peerInfoText' },
                    onInput: { $setLocal: 'peerInfoText', value: { $: 'event.detail' } },
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          slot: 'footer',
          props: { gap: '200', ax: 'end', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'primary',
                disabled: { $: "!trim(local.peerInfoText) || 'addPeerInfos' in runtimeStore.pending" },
                loading: { $: "'addPeerInfos' in runtimeStore.pending" },
                onClick: {
                  $action: 'runtimeStore.addPeerInfos',
                  args: [{ $: 'local.peerInfoText' }],
                  // `result` is whether they were added; a failed attempt keeps the paste to retry.
                  onSuccess: [{ $if: { condition: { $: 'result' }, then: { $setLocal: 'peerInfoText', value: '' } } }],
                },
              },
              children: ["Add peer's records"],
            },
          ],
        },
      ],
    },
  },
};

/**
 * What this node turned out not to support — the account of a backend older than the app in front
 * of it.
 *
 * ## Why this is a section and not a toast
 *
 * A capability gap is a property of what you are connected to, true for the whole session, and an
 * event notification is the wrong shape for a standing fact: it fires once, before anybody has hit
 * the symptom, and is gone by the time they go looking. It is also unactionable by most of the
 * people who would see it — on a shared node the person who can rebuild the executor is not the
 * person whose cards look wrong — and a danger toast nobody can act on teaches people to dismiss
 * toasts. So it waits here, on the page somebody already comes to when the data layer is misbehaving.
 *
 * ## Why it names methods rather than symptoms
 *
 * WE knows precisely what it asked for and does not know what breaks as a result, and a sentence
 * per known gap would be one more thing to write after each one has already cost somebody a day of
 * diagnosis. The method name is the actionable half: it maps to a commit in the backend's history
 * and to a decision about rebuilding a node. Hidden entirely when there is nothing to report, since
 * an empty section here would be a claim this cannot make — see the note in the body.
 */
export const executorSupport: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(runtimeStore.unsupportedCapabilities)' },
    then: adminSection({
      title: 'Unsupported by this node',
      icon: 'warning',
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [
            'The app asked this node for these and it does not have them, so whatever needed each ' +
              'one is running with less than it was built for. Usually it means the node is ' +
              'running an older build than the app: rebuilding it is the fix.',
          ],
        },
        {
          type: '$each',
          props: { items: { $: 'runtimeStore.unsupportedCapabilities' }, as: 'gap' },
          children: [
            {
              type: 'Row',
              props: {
                gap: '300',
                ay: 'center',
                ax: 'between',
                wrap: true,
                bg: 'surface-sunken',
                r: '300',
                px: '300',
                py: '200',
              },
              children: [
                // The name verbatim, in code type: it is a string to search a codebase for, not
                // prose, and a proportional font invites reading it as a description.
                { type: 'we-code', children: [{ $: 'gap.name' }] },
                {
                  type: 'we-timestamp',
                  props: { value: { $: 'gap.firstSeen' }, relative: true, fontSize: '100', color: 'text-muted' },
                },
              ],
            },
          ],
        },
        /*
          The honest limit, said where the list is rather than in a docblock nobody reading this
          screen will see. Nothing is recorded until something asks for it, so this list answers
          "what has been refused" and never "is this node current" — and somebody who came here
          after a symptom and found the section absent would otherwise take that as a clean bill.
        */
        emptyNote('Only what has actually been asked for so far — this is not a full check of the node.'),
      ],
    }),
  },
};

/** Diagnostics and out-of-band peer exchange for the networking layer. */
export const peerNetwork: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'runtimeStore.canManageNetwork' },
    then: adminSection({
      title: 'Peer network',
      icon: 'globe',
      // No refresh in the heading. It used to be the only way to fetch the metrics, and an unlabelled
      // icon is not where anybody looks for "show me the network metrics" — they have a button now,
      // and the rest of the section fetches what it shows when it is opened.
      children: [
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: ["For when this node can't reach its peers, or sync seems stuck."],
        },
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'secondary',
                onClick: [
                  { $setLocal: 'showNetworkMetrics', value: true },
                  { $action: 'runtimeStore.loadNetworkMetrics' },
                ],
              },
              children: [{ type: 'we-icon', props: { name: 'chart-line-up' } }, 'Get network metrics'],
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'secondary',
                onClick: [
                  { $setLocal: 'peerInfoText', value: '' },
                  { $setLocal: 'showPeerExchange', value: true },
                  { $action: 'runtimeStore.loadPeerInfos' },
                ],
              },
              children: [{ type: 'we-icon', props: { name: 'handshake' } }, 'Exchange peer info'],
            },
            // Offered only where the backend's restart does something: a control that spins and
            // reports success over a no-op is worse than no control.
            {
              type: '$if',
              props: {
                condition: { $: 'runtimeStore.canRestartNetwork' },
                then: {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'secondary',
                    loading: { $: "'restartNetwork' in runtimeStore.pending" },
                    onClick: { $action: 'runtimeStore.restartNetwork' },
                  },
                  children: [{ type: 'we-icon', props: { name: 'arrows-clockwise' } }, 'Restart networking'],
                },
              },
            },
          ],
        },
        networkMetricsModal,
        peerExchangeModal,
      ],
    }),
  },
};

/**
 * Local state the network sections need: two input buffers and whether each of the two network
 * modals is open. Declared by whichever page renders those sections, since `$localState` is scoped to the
 * node that declares it.
 */
export const networkLocalState = {
  newTrustedAgent: { type: 'string', initial: '' },
  peerInfoText: { type: 'string', initial: '' },
  showPeerExchange: { type: 'boolean', initial: false },
  showNetworkMetrics: { type: 'boolean', initial: false },
} as const;
