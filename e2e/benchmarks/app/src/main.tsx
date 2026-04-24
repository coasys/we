/**
 * Minimal SolidJS harness for Ad4mModel browser benchmarks.
 *
 * Exposes `window.__bench` with functions that Playwright calls via page.evaluate().
 * The harness connects to the executor via Ad4mClient and creates a PerspectiveProxy,
 * then runs Ad4mModel queries in-browser (same path as a real SolidJS WE app).
 */
import { render } from 'solid-js/web';
import { createSignal, onMount, Show } from 'solid-js';
import { Ad4mClient } from '@coasys/ad4m';

interface BenchConfig {
  executorUrl: string;
  adminCredential: string;
  perspectiveUuid: string;
}

declare global {
  interface Window {
    __bench: {
      configure: (config: BenchConfig) => Promise<void>;
      querySparql: (query: string) => Promise<any>;
      queryChannel: (channelId: string) => Promise<any>;
      queryMessage: (messageId: string) => Promise<any>;
      queryConversation: (conversationId: string) => Promise<any>;
      ready: boolean;
    };
  }
}

function App() {
  const [status, setStatus] = createSignal('Waiting for Playwright...');
  const [queryCount, setQueryCount] = createSignal(0);

  let client: Ad4mClient | null = null;
  let perspective: any = null;

  onMount(() => {
    window.__bench = {
      ready: true,

      configure: async (config: BenchConfig) => {
        const wsUrl = config.executorUrl.replace(/^http/, 'ws');
        client = new Ad4mClient(`${wsUrl}/graphql`, false);
        // Set auth
        (client as any).setToken?.(config.adminCredential);

        // Get perspective proxy
        perspective = await client.perspective.byUUID(config.perspectiveUuid);
        if (!perspective) {
          throw new Error(`Perspective ${config.perspectiveUuid} not found`);
        }
        setStatus(`Connected: ${config.perspectiveUuid}`);
      },

      querySparql: async (query: string) => {
        if (!perspective) throw new Error('Not configured — call configure() first');
        setQueryCount((c) => c + 1);
        return perspective.querySparql(query);
      },

      queryChannel: async (channelId: string) => {
        if (!perspective) throw new Error('Not configured');
        setQueryCount((c) => c + 1);
        // Use the perspective to query a Channel via Ad4mModel
        const { Channel } = await import('../models/channel');
        const channel = await Channel.query(perspective, { id: channelId });
        return channel;
      },

      queryMessage: async (messageId: string) => {
        if (!perspective) throw new Error('Not configured');
        setQueryCount((c) => c + 1);
        const { Message } = await import('../models/message');
        const msg = await Message.query(perspective, { id: messageId });
        return msg;
      },

      queryConversation: async (conversationId: string) => {
        if (!perspective) throw new Error('Not configured');
        setQueryCount((c) => c + 1);
        const { Conversation } = await import('../models/conversation');
        const conv = await Conversation.query(perspective, { id: conversationId });
        return conv;
      },
    };

    setStatus('Ready');
  });

  return (
    <div style={{ padding: '20px', 'font-family': 'monospace' }}>
      <h2>SPARQL Benchmark Harness</h2>
      <p>Status: {status()}</p>
      <p>Queries executed: {queryCount()}</p>
      <Show when={window.__bench?.ready}>
        <p style={{ color: 'green' }}>✓ window.__bench available</p>
      </Show>
    </div>
  );
}

render(() => <App />, document.getElementById('root')!);
