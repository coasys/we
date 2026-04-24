/**
 * Spec 2: Ad4mModel ORM benchmarks — exercises the REAL SDK query pipeline.
 *
 * This is where feat/architectural-optimisation changes should surface:
 *   - WS-1: SPARQL-level pagination subquery (limit/offset pushed to DB)
 *   - WS-2: Smart getter evaluation (property getters skipped unless deepQuery)
 *   - buildSPARQLCountQuery (efficient COUNT without hydration)
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { setupExecutor, teardownExecutor } from '../fixtures/executor-setup';
import type { ExecutorContext } from '../fixtures/executor-setup';
import { seedPerspective, DEFAULT_SCALE, measure } from '../helpers';
import type { SeedManifest } from '../helpers';
import { BenchmarkResult, writeReport, formatMarkdownTable } from '../helpers/reporter';
import { Channel } from '../models/channel';
import { Message } from '../models/message';
import { Conversation } from '../models/conversation';
import { ConversationSubgroup } from '../models/conversation-subgroup';

const ITERATIONS = 10;
const results: BenchmarkResult[] = [];

function record(name: string, samples: number[], stats: any, transport: string) {
  results.push({ name, spec: '02-ad4m-model', transport, samples, stats });
}

let executor: ExecutorContext;
let manifest: SeedManifest | null = null;
let modelsRegistered = false;

async function ensureSeeded() {
  if (manifest) return manifest;
  console.log('Seeding perspective for Ad4mModel ORM benchmarks...');
  manifest = await seedPerspective(executor.client, executor.perspectiveUuid, DEFAULT_SCALE, 42, (inserted, total) => {
    if (inserted % 10000 === 0 || inserted === total) console.log(`  Seeded ${inserted}/${total} links`);
  });
  console.log(`Seeding complete: ${manifest.totalLinks} links`);

  if (!modelsRegistered) {
    console.log('Registering Ad4mModel classes...');
    await Channel.register(executor.perspective);
    await Message.register(executor.perspective);
    await Conversation.register(executor.perspective);
    await ConversationSubgroup.register(executor.perspective);
    modelsRegistered = true;
    console.log('  ✓ Models registered');
  }
  return manifest;
}

beforeAll(async () => { executor = await setupExecutor(); });
afterAll(async () => {
  if (results.length > 0) {
    const filepath = await writeReport(results, manifest?.totalLinks ?? 0);
    console.log(`\nResults written to: ${filepath}`);
    console.log('\n' + formatMarkdownTable(results));
  }
  await teardownExecutor();
});

describe('Ad4mModel ORM @ 100k links', () => {
  test('1. Channel.get() — single entity hydration via ORM', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const { samples, stats } = await measure(async () => {
      const ch = new Channel(executor.perspective, channelId);
      await ch.get();
      expect(ch.name).toBeTruthy();
    }, ITERATIONS);
    record('Channel.get() — ORM hydration', samples, stats, executor.client.transport);
  });

  test('2. Channel.findAll() — list all channels via ORM', async () => {
    await ensureSeeded();
    const { samples, stats } = await measure(async () => {
      const channels = await Channel.findAll(executor.perspective);
      expect(channels.length).toBeGreaterThan(0);
    }, ITERATIONS);
    record('Channel.findAll() — list all', samples, stats, executor.client.transport);
  });

  test('3. Message.get() — single message hydration via ORM', async () => {
    const m = await ensureSeeded();
    const msgId = m.messageIds[0];
    const { samples, stats } = await measure(async () => {
      const msg = new Message(executor.perspective, msgId);
      await msg.get();
      expect(msg.body).toBeTruthy();
    }, ITERATIONS);
    record('Message.get() — ORM hydration', samples, stats, executor.client.transport);
  });

  test('4. Message.findAll() with parent Channel (2000 messages)', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const { samples, stats } = await measure(async () => {
      const messages = await Message.query(executor.perspective)
        .parent(channelId, Channel)
        .get();
      expect(messages.length).toBeGreaterThan(0);
    }, ITERATIONS);
    record('Message.findAll(parent: Channel)', samples, stats, executor.client.transport);
  });

  test('5. Conversation.findAll() with parent Channel', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const { samples, stats } = await measure(async () => {
      const convs = await Conversation.query(executor.perspective)
        .parent(channelId, Channel)
        .get();
      expect(convs.length).toBeGreaterThan(0);
    }, ITERATIONS);
    record('Conversation.findAll(parent: Channel)', samples, stats, executor.client.transport);
  });

  test('6. Conversation with include subgroups — nested eager load', async () => {
    const m = await ensureSeeded();
    const convId = m.conversationIds[0];
    const { samples, stats } = await measure(async () => {
      const conv = new Conversation(executor.perspective, convId);
      await conv.get({ include: { subgroupEntities: true } });
      expect(conv.subgroupEntities).toBeDefined();
    }, ITERATIONS);
    record('Conversation.get(include: subgroups)', samples, stats, executor.client.transport);
  });

  test('7. Channel.count() — efficient COUNT via ORM', async () => {
    await ensureSeeded();
    const { samples, stats } = await measure(async () => {
      const count = await Channel.count(executor.perspective);
      expect(count).toBeGreaterThan(0);
    }, ITERATIONS);
    record('Channel.count() — ORM', samples, stats, executor.client.transport);
  });

  test('8. Message.findAll() with limit + offset (pagination)', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const { samples, stats } = await measure(async () => {
      const page = await Message.query(executor.perspective)
        .parent(channelId, Channel)
        .limit(50)
        .offset(100)
        .get();
      expect(page.length).toBeLessThanOrEqual(50);
    }, ITERATIONS);
    record('Message.findAll(limit:50, offset:100)', samples, stats, executor.client.transport);
  });

  test('9. Full page load: channel.get + messages + conversations (parallel ORM)', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const { samples, stats } = await measure(async () => {
      const ch = new Channel(executor.perspective, channelId);
      const [_, msgs, convs] = await Promise.all([
        ch.get(),
        Message.query(executor.perspective).parent(channelId, Channel).limit(50).get(),
        Conversation.query(executor.perspective).parent(channelId, Channel).get(),
      ]);
      expect(ch.name).toBeTruthy();
      expect(msgs.length).toBeGreaterThan(0);
      expect(convs.length).toBeGreaterThan(0);
    }, ITERATIONS);
    record('Full page load (ORM, 3 parallel)', samples, stats, executor.client.transport);
  });

  test('10. Message.findAll(limit:10) — shallow vs deepQuery', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const { samples, stats } = await measure(async () => {
      const messages = await Message.query(executor.perspective)
        .parent(channelId, Channel)
        .limit(10)
        .get();
      expect(messages.length).toBeGreaterThan(0);
    }, ITERATIONS);
    record('Message.findAll(limit:10) shallow', samples, stats, executor.client.transport);
  });
});
