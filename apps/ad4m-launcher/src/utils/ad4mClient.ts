import { ApolloClient, DefaultOptions, InMemoryCache } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { Ad4mClient, AgentStatus } from '@coasys/ad4m';
import { invoke } from '@tauri-apps/api/core';
import { createClient } from 'graphql-ws';

async function ensureExecutorReady(client: Ad4mClient): Promise<{ status: AgentStatus }> {
  const maxAttempts = 30;
  const delay = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Attempt to get the agent status
      const status = await client.agent.status();
      return { status };
    } catch {
      console.log(`AdamStore: Executor not ready, attempt ${attempt} of ${maxAttempts}`);
      // Wait for delay before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Executor did not become ready after ${maxAttempts} attempts`);
}

export async function buildAd4mClient(subscribe = true): Promise<{ client: Ad4mClient; status: AgentStatus }> {
  // Get connection details from the backend
  const port = await invoke('get_port');
  const token = await invoke('request_credential');

  // Set up Apollo Client with GraphQL WS link
  const server = `ws://localhost:${port}/graphql`;
  const clientParams = { url: server, connectionParams: { headers: { authorization: token } } };
  const link = new GraphQLWsLink(createClient(clientParams));
  const cache = new InMemoryCache({ resultCaching: false });
  const defaultOptions: DefaultOptions = {
    watchQuery: { fetchPolicy: 'no-cache' },
    query: { fetchPolicy: 'no-cache' },
  };
  const apolloClient = new ApolloClient({ link, cache, defaultOptions });

  // Build the Ad4m client and ensure the executor is ready
  const ad4mClient = new Ad4mClient(apolloClient, subscribe);
  const { status } = await ensureExecutorReady(ad4mClient);

  // Return the initialized client and status
  return { client: ad4mClient, status };
}
