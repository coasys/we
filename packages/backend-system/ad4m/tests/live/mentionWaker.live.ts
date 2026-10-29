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
 * - a line in the channel's feed, written the way a module write is (`TextBlock` and its `mentions`
 *   relation): woken, naming the line;
 * - the bot's own feed line naming itself: not woken;
 * - a known gap: a post into a channel through WE's own create path (`createBlocks`, which is what
 *   `spaceStore.createPost` calls) is not woken yet. Its mention link is on the root, which has no
 *   text of its own, so the root is not a TextContent record; the case pins that until it is.
 *
 * The name in the text is made up for the run, so it is in no profile the executor could know the
 * bot by. The bot's own profile is never written: an executor already running (`AD4M_LIVE_URL`) is
 * somebody's agent, and the last case checks its profile is left as it was found.
 *
 * The person is a second agent. The mention query skips links the bot wrote itself (a bot naming
 * itself in a reply is not a mention of it), so the post has to arrive authored by someone else —
 * which is what neighbourhood sync delivers. The post is composed in a scratch perspective, and
 * every link it wrote is replayed into the watched one signed by the person's own `did:key`, exactly
 * as synced links arrive: `addLinkExpression` stores a link under the author it claims, and the
 * mention query reads only links whose signature verifies.
 */
import { createHash, generateKeyPairSync, randomUUID, sign as signBytes } from 'node:crypto';

import {
  Ad4mClient,
  LinkExpression,
  LinkQuery,
  type MentionMessage,
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

let backend: Promise<{ client: Ad4mClient; ports: BackendPorts; bot: string; profile: string }> | undefined;

/** The agent's public profile, as text to compare. */
async function profileOf(client: Ad4mClient): Promise<string> {
  const links = (await client.agent.me()).perspective?.links ?? [];
  return JSON.stringify(links.map((l) => [l.data.source, l.data.predicate ?? null, l.data.target]).sort());
}

function connect() {
  backend ??= (async () => {
    const { url, token, disposable } = inject('ad4mExecutor');
    const client = new Ad4mClient(url, token);
    const bot = (await client.agent.me()).did;
    // Only an agent this run created is written to: it gets a profile, so that the profile check
    // below compares something. One already running is somebody's, and its profile is only read.
    if (disposable)
      await client.agent.mutatePublicPerspective({
        additions: [{ source: bot, predicate: 'sioc://has_name', target: 'literal:string:Data' }],
        removals: [],
      });
    const profile = await profileOf(client);
    return { client, ports: createAd4mBackendPorts(client, { selfId: () => bot }), bot, profile };
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

/** A name made up for this run, so no profile holds it. */
const UNKNOWN_NAME = `Nobody${randomUUID().slice(0, 8)}`;

/**
 * What the text says where the bot is mentioned: whatever WE's picker showed for it. Neither is a
 * name the executor knows the bot by: the first is in no profile, the second is not the DID.
 */
const LABELS: { label: string; name: (bot: string) => string }[] = [
  { label: 'a name in no profile', name: () => UNKNOWN_NAME },
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

/**
 * A line in `channelId`'s feed, as a module writes one through the host (`createEntity`): the text
 * and its marks, then the line linked to everyone its marks mention (`linkNewMentions`). The text
 * holds the label the picker showed, never the DID.
 */
async function lineMentioning(handle: unknown, channelId: string, name: string, did: string) {
  const mention = `@${name}`;
  const text = `${mention} can you look at this?`;
  expect(text).not.toContain(did);
  const marks = [{ start: 0, end: Array.from(mention).length, type: 'mention' as const, did }];
  const line = (await TextBlock.create(handle as never, { text, marks: serializeMarks(marks) } as never, {
    parent: { id: channelId, relation: 'children', entity: 'CollectionBlock' },
  })) as { id: string };
  expect(line?.id).toBeTruthy();
  await TextBlock.addRelation(handle as never, line.id, 'mentions', did);
  return line.id;
}

/** The bot, its waker opened on a fresh watched space, and a space a person composes in. */
async function botWithWaker() {
  const { client, ports, bot } = await connect();
  const { mcpUrl, token } = inject('ad4mExecutor');
  if (!mcpUrl) throw new Error('This test needs the executor’s MCP endpoint (AD4M_LIVE_MCP_URL).');
  const callTool = await mcpSession(mcpUrl, token);

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
    did?: string;
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
    ...(config.did ? { did: config.did } : {}),
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
     * person's own signature, as sync delivers it; then the bot's wakes, 1 s after the first one came, or none after 30 s.
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
      // Ten debounce windows more, so a wrong wake that came after the first one is seen too.
      if (wakes.length) await new Promise((r) => setTimeout(r, 1_000));
      return { woken: wakes.flat(), why: `config: ${JSON.stringify(config)}` };
    },
  };
}

describe('a bot @mentioned in a WE channel', () => {
  it.each(LABELS)(
    'is woken by a feed line that mentions it, labelled by $label',
    { timeout: 180_000 },
    async ({ name }) => {
      const fixture = await botWithWaker();
      const lineId = await lineMentioning(fixture.composing.handle, fixture.channel.id, name(fixture.bot), fixture.bot);

      // Woken, naming the line and the channel it is in.
      const { woken, why } = await fixture.deliver();
      expect(
        woken.map((m) => m.address),
        why,
      ).toContain(lineId);
      expect(woken.find((m) => m.address === lineId)?.parents, why).toContain(fixture.channel.id);
    },
  );

  // Known gap, kept as a test so the follow-up turns it around: a post's `we://mention` link sits
  // on its root, which has no `text` of its own (the words are in child blocks), so the root is
  // not a TextContent record and the executor's mention query does not read it. A feed line in
  // the same delivery is the control that the waker is listening.
  it(
    'is not yet woken by a post whose only mention is the link on its root (known gap)',
    { timeout: 180_000 },
    async () => {
      const fixture = await botWithWaker();
      const rootId = await postMentioning(fixture.composing.handle, fixture.channel.id, UNKNOWN_NAME, fixture.bot);
      const lineId = await lineMentioning(fixture.composing.handle, fixture.channel.id, UNKNOWN_NAME, fixture.bot);

      const { woken, why } = await fixture.deliver();
      const addresses = woken.map((m) => m.address);
      expect(addresses, why).toContain(lineId);
      expect(addresses, why).not.toContain(rootId);
    },
  );

  it('is not woken by its own feed line that mentions it', { timeout: 180_000 }, async () => {
    const fixture = await botWithWaker();

    // The bot writes a line into a channel of the watched neighbourhood itself, mentioning itself:
    // the `we://mention` link to its DID is its own. A feed line, as the person's below is, so the
    // only thing keeping it from waking the bot is who wrote it — a post root would not wake it
    // whoever wrote it (the known gap above).
    const ownChannel = (await CollectionBlock.create(fixture.watched.handle as never, {
      kind: 'channel',
      title: 'own',
    })) as { id: string };
    const ownLine = await lineMentioning(fixture.watched.handle, ownChannel.id, UNKNOWN_NAME, fixture.bot);
    await new Promise((r) => setTimeout(r, 3_000));

    // Then a person mentions it in a feed line, so the waker is shown to be listening.
    const theirLine = await lineMentioning(fixture.composing.handle, fixture.channel.id, UNKNOWN_NAME, fixture.bot);
    const { woken, why } = await fixture.deliver();
    const addresses = woken.map((m) => m.address);
    expect(addresses, why).toContain(theirLine);
    expect(addresses, why).not.toContain(ownLine);
  });

  it('leaves the agent’s public profile as it found it', async () => {
    const { client, profile } = await connect();
    expect(await profileOf(client)).toBe(profile);
  });
});
