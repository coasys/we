/**
 * pnpm verify:ad4m — checks `ad4mCapabilities` against a real executor.
 *
 * Every entry in `ad4mCapabilities` is a claim about the executor, and the planner believes it:
 * a claimed feature is pushed down, and if the executor answers it wrongly the result is wrong
 * rows with no error. The unit tests cannot catch that, because they only exercise the planner.
 *
 * So this seeds one small tree of records into a throwaway perspective, and the same records into
 * the in-memory engine (`executeQueryIR`, WE's reference implementation of the query IR). Then it
 * runs one query per capability against both, and compares:
 *
 *   holds                   claimed, and the executor agrees with the reference
 *   claimed but fails       claimed, and it does not. Do not merge the bump.
 *   not claimed, works      the executor could do more than WE asks of it. Consider claiming it.
 *   not claimed             not claimed, and it does not work. Nothing to do.
 *
 * By default it starts its own executor in a temporary directory and removes both afterwards:
 *
 *   pnpm verify:ad4m                              # ../ad4m/target/release/ad4m-executor
 *   pnpm verify:ad4m --executor <path>
 *   pnpm verify:ad4m --port 12000 --token <cred>  # an executor already running, agent unlocked
 *
 * Build the executor from the commit the pinned @coasys/ad4m was published from; the release
 * workflow does the same (`npm view @coasys/ad4m@<pin> gitHead`).
 *
 * Live queries (`live: 'push'`) are not checked: a subscription needs a second writer and a wait,
 * which is a different kind of test.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ad4mClient, type Ad4mModel, type PerspectiveProxy } from '@coasys/ad4m';
import {
  ad4mCapabilities,
  buildEntityFromEntry,
  createAd4mQueryAdapter,
  type EntityManifestEntry,
} from '@we/backend-ad4m';
import { executeQueryIR, type InMemoryDataset, planQuery, type QueryIR, type Row } from '@we/backend-shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

// ── Arguments ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const givenPort = arg('port') ?? process.env.AD4M_PORT;
const givenToken = arg('token') ?? process.env.AD4M_TOKEN;
const executorPath = resolve(
  arg('executor') ?? process.env.AD4M_EXECUTOR ?? join(REPO, '..', 'ad4m', 'target', 'release', 'ad4m-executor'),
);

// ── The records ────────────────────────────────────────────────────────────
//
//   A ─┬─ C ─┬─ E        B ── G        H
//      │     └─ F
//      └─ D
//
// Ranks are distinct so every sorted answer has exactly one right order. Two groups give a
// relation to sort by; `note` is set on only two items so `exists` has something to tell apart.

const P = 'we-verify://';
const ENTRIES: EntityManifestEntry[] = [
  {
    name: 'VerifyGroup',
    targetClass: `${P}group`,
    properties: [
      { name: 'name', predicate: `${P}name`, type: 'string', isCollection: false, required: true, writable: true },
    ],
  },
  {
    name: 'VerifyItem',
    targetClass: `${P}item`,
    properties: [
      { name: 'title', predicate: `${P}title`, type: 'string', isCollection: false, required: true, writable: true },
      { name: 'rank', predicate: `${P}rank`, type: 'number', isCollection: false, required: true, writable: true },
      { name: 'tag', predicate: `${P}tag`, type: 'string', isCollection: false, required: false, writable: true },
      { name: 'note', predicate: `${P}note`, type: 'string', isCollection: false, required: false, writable: true },
      {
        name: 'children',
        predicate: `${P}child`,
        type: 'uri',
        isCollection: true,
        required: false,
        writable: true,
        relatedEntity: 'VerifyItem',
      },
      {
        name: 'group',
        predicate: `${P}in_group`,
        type: 'uri',
        isCollection: false,
        required: false,
        writable: true,
        relatedEntity: 'VerifyGroup',
      },
    ],
  },
];

type Seed = {
  key: string;
  title: string;
  rank: number;
  tag: string;
  group: 'alpha' | 'beta';
  parent?: string;
  note?: string;
};
const ITEMS: Seed[] = [
  { key: 'A', title: 'apple', rank: 1, tag: 'red', group: 'beta', note: 'first' },
  { key: 'B', title: 'banana', rank: 2, tag: 'yellow', group: 'alpha', note: 'second' },
  { key: 'C', title: 'cherry', rank: 3, tag: 'red', group: 'alpha', parent: 'A' },
  { key: 'D', title: 'date', rank: 4, tag: 'brown', group: 'beta', parent: 'A' },
  { key: 'E', title: 'elder', rank: 5, tag: 'red', group: 'alpha', parent: 'C' },
  { key: 'F', title: 'fig', rank: 6, tag: 'green', group: 'beta', parent: 'C' },
  { key: 'G', title: 'grape', rank: 7, tag: 'green', group: 'alpha', parent: 'B' },
  { key: 'H', title: 'guava', rank: 8, tag: 'red', group: 'beta' },
];

// ── The cases ──────────────────────────────────────────────────────────────
//
// `compare` says what must agree: the ids as a set, the ids in order, or one field per row in
// order (for sorts whose ties make the order of ids legitimately unspecified).

type Compare = 'set' | 'order' | { field: string } | { counts: string } | { children: true };
interface Case {
  name: string;
  ir: (k: Record<string, string>) => Omit<QueryIR, 'irVersion' | 'entity'>;
  compare: Compare;
}

const byRank = [{ by: 'rank', dir: 'asc' as const }];
const CASES: Case[] = [
  { name: 'operator: eq', ir: () => ({ filter: { field: 'tag', op: 'eq', value: 'red' } }), compare: 'set' },
  { name: 'operator: ne', ir: () => ({ filter: { field: 'tag', op: 'ne', value: 'red' } }), compare: 'set' },
  { name: 'operator: lt (number)', ir: () => ({ filter: { field: 'rank', op: 'lt', value: 4 } }), compare: 'set' },
  { name: 'operator: lte (number)', ir: () => ({ filter: { field: 'rank', op: 'lte', value: 4 } }), compare: 'set' },
  { name: 'operator: gt (number)', ir: () => ({ filter: { field: 'rank', op: 'gt', value: 4 } }), compare: 'set' },
  { name: 'operator: gte (number)', ir: () => ({ filter: { field: 'rank', op: 'gte', value: 4 } }), compare: 'set' },
  {
    name: 'operator: in',
    ir: () => ({ filter: { field: 'tag', op: 'in', value: ['green', 'brown'] } }),
    compare: 'set',
  },
  {
    name: 'operator: nin',
    ir: () => ({ filter: { field: 'tag', op: 'nin', value: ['green', 'brown'] } }),
    compare: 'set',
  },
  {
    name: 'operator: contains (ignores case)',
    ir: () => ({ filter: { field: 'title', op: 'contains', value: 'AN' } }),
    compare: 'set',
  },
  {
    name: 'operator: startsWith',
    ir: () => ({ filter: { field: 'title', op: 'startsWith', value: 'gu' } }),
    compare: 'set',
  },
  {
    name: 'operator: endsWith',
    ir: () => ({ filter: { field: 'title', op: 'endsWith', value: 'e' } }),
    compare: 'set',
  },
  {
    name: 'operator: exists',
    ir: () => ({ filter: { field: 'note', op: 'exists', value: true } }),
    compare: 'set',
  },
  {
    name: 'range bound: string',
    ir: () => ({ filter: { field: 'title', op: 'gte', value: 'd' } }),
    compare: 'set',
  },
  {
    name: 'booleans: or',
    ir: () => ({
      filter: {
        or: [
          { field: 'tag', op: 'eq', value: 'green' },
          { field: 'rank', op: 'lt', value: 2 },
        ],
      },
    }),
    compare: 'set',
  },
  {
    name: 'booleans: and',
    ir: () => ({
      filter: {
        and: [
          { field: 'tag', op: 'eq', value: 'red' },
          { field: 'rank', op: 'gt', value: 2 },
        ],
      },
    }),
    compare: 'set',
  },
  {
    name: 'booleans: not',
    ir: () => ({ filter: { not: { field: 'tag', op: 'eq', value: 'red' } } }),
    compare: 'set',
  },
  {
    name: 'relation filter: some',
    ir: () => ({ filter: { rel: 'children', op: 'some', where: { field: 'tag', op: 'eq', value: 'red' } } }),
    compare: 'set',
  },
  {
    name: 'relation filter: none',
    ir: () => ({ filter: { rel: 'children', op: 'none' } }),
    compare: 'set',
  },
  {
    name: 'scope: one anchor',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.A } }),
    compare: 'set',
  },
  {
    name: 'traversal: several anchors',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: [k.A, k.B] } }),
    compare: 'set',
  },
  {
    name: 'traversal: transitive',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.A, transitive: true } }),
    compare: 'set',
  },
  {
    name: 'traversal: inbound',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.C, direction: 'in' } }),
    compare: 'set',
  },
  {
    name: 'traversal: limit per anchor',
    ir: (k) => ({
      scope: { anchor: 'VerifyItem', via: 'children', anchorId: [k.A, k.C], limitPerAnchor: 1 },
      sort: byRank,
    }),
    compare: 'set',
  },
  {
    name: 'traversal: level walk',
    ir: (k) => ({ scope: { anchor: 'VerifyItem', via: 'children', anchorId: k.A, levels: [1, 1] }, sort: byRank }),
    compare: 'set',
  },
  { name: 'include', ir: () => ({ include: { children: true } }), compare: { children: true } },
  {
    name: 'aggregate: count',
    ir: () => ({ aggregate: [{ as: '$childCount', over: 'children', fn: 'count' }] }),
    compare: { counts: '$childCount' },
  },
  {
    name: 'aggregate: sum',
    ir: () => ({ aggregate: [{ as: '$rankSum', over: 'children', fn: 'sum', field: 'rank' }] }),
    compare: { counts: '$rankSum' },
  },
  { name: 'sort: one key', ir: () => ({ sort: [{ by: 'rank', dir: 'desc' }] }), compare: 'order' },
  {
    name: 'sort: several keys',
    ir: () => ({
      sort: [
        { by: 'tag', dir: 'asc' },
        { by: 'rank', dir: 'desc' },
      ],
    }),
    compare: 'order',
  },
  {
    name: 'sort: by relation path',
    ir: () => ({ sort: [{ by: 'group.name', dir: 'desc' }], page: { limit: 8 } }),
    compare: { field: 'groupName' },
  },
  {
    name: 'sort: by aggregate',
    ir: () => ({
      aggregate: [{ as: '$childCount', over: 'children', fn: 'count' }],
      sort: [{ by: '$childCount', dir: 'desc' }],
      page: { limit: 8 },
    }),
    compare: { field: '$childCount' },
  },
  {
    name: 'pagination: offset',
    ir: () => ({ sort: byRank, page: { limit: 3, offset: 2 } }),
    compare: 'order',
  },
];

// ── Comparing ──────────────────────────────────────────────────────────────

type Outcome = 'holds' | 'claimed but fails' | 'not claimed, works' | 'not claimed';

const idOf = (row: unknown) => String((row as { id?: unknown }).id ?? row);

function project(rows: Row[], compare: Compare, groupNames: Map<string, string>): unknown {
  if (compare === 'set') return rows.map(idOf).sort();
  if (compare === 'order') return rows.map(idOf);
  if ('children' in compare) {
    return Object.fromEntries(rows.map((r) => [idOf(r), ((r.children as unknown[]) ?? []).map(idOf).sort()]).sort());
  }
  if ('counts' in compare) {
    return Object.fromEntries(rows.map((r) => [idOf(r), Number(r[compare.counts] ?? 0)]).sort());
  }
  if (compare.field === 'groupName') {
    return rows.map((r) => groupNames.get(String(r.group ?? r.groupId)) ?? null);
  }
  return rows.map((r) => r[compare.field] ?? null);
}

// ── The executor ───────────────────────────────────────────────────────────

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.unref();
    server.on('error', fail);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function startExecutor(): Promise<{ port: number; token: string; stop: () => Promise<void> }> {
  if (!existsSync(executorPath)) {
    throw new Error(
      `No executor at ${executorPath}. Build one (cargo build --release --bin ad4m-executor in ad4m), ` +
        'pass --executor <path>, or point at a running one with --port and --token.',
    );
  }
  const dataPath = mkdtempSync(join(tmpdir(), 'we-verify-ad4m-'));
  const init = spawnSync(executorPath, ['init', '--data-path', dataPath], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`executor init failed:\n${init.stderr || init.stdout}`);

  const port = await freePort();
  const token = randomBytes(16).toString('hex');
  // Nothing here needs the network: a local perspective is answered by the executor alone.
  const child: ChildProcess = spawn(
    executorPath,
    [
      'run',
      '--port',
      String(port),
      '--app-data-path',
      dataPath,
      '--run-dapp-server',
      'false',
      '--hc-use-bootstrap',
      'false',
      '--hc-use-proxy',
      'false',
      '--hc-use-mdns',
      'false',
    ],
    { env: { ...process.env, AD4M_ADMIN_CREDENTIAL: token }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));
  let stopping = false;
  child.on('exit', (code) => {
    if (code && !stopping) console.error(`\nexecutor exited with ${code}:\n${stderr}`);
  });

  return {
    port,
    token,
    // Removes the directory only once the executor has gone: it writes while shutting down, and a
    // directory removed before that is recreated behind it.
    stop: async () => {
      stopping = true;
      if (child.exitCode === null) {
        const exited = new Promise((done) => child.once('exit', done));
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000))]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      rmSync(dataPath, { recursive: true, force: true });
    },
  };
}

/**
 * Resolves once something accepts connections on the port. The client has to wait for this: one
 * made before the executor listens gets a socket error and then waits forever on its first call,
 * rather than failing it.
 */
async function waitForPort(port: number): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const open = await new Promise<boolean>((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => (socket.destroy(), done(true)));
      socket.once('error', () => (socket.destroy(), done(false)));
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`nothing listened on port ${port} within three minutes`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function withTimeout<T>(what: string, promise: Promise<T>, ms = 60_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, fail) =>
      setTimeout(() => fail(new Error(`${what} did not answer within ${ms / 1000}s`)), ms),
    ),
  ]);
}

async function readyAgent(client: Ad4mClient): Promise<void> {
  const status = await withTimeout('agent.status', client.agent.status());
  if (!status.isInitialized) await withTimeout('agent.generate', client.agent.generate('we-verify'), 180_000);
  else if (!status.isUnlocked)
    throw new Error('the agent is locked. Unlock it, or let this script start its own executor.');
}

// ── Seeding ────────────────────────────────────────────────────────────────

type ModelClass = typeof Ad4mModel & {
  create(p: PerspectiveProxy, data: Record<string, unknown>, opts?: unknown): Promise<{ id: string }>;
  findAll(p: PerspectiveProxy, opts?: unknown): Promise<Row[]>;
};

async function seed(perspective: PerspectiveProxy, Group: ModelClass, Item: ModelClass) {
  const groups: Record<string, string> = {};
  for (const name of ['alpha', 'beta']) groups[name] = (await Group.create(perspective, { name })).id;

  const keys: Record<string, string> = {};
  for (const s of ITEMS) {
    const data: Record<string, unknown> = { title: s.title, rank: s.rank, tag: s.tag, group: groups[s.group] };
    if (s.note) data.note = s.note;
    // ITEMS lists every parent before its children, so the parent's id is already known.
    const opts = s.parent ? { parent: { id: keys[s.parent], predicate: `${P}child` } } : undefined;
    keys[s.key] = (await Item.create(perspective, data, opts)).id;
  }

  // The same records, for the reference engine. A to-many relation is a foreign key on the child
  // there, and a to-one relation a foreign key on the row itself.
  const dataset: InMemoryDataset = {
    tables: {
      VerifyGroup: Object.entries(groups).map(([name, id]) => ({ id, name })),
      VerifyItem: ITEMS.map((s) => ({
        id: keys[s.key],
        title: s.title,
        rank: s.rank,
        tag: s.tag,
        groupId: groups[s.group],
        parentId: s.parent ? keys[s.parent] : null,
        ...(s.note ? { note: s.note } : {}),
      })),
    },
    relations: {
      VerifyItem: {
        children: { target: 'VerifyItem', cardinality: 'many', foreignKey: 'parentId' },
        group: { target: 'VerifyGroup', cardinality: 'one', foreignKey: 'groupId' },
      },
    },
  };
  const groupNames = new Map(Object.entries(groups).map(([name, id]) => [id, name]));
  return { keys, dataset, groupNames };
}

// ── Run ────────────────────────────────────────────────────────────────────

async function main() {
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const pins = root.pnpm?.overrides ?? {};
  console.log(`Pinned: @coasys/ad4m ${pins['@coasys/ad4m']}, @coasys/ad4m-connect ${pins['@coasys/ad4m-connect']}`);
  if (pins['@coasys/ad4m'] !== pins['@coasys/ad4m-connect']) {
    console.log('  The two pins differ. The app talks through the SDK inside ad4m-connect, so check both.');
  }

  const own = givenPort && givenToken ? null : await startExecutor();
  const port = Number(givenPort ?? own!.port);
  const token = givenToken ?? own!.token;
  if (own) console.log(`Started an executor from ${executorPath} on port ${port}`);

  await waitForPort(port);
  const client = new Ad4mClient(`http://localhost:${port}`, token);
  let perspective: PerspectiveProxy | undefined;
  try {
    await readyAgent(client);
    console.log('Agent ready');
    const info = await client.runtime.info().catch(() => null);
    if (info)
      console.log(`Executor: ${(info as { ad4mExecutorVersion?: string }).ad4mExecutorVersion ?? 'unknown version'}`);

    perspective = await withTimeout('perspective.add', client.perspective.add(`we-verify-${Date.now()}`));
    const flag = (value: string) => ({ through: 'ad4m://type', value });
    const classes: Record<string, ModelClass> = {};
    const resolveClass = (name: string) => classes[name];
    classes.VerifyGroup = buildEntityFromEntry(ENTRIES[0], { flag: flag(`${P}group`) }) as ModelClass;
    classes.VerifyItem = buildEntityFromEntry(ENTRIES[1], {
      flag: flag(`${P}item`),
      classResolver: resolveClass,
    }) as ModelClass;
    await perspective.ensureSDNASubjectClass(classes.VerifyGroup);
    await perspective.ensureSDNASubjectClass(classes.VerifyItem);

    const { keys, dataset, groupNames } = await withTimeout(
      'seeding',
      seed(perspective, classes.VerifyGroup, classes.VerifyItem),
    );
    console.log(`Seeded ${ITEMS.length} records`);
    const adapter = createAd4mQueryAdapter(() => ENTRIES);

    const results: { name: string; outcome: Outcome; detail?: string }[] = [];
    for (const c of CASES) {
      const ir: QueryIR = { irVersion: 1, entity: 'VerifyItem', ...c.ir(keys) };
      const gaps = planQuery(ir, ad4mCapabilities).gaps;
      const claimed = gaps.length === 0;

      const expected = project(executeQueryIR(ir, dataset) as Row[], c.compare, groupNames);
      let actual: unknown;
      let error: string | undefined;
      try {
        const rows = await withTimeout(c.name, classes.VerifyItem.findAll(perspective, adapter.lower(ir)), 30_000);
        actual = project(rows, c.compare, groupNames);
      } catch (e) {
        error = e instanceof Error ? e.message.split('\n')[0] : String(e);
      }

      const agrees = !error && JSON.stringify(actual) === JSON.stringify(expected);
      const outcome: Outcome = claimed
        ? agrees
          ? 'holds'
          : 'claimed but fails'
        : agrees
          ? 'not claimed, works'
          : 'not claimed';
      // Ids back to the letters in the diagram above, so a failure can be read.
      const letters = (value: unknown) =>
        Object.entries(keys).reduce((text, [key, id]) => text.split(id).join(key), JSON.stringify(value));
      const detail =
        outcome === 'holds' || outcome === 'not claimed, works'
          ? undefined
          : error
            ? `error: ${error}`
            : `expected ${letters(expected)}, got ${letters(actual)}`;
      results.push({ name: c.name, outcome, detail });
    }

    const width = Math.max(...results.map((r) => r.name.length));
    console.log('');
    for (const r of results) {
      const mark = { holds: '✓', 'claimed but fails': '✗', 'not claimed, works': '+', 'not claimed': '·' }[r.outcome];
      console.log(`${mark} ${r.name.padEnd(width)}  ${r.outcome}`);
      if (r.outcome === 'claimed but fails' && r.detail) console.log(`    ${r.detail}`);
    }
    console.log('\n(live queries are not checked)');

    const failed = results.filter((r) => r.outcome === 'claimed but fails');
    const extra = results.filter((r) => r.outcome === 'not claimed, works');
    if (extra.length) {
      console.log(
        `\n${extra.length} not claimed but working: consider claiming them in ad4mCapabilities, in a PR of their own.`,
      );
    }
    if (failed.length) {
      console.log(`\n✗ ${failed.length} claimed capabilities do not hold. Do not merge the bump.`);
      process.exitCode = 1;
    } else {
      console.log('\n✓ Every claimed capability holds.');
    }
  } finally {
    if (perspective) await client.perspective.remove(perspective.uuid).catch(() => undefined);
    await own?.stop();
    // The client keeps a socket open; nothing else is pending once the report is written.
    setTimeout(() => process.exit(), 200).unref();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
