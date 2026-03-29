import { ApolloClient, DefaultOptions, InMemoryCache } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { Ad4mClient, AgentStatus } from '@coasys/ad4m';
import { createClient } from 'graphql-ws';

/**
 * Polls the Ad4mClient to ensure the executor is ready before proceeding
 */
async function ensureExecutorReady(client: Ad4mClient): Promise<{ status: AgentStatus }> {
  const maxAttempts = 30;
  const delay = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Attempt to get the agent status
      const status = await client.agent.status();
      return { status };
    } catch {
      console.log(`Apollo: Executor not ready, attempt ${attempt} of ${maxAttempts}`);
      // Wait for delay before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Executor did not become ready after ${maxAttempts} attempts`);
}

/**
 * Builds an Ad4mClient using Apollo Client with GraphQL WebSocket connection
 * Used by Electron platform that has direct access to port/token via IPC
 *
 * @param port - The AD4M executor port
 * @param token - The authentication token
 * @param subscribe - Whether to enable GraphQL subscriptions (default: true)
 * @returns An initialized Ad4mClient and agent status
 */
export async function buildAd4mClientWithApollo(
  port: number,
  token: string,
  subscribe = true,
): Promise<{
  client: Ad4mClient;
  status: AgentStatus;
}> {
  // Set up Apollo Client with GraphQL WS link
  const server = `ws://localhost:${port}/graphql`;
  const clientParams = {
    url: server,
    connectionParams: { headers: { authorization: token } },
  };
  const link = new GraphQLWsLink(createClient(clientParams));
  const cache = new InMemoryCache({ resultCaching: false });
  const defaultOptions: DefaultOptions = {
    watchQuery: { fetchPolicy: 'no-cache' },
    query: { fetchPolicy: 'no-cache' },
  };
  const apolloClient = new ApolloClient({ link, cache, defaultOptions });

  // Build the Ad4m client and ensure the executor is ready
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ApolloClient type mismatch with Ad4mClient constructor
  const ad4mClient = new Ad4mClient(apolloClient as any, subscribe);
  const { status } = await ensureExecutorReady(ad4mClient);

  // Return the initialized client and status
  return { client: ad4mClient, status };
}
