/**
 * The bot port reads what the executor's `bot.*` calls answer (the SDK's generated shapes), turns
 * `bot.setGrant`'s 409s into a neutral conflict, and pages the activity log by `before`.
 */
import type { BotActivity, BotAgent, CreatedBot } from '@coasys/ad4m';
import { isBotGrantConflict } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { type BotClientLike, createAd4mBotPort, readActivity } from './botPort';
import { createAd4mIdentityPort } from './identityPort';
import { missingExecutorMethods, resetMissingExecutorMethods } from './missingMethods';

const BOT = 'did:key:z6MkBot';

const agent: BotAgent = {
  did: BOT,
  name: 'Test bot',
  owner: 'did:scid:coasys:1:QmScid',
  offerId: 'o1',
  createdAt: 1_760_000_000,
  grant: { spaces: ['space-a'], can: ['read', 'write'], expires: null, state: 'active', version: 2, updatedAt: 9 },
  key: { keyId: 'd3', verdict: 'notInLog', can: ['read', 'write'], expires: 1_790_000_000 },
};

/** An `RpcError` as the client throws it: a status and the server's body. */
function rpcError(status: number, body: string) {
  return Object.assign(new Error(`RPC error ${status}: ${body}`), { name: 'RpcError', status, body });
}

function botClient(overrides: Partial<BotClientLike> = {}): BotClientLike {
  return {
    createAgent: vi.fn(async () => ({}) as unknown),
    setGrant: vi.fn(async () => agent),
    grant: vi.fn(async () => agent),
    list: vi.fn(async () => [agent]),
    log: vi.fn(async () => []),
    ...overrides,
  };
}

describe('the AD4M bot port', () => {
  it('reads a bot, its grant and its key in neutral terms', async () => {
    const [bot] = await createAd4mBotPort(botClient()).list();
    expect(bot).toEqual({
      did: BOT,
      name: 'Test bot',
      owner: 'did:scid:coasys:1:QmScid',
      createdAt: 1_760_000_000,
      grant: { spaces: ['space-a'], can: ['read', 'write'], expires: null, state: 'active', version: 2, updatedAt: 9 },
      key: { keyId: 'd3', verdict: 'not-in-log', can: ['read', 'write'], expires: 1_790_000_000 },
    });
  });

  it('reads a bot whose key the holder has not confirmed yet as having none', async () => {
    const port = createAd4mBotPort(botClient({ grant: async () => ({ ...agent, key: null }) }));
    expect((await port.grant(BOT)).key).toBeNull();
  });

  it('makes a bot from the offer, trimmed, and answers its match code and credential', async () => {
    const made: CreatedBot = {
      did: BOT,
      key: 'z6MkKey',
      owner: 'did:scid:coasys:1:QmScid',
      offerId: 'o1',
      matchCode: 'R7K Q2M',
      expires: 1_760_000_300,
      token: 'throwaway-token',
    };
    const client = botClient({ createAgent: vi.fn(async () => made) });
    const created = await createAd4mBotPort(client).create('  coasys:offer:1:x \n', ' Test bot ');
    expect(client.createAgent).toHaveBeenCalledWith('coasys:offer:1:x', 'Test bot');
    expect(created).toEqual({
      did: BOT,
      owner: 'did:scid:coasys:1:QmScid',
      matchCode: 'R7K Q2M',
      expires: 1_760_000_300,
      token: 'throwaway-token',
    });
  });

  it('sends the whole grant with the version it replaces', async () => {
    const client = botClient();
    const grant = {
      spaces: ['space-a'],
      can: ['read' as const],
      expires: 1_800_000_000,
      state: 'paused' as const,
      version: 2,
    };
    await createAd4mBotPort(client).setGrant(BOT, grant);
    expect(client.setGrant).toHaveBeenCalledWith(BOT, grant);
  });

  it('turns a stale version into a conflict that names the version now', async () => {
    const port = createAd4mBotPort(
      botClient({
        setGrant: async () => {
          throw rpcError(409, 'version: the grant changed, its version is now 5');
        },
      }),
    );
    const refused = await port.setGrant(BOT, { ...agent.grant, version: 2 }).catch((e: unknown) => e);
    expect(isBotGrantConflict(refused)).toBe(true);
    expect(refused).toMatchObject({ reason: 'version', version: 5 });
  });

  it('turns a change to a revoked grant into a conflict for good', async () => {
    const port = createAd4mBotPort(
      botClient({
        setGrant: async () => {
          throw rpcError(409, 'bot-revoked: a revoked grant never changes');
        },
      }),
    );
    const refused = await port.setGrant(BOT, { ...agent.grant, state: 'active' }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ reason: 'revoked' });
    expect(String((refused as Error).message)).toContain('revoked');
  });

  it('passes any other refusal on as it came', async () => {
    const outside = rpcError(400, 'not-in-can: the key may not write');
    const port = createAd4mBotPort(
      botClient({
        setGrant: async () => {
          throw outside;
        },
      }),
    );
    await expect(port.setGrant(BOT, { ...agent.grant, can: ['write'] })).rejects.toBe(outside);
  });

  it('pages the activity log by the entry it is older than', async () => {
    const entries: BotActivity[] = [
      {
        id: 7,
        at: 30,
        method: 'perspective.addLink',
        action: 'write',
        space: 'space-a',
        reason: 'Summarise the call',
        outcome: 'allowed',
      },
      {
        id: 6,
        at: 20,
        method: 'perspective.addLink',
        action: 'write',
        space: 'space-b',
        reason: 'Tidy up',
        outcome: 'bot-grant',
      },
      { id: 5, at: 10, method: 'agent.status', action: null, space: null, reason: null, outcome: 'not-in-can' },
    ];
    const client = botClient({ log: vi.fn(async () => entries) });
    const port = createAd4mBotPort(client);
    const page = await port.log(BOT, { before: 8, limit: 3 });
    expect(client.log).toHaveBeenCalledWith(BOT, { before: 8, limit: 3 });
    expect(page.map((e) => [e.id, e.allowed, e.refusal])).toEqual([
      [7, true, null],
      [6, false, 'bot-grant'],
      [5, false, 'not-in-can'],
    ]);
    expect(page[0].reason).toBe('Summarise the call');
    await port.log(BOT);
    expect(client.log).toHaveBeenLastCalledWith(BOT, { before: undefined, limit: undefined });
  });

  it('never reads an outcome it does not know as allowed', () => {
    expect(readActivity({ id: 1, outcome: '' })).toMatchObject({ allowed: false, refusal: 'refused' });
    expect(readActivity({ id: 1, outcome: 'Allowed' })).toMatchObject({ allowed: false });
  });
});

describe('bots on the AD4M identity port', () => {
  const identity = { status: async () => ({ did: null }), log: async () => ({}), devices: async () => [] };

  it('turns bots on, and offers the port, on an executor that answers bot.list', async () => {
    const port = createAd4mIdentityPort({ identity, bot: botClient() });
    expect((await port.capabilities()).bots).toBe(true);
    expect(port.bots).toBeDefined();
  });

  it('leaves bots off on an executor that predates them, and records why', async () => {
    resetMissingExecutorMethods();
    const bot = botClient({
      list: async () => {
        throw rpcError(404, 'Unknown type: bot.list');
      },
    });
    const port = createAd4mIdentityPort({ identity, bot });
    expect((await port.capabilities()).bots).toBe(false);
    expect(missingExecutorMethods().map((m) => m.method)).toContain('bot.list');
  });

  it('offers no bots on an SDK without them', async () => {
    const port = createAd4mIdentityPort({ identity });
    expect((await port.capabilities()).bots).toBe(false);
    expect(port.bots).toBeUndefined();
  });
});
