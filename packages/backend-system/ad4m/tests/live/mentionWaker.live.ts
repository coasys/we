/**
 * A bot is woken when a person @mentions it in a WE channel.
 *
 * End to end, against a real executor: the bot is the executor's agent, and configures its waker
 * the way the OpenClaw AD4M plugin does — `get_mention_waker_config` over MCP, opened by
 * `@coasys/ad4m`'s own `WakerSubscriptionManager`.
 *
 * WE stores a mention as the visible text `@<name>`, a `mention` mark carrying the bot's DID, and a
 * `we://mention` link to the DID: from a post's root (`createBlocks` writes it from the marks), or
 * from a feed line itself (`linkNewMentions` adds it beside the line). The link is the mention. The
 * text holds whatever name WE's picker showed for the bot — a name from some profile, or a shortened
 * DID when it has none — so the bot must be woken whatever the text says:
 *
 * - a post into a channel, through WE's own create path (`createBlocks`, which is what
 *   `spaceStore.createPost` calls): woken, naming the post's root;
 * - a line in the channel's feed, written the way a module write is (`TextBlock` and its `mentions`
 *   relation): woken, naming the line;
 * - the bot's own post naming itself: not woken.
 *
 * The bot has no profile here, so no name in the text is one the executor could know it by.
 *
 * The person is a second agent. The mention query skips links the bot wrote itself (a bot naming
 * itself in a reply is not a mention of it), so the post has to arrive authored by someone else —
 * which is what neighbourhood sync delivers. The post is composed in a scratch perspective, and
 * every link it wrote is replayed into the watched one signed by the person's own `did:key`, exactly
 * as synced links arrive: `addLinkExpression` stores a link under the author it claims, and the
 * mention query reads only links whose signature verifies.
 */
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';

import {
  Ad4mClient,
  LinkExpression,
  LinkQuery,
  type MentionMessage,
  type PerspectiveInput,
  QuerySubscriptionProxy,
  WakerSubscriptionManager,
} from '@coasys/ad4m';
import type { BackendPorts } from '@we/backend-shared';
import { type ContentDocument, createBlocks, registerCoreBlocks, serializeMarks } from '@we/block-shared';
import { CollectionBlock, TextBlock } from '@we/entities';
import { afterAll, describe, expect, inject, it } from 'vitest';

import { ensureFileStorageLanguage } from '../../src/agentHelpers';
import { createAd4mBackendPorts } from '../../src/backendPortsAdapter';

// ── MCP, as the waker plugin reaches it ──────────────────────────────────────

/** The first JSON-RPC message in a Streamable-HTTP answer, plain JSON or SSE. */
interface Rpc {
  jsonrpc?: string;
  result?: { content?: { text?: string }[] };
  error?: { message: string };
}

async function readRpc(response: Response): Promise<Rpc> {
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream'))
    return response.json() as Promise<Rpc>;
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split('\n')) {
      const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
      if (!payload) continue;
      try {
        const parsed = JSON.parse(payload) as Rpc;
        if (parsed.jsonrpc) {
          await reader.cancel();
          return parsed;
        }
      } catch {
        // A partial line; the rest is still arriving.
      }
    }
    if (done) throw new Error(`MCP answered without a JSON-RPC message: ${buffer}`);
  }
}

async function mcpSession(url: string, token: string) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  let id = 0;
  const init = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++id,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'we-live', version: '1' } },
    }),
  });
  const session = init.headers.get('mcp-session-id') ?? '';
  await readRpc(init);
  const withSession = { ...headers, 'Mcp-Session-Id': session };
  await fetch(url, {
    method: 'POST',
    headers: withSession,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(url, {
      method: 'POST',
      headers: withSession,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }),
    });
    const rpc = await readRpc(response);
    if (rpc.error) throw new Error(`${name}: ${rpc.error.message}`);
    const text = rpc.result?.content?.[0]?.text ?? '';
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };
}

// ── A second agent ───────────────────────────────────────────────────────────

/** A person with a real did:key, signing links the way the executor does. */
function person() {
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const base58btc = (bytes: Buffer) => {
    let n = BigInt(`0x${bytes.toString('hex')}`);
    let out = '';
    while (n > 0n) {
      out = B58[Number(n % 58n)] + out;
      n /= 58n;
    }
    for (const byte of bytes) {
      if (byte !== 0) break;
      out = `1${out}`;
    }
    return out;
  };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const did = `did:key:z${base58btc(Buffer.concat([Buffer.from([0xed, 0x01]), raw]))}`;
  return {
    did,
    /** The link signed by this person: sha256 over the link's JSON and the timestamp, Ed25519. */
    sign(data: { source: string; predicate?: string | null; target: string }): LinkExpression {
      const timestamp = new Date().toISOString();
      // Field order of the executor's `Link`: predicate, source, target.
      const signed = { predicate: data.predicate ?? null, source: data.source, target: data.target };
      const hash = createHash('sha256').update(JSON.stringify(signed)).update(timestamp).digest();
      const signature = signBytes(null, hash, privateKey).toString('hex');
      return {
        author: did,
        timestamp,
        data: signed,
        proof: { key: `${did}#${did.slice(8)}`, signature },
      } as unknown as LinkExpression;
    },
  };
}

// ── The fixture ──────────────────────────────────────────────────────────────

let backend: Promise<{ client: Ad4mClient; ports: BackendPorts; bot: string }> | undefined;

function connect() {
  backend ??= (async () => {
    const { url, token } = inject('ad4mExecutor');
    const client = new Ad4mClient(url, token);
    const bot = (await client.agent.me()).did;
    return { client, ports: createAd4mBackendPorts(client, { selfId: () => bot }), bot };
  })();
  return backend;
}

const removeAfter: string[] = [];
const managers: WakerSubscriptionManager[] = [];

afterAll(async () => {
  for (const manager of managers) manager.disposeAll();
  const opened = await backend;
  if (!opened) return;
  for (const id of removeAfter) await opened.ports.lifecycle.remove(id).catch(() => {});
  opened.client.close();
});

async function weSpace(ports: BackendPorts, name: string) {
  const ref = await ports.lifecycle.create(`${name}-${Date.now()}`);
  removeAfter.push(ref.id);
  await ports.schemas.installSpace(ref.handle, []);
  return ref;
}

const key = (l: {
  author: string;
  timestamp: string;
  data: { source: string; predicate?: string | null; target: string };
}) => `${l.author}|${l.timestamp}|${l.data.source}|${l.data.predicate ?? ''}|${l.data.target}`;

/** WE's mention picker's label for a member without a profile (`TemplateProvider`'s `mentions`). */
const shortDid = (did: string) => (did.length > 20 ? `${did.slice(0, 12)}…${did.slice(-4)}` : did);

/**
 * What the text says where the bot is mentioned: whatever WE's picker showed for it. Neither is a
 * name the executor knows the bot by, since the bot has no profile.
 */
const LABELS: { label: string; name: (bot: string) => string }[] = [
  { label: 'a name in no profile', name: () => 'Data' },
  { label: 'a shortened DID', name: shortDid },
];

/** A post into `channelId` through WE's own create path, its text mentioning `did` as `@<name>`. */
async function postMentioning(handle: unknown, channelId: string, name: string, did: string) {
  const mention = `@${name}`;
  const post: ContentDocument = {
    _type: 'document',
    blocks: [
      {
        _type: 'block',
        text: `${mention} can you look at this?`,
        marks: [{ start: 0, end: Array.from(mention).length, type: 'mention', did }],
      },
    ],
  };
  const root = await createBlocks(handle as never, post, {
    kind: 'post',
    anchor: { id: channelId, relation: 'children', entity: 'CollectionBlock' },
  });
  expect(root?.id).toBeTruthy();
  return root!.id;
}

/** The bot, its waker opened on a fresh watched space, and a space a person composes in. */
async function botWithWaker() {
  const { client, ports, bot } = await connect();
  const { mcpUrl, token } = inject('ad4mExecutor');
  if (!mcpUrl) throw new Error('This test needs the executor’s MCP endpoint (AD4M_LIVE_MCP_URL).');
  const callTool = await mcpSession(mcpUrl, token);

  // No public profile: no name in a mention's text is one the bot is known by.
  await client.agent.updatePublicPerspective({ links: [] } as PerspectiveInput);

  // The neighbourhood the bot watches, and the one the person composes in.
  const watched = await weSpace(ports, 'waker-watched');
  const composing = await weSpace(ports, 'waker-composing');
  const composingUuid = (composing.handle as { uuid: string }).uuid;
  const watchedUuid = (watched.handle as { uuid: string }).uuid;

  // The bot's waker, configured and opened as the plugin does.
  const config = (await callTool('get_mention_waker_config', { perspective_id: watchedUuid })) as {
    query: string;
    class?: string;
    terms?: string[];
  };
  const wakes: MentionMessage[][] = [];
  const manager = new WakerSubscriptionManager({
    perspectiveClient: client.perspective,
    logger: { info: () => {}, warn: console.warn, error: console.error, debug: () => {} },
    QuerySubscriptionProxy,
    debounceMs: 100,
    onWake: (_sub, _result, mentions) => {
      wakes.push(mentions ?? []);
    },
  });
  managers.push(manager);
  // Whatever the executor answers, passed on as the plugin passes it.
  const subscription = {
    id: `mention-${watchedUuid}`,
    type: 'mention' as const,
    perspective: watchedUuid,
    channel: '',
    query: config.query,
    ...(config.class ? { className: config.class } : {}),
    ...(config.terms ? { terms: config.terms } : {}),
  };
  await manager.subscribe(subscription);

  // A composition's document is a file-backed property, so the file-storage language has to be
  // there, as the shell makes sure it is at sign-in.
  await ensureFileStorageLanguage(client);
  registerCoreBlocks();
  const before = new Set((await client.perspective.queryLinks(composingUuid, new LinkQuery({}))).map(key));
  const channel = (await CollectionBlock.create(composing.handle as never, {
    kind: 'channel',
    title: 'general',
  })) as { id: string };

  return {
    bot,
    watched,
    composing,
    channel,
    /**
     * Everything composed since the fixture was made arrives in the watched neighbourhood under a
     * person's own signature, as sync delivers it; then the bot's wakes, once one came or after 30 s.
     */
    async deliver(): Promise<{ woken: MentionMessage[]; why: string }> {
      const someone = person();
      const written = (await client.perspective.queryLinks(composingUuid, new LinkQuery({})))
        .filter((l) => !before.has(key(l)))
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      for (const link of written) {
        await client.perspective.addLinkExpression(watchedUuid, someone.sign(link.data));
      }
      const deadline = Date.now() + 30_000;
      while (!wakes.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      return { woken: wakes.flat(), why: `config: ${JSON.stringify(config)}` };
    },
  };
}

describe('a bot @mentioned in a WE channel', () => {
  it.each(LABELS)('is woken by a post that mentions it, labelled by $label', { timeout: 180_000 }, async ({ name }) => {
    const fixture = await botWithWaker();
    const label = name(fixture.bot);
    expect(`@${label}`).not.toContain(fixture.bot);

    // The person posts into the channel, mentioning the bot as the composer writes it: the
    // root links to the bot's DID (`we://mention`), the text says only "@<label>".
    const rootId = await postMentioning(fixture.composing.handle, fixture.channel.id, label, fixture.bot);

    // Woken, naming the post and the channel it is in.
    const { woken, why } = await fixture.deliver();
    expect(
      woken.map((m) => m.address),
      why,
    ).toContain(rootId);
    expect(woken.find((m) => m.address === rootId)?.parents, why).toContain(fixture.channel.id);
  });

  it.each(LABELS)(
    'is woken by a feed line that mentions it, labelled by $label',
    { timeout: 180_000 },
    async ({ name }) => {
      const fixture = await botWithWaker();
      const label = name(fixture.bot);

      // A line in the channel's feed, as a module writes one through the host (`createEntity`):
      // the text and its marks, then the line linked to everyone its marks mention
      // (`linkNewMentions`). The text holds the label the picker showed, never the DID.
      const mention = `@${label}`;
      const text = `${mention} can you look at this?`;
      expect(text).not.toContain(fixture.bot);
      const marks = [{ start: 0, end: Array.from(mention).length, type: 'mention' as const, did: fixture.bot }];
      const line = (await TextBlock.create(
        fixture.composing.handle as never,
        { text, marks: serializeMarks(marks) } as never,
        { parent: { id: fixture.channel.id, relation: 'children', entity: 'CollectionBlock' } },
      )) as { id: string };
      expect(line?.id).toBeTruthy();
      await TextBlock.addRelation(fixture.composing.handle as never, line.id, 'mentions', fixture.bot);

      // Woken, naming the line and the channel it is in.
      const { woken, why } = await fixture.deliver();
      expect(
        woken.map((m) => m.address),
        why,
      ).toContain(line.id);
      expect(woken.find((m) => m.address === line.id)?.parents, why).toContain(fixture.channel.id);
    },
  );

  it('is not woken by its own post that mentions it', { timeout: 180_000 }, async () => {
    const fixture = await botWithWaker();

    // The bot posts into a channel of the watched neighbourhood itself, mentioning itself: the
    // `we://mention` link to its DID is its own.
    const ownChannel = (await CollectionBlock.create(fixture.watched.handle as never, {
      kind: 'channel',
      title: 'own',
    })) as { id: string };
    const ownRoot = await postMentioning(fixture.watched.handle, ownChannel.id, 'Data', fixture.bot);
    await new Promise((r) => setTimeout(r, 3_000));

    // Then a person mentions it, so the waker is shown to be listening.
    const theirRoot = await postMentioning(fixture.composing.handle, fixture.channel.id, 'Data', fixture.bot);
    const { woken, why } = await fixture.deliver();
    const addresses = woken.map((m) => m.address);
    expect(addresses, why).toContain(theirRoot);
    expect(addresses, why).not.toContain(ownRoot);
  });
});
