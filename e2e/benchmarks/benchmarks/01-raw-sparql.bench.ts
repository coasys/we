/**
 * Spec 1: Raw SPARQL benchmarks — headless, no browser.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { setupExecutor, teardownExecutor } from '../fixtures/executor-setup';
import type { ExecutorContext } from '../fixtures/executor-setup';
import { seedPerspective, measure, DEFAULT_SCALE } from '../helpers';
import type { SeedManifest } from '../helpers';
import { BenchmarkResult, writeReport, formatMarkdownTable } from '../helpers/reporter';
import {
  ENTRY_TYPE, BODY, CHANNEL_MESSAGE, CHANNEL_CONVERSATION,
  CONVERSATION_SUBGROUP, SUBGROUP_ITEM, HAS_REPLY, REACTION,
  MESSAGE_THREAD, FLUX_PARTICIPANT, EntryType,
} from '../models/predicates';

const ITERATIONS = 10;
const results: BenchmarkResult[] = [];

function record(name: string, samples: number[], stats: any, transport: string) {
  results.push({ name, spec: '01-raw-sparql', transport, samples, stats });
}

let executor: ExecutorContext;
let manifest: SeedManifest | null = null;

async function ensureSeeded() {
  if (manifest) return manifest;
  console.log('Seeding perspective with ~100k links...');
  manifest = await seedPerspective(executor.client, executor.perspectiveUuid, DEFAULT_SCALE, 42, (inserted, total) => {
    if (inserted % 10000 === 0 || inserted === total) console.log(`  Seeded ${inserted}/${total} links`);
  });
  console.log(`Seeding complete: ${manifest.totalLinks} links inserted`);
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

describe('Raw SPARQL @ 100k links', () => {
  test('1. SELECT all messages in a channel', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT ?msg ?body WHERE {
      <${channelId}> <${CHANNEL_MESSAGE}> ?msg .
      ?msg <${ENTRY_TYPE}> <${EntryType.Message}> .
      ?msg <${BODY}> ?body .
    }`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('SELECT messages in channel', samples, stats, executor.client.transport);
  });

  test('2. COUNT messages in a channel', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT (COUNT(DISTINCT ?msg) AS ?count) WHERE {
      <${channelId}> <${CHANNEL_MESSAGE}> ?msg .
      ?msg <${ENTRY_TYPE}> <${EntryType.Message}> .
    }`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('COUNT messages in channel', samples, stats, executor.client.transport);
  });

  test('3. Multi-join: channel → conversation → subgroups', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT ?conv ?sg ?sgItem WHERE {
      <${channelId}> <${CHANNEL_CONVERSATION}> ?conv .
      ?conv <${CONVERSATION_SUBGROUP}> ?sg .
      ?sg <${SUBGROUP_ITEM}> ?sgItem .
    }`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('Multi-join: ch→conv→sg→items', samples, stats, executor.client.transport);
  });

  test('4. OPTIONAL joins (messages with optional reactions)', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT ?msg ?body ?reaction WHERE {
      <${channelId}> <${CHANNEL_MESSAGE}> ?msg .
      ?msg <${BODY}> ?body .
      OPTIONAL { ?msg <${REACTION}> ?reaction . }
    } LIMIT 500`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('OPTIONAL: msgs + reactions', samples, stats, executor.client.transport);
  });

  test('5. FILTER with IN clause', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT ?item ?type WHERE {
      <${channelId}> <${CHANNEL_MESSAGE}> ?item .
      ?item <${ENTRY_TYPE}> ?type .
      FILTER(?type IN (<${EntryType.Message}>, <${EntryType.Post}>, <${EntryType.Task}>))
    }`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('FILTER IN (entry types)', samples, stats, executor.client.transport);
  });

  test('6. Conversation participants (multi-hop)', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT DISTINCT ?conv ?participant WHERE {
      <${channelId}> <${CHANNEL_CONVERSATION}> ?conv .
      ?conv <${FLUX_PARTICIPANT}> ?participant .
    }`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('Conversation participants', samples, stats, executor.client.transport);
  });

  test('7. Thread depth traversal', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT ?msg ?threadReply ?body WHERE {
      <${channelId}> <${CHANNEL_MESSAGE}> ?msg .
      ?msg <${MESSAGE_THREAD}> ?threadReply .
      ?threadReply <${BODY}> ?body .
    } LIMIT 200`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('Thread depth traversal', samples, stats, executor.client.transport);
  });

  test('8. Full channel load (allItems pattern)', async () => {
    const m = await ensureSeeded();
    const channelId = m.channelIds[0];
    const query = `SELECT ?id ?type ?body WHERE {
      <${channelId}> <${CHANNEL_MESSAGE}> ?id .
      ?id <${ENTRY_TYPE}> ?type .
      FILTER(?type IN (<${EntryType.Message}>, <${EntryType.Post}>, <${EntryType.Task}>))
      OPTIONAL { ?id <${BODY}> ?body . }
    } ORDER BY ?id`;
    const { samples, stats } = await measure(async () => {
      const result = await executor.client.querySparql(executor.perspectiveUuid, query);
      expect(result).toBeTruthy();
    }, ITERATIONS);
    record('Full channel load (allItems)', samples, stats, executor.client.transport);
  });
});
