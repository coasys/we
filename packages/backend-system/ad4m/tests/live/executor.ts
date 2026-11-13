/**
 * Starts a throwaway executor for the live tests, and stops it afterwards.
 *
 * Every live file talks to the one process this starts, through the connection it provides — the
 * capability check (`capabilities.live.ts`, which is what `pnpm verify:ad4m` runs), the shared
 * conformance suite and the rest. An executor takes far longer to start than a test takes to run,
 * and each file works in perspectives of its own.
 *
 * Multi-user, as a hosted node runs and as every live test in WE does (`startExecutor` in
 * `@we/e2e`): the tests run as an account signed up on it through the client, with no email step,
 * and the admin credential stays with the operator. So what passes here passes for a person on a
 * hosted node, which a single-agent executor never asked. The executor itself is isolated from
 * anything else on the machine — fresh data, free ports, no bootstrap, proxy or mDNS — and its
 * binary is the one `scripts/ad4m-executor.mjs` chooses: `AD4M_EXECUTOR`, else the seed's own
 * `ad4m.executorPath`, else the pinned commit's download (`pnpm ad4m:executor`).
 *
 * To run against an executor that is already running instead, set `AD4M_LIVE_URL` and
 * `AD4M_LIVE_TOKEN` — a token for an unlocked agent, or for an account on a multi-user node — and
 * `AD4M_LIVE_MCP_URL` for the MCP endpoint; and know that the tests then write their perspectives
 * into that agent.
 */
import { Ad4mClient } from '@coasys/ad4m';
import { type Executor, signUp, startExecutor } from '@we/e2e/executor';
import { within } from '@we/e2e/waits';
import type { TestProject } from 'vitest/node';

export interface LiveExecutor {
  url: string;
  /** What the tests sign in with: the account's token on a fresh executor. */
  token: string;
  /**
   * The executor's MCP endpoint (`http://…/mcp`), which is how a bot reaches the tools a waker is
   * configured from (`get_mention_waker_config`). Absent for an executor already running
   * (`AD4M_LIVE_URL`) unless `AD4M_LIVE_MCP_URL` names it.
   */
  mcpUrl?: string;
  /**
   * True when this run started the executor and made the account, so tests may write to the agent
   * itself (its profile). An executor already running is somebody's agent: never write to it.
   */
  disposable?: boolean;
}

declare module 'vitest' {
  export interface ProvidedContext {
    ad4mExecutor: LiveExecutor;
  }
}

/** The account the tests run as on a fresh executor. */
const ACCOUNT = 'live@we.test';

/**
 * An executor already running with no agent gets one. One with an agent is somebody's, whose
 * passphrase is not ours, so a locked one is said rather than unlocked.
 */
async function ensureUnlockedAgent(client: Ad4mClient): Promise<void> {
  const status = await within(client.agent.status(), 30_000, 'agent.status');
  if (!status.isInitialized) await within(client.agent.generate('we-live'), 120_000, 'agent.generate');
  else if (!status.isUnlocked)
    throw new Error('The agent is locked. Unlock it, or let the tests start their own executor.');
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const presetUrl = process.env.AD4M_LIVE_URL;
  if (presetUrl) {
    const token = process.env.AD4M_LIVE_TOKEN ?? '';
    const client = new Ad4mClient(presetUrl, token);
    try {
      await ensureUnlockedAgent(client);
    } finally {
      client.close();
    }
    project.provide('ad4mExecutor', { url: presetUrl, token, mcpUrl: process.env.AD4M_LIVE_MCP_URL });
    return async () => {};
  }

  const executor: Executor = await startExecutor({ multiUser: true, mcp: true });
  let token: string;
  try {
    const account = await signUp(executor, ACCOUNT);
    token = account.token;
    // Closed once the account exists: an open socket would keep the run alive after the last test.
    account.client.close();
  } catch (error) {
    await executor.stop();
    throw new Error(`${(error as Error).message}\n--- executor output ---\n${executor.log().slice(-8_000)}`);
  }

  project.provide('ad4mExecutor', { url: executor.url, token, mcpUrl: executor.mcpUrl, disposable: true });
  return () => executor.stop();
}
