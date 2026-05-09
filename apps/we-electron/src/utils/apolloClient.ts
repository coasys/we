import { Ad4mClient, AgentStatus } from '@coasys/ad4m';

/**
 * Polls the Ad4mClient to ensure the executor is ready before proceeding
 */
async function ensureExecutorReady(client: Ad4mClient): Promise<{ status: AgentStatus }> {
  const maxAttempts = 30;
  const delay = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const status = await client.agent.status();
      return { status };
    } catch {
      console.log(`Ad4m: Executor not ready, attempt ${attempt} of ${maxAttempts}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Executor did not become ready after ${maxAttempts} attempts`);
}

/**
 * Builds an Ad4mClient connected to the local executor.
 * Used by Electron platform that has direct access to port/token via IPC.
 *
 * @param port - The AD4M executor port
 * @param token - The authentication token
 * @param subscribe - Whether to enable event subscriptions (default: true)
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
  const baseUrl = `http://localhost:${port}`;
  const ad4mClient = new Ad4mClient(baseUrl, token, subscribe);
  const { status } = await ensureExecutorReady(ad4mClient);
  return { client: ad4mClient, status };
}
