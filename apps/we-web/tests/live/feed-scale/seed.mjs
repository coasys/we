/**
 * A million messages in one space, generated into a file that the executor loads directly.
 *
 * ## What one message is
 *
 * Not written down here: read off a message the app itself wrote. The suite types one line into the
 * Feed's composer first, and {@link messageShape} takes the links that line made — the class flag, each
 * property the model writes with its default, and the space collection's `has_child` link to it. Every
 * seeded message is that shape with its own id, words, author and time, so a property the TextBlock
 * model gains tomorrow is seeded tomorrow without a change here. In ad4m `dev` today that is twelve
 * links a message: twelve million for a million messages.
 *
 * ## How it is written: a file, then `runtime.importData`
 *
 * Writing through the executor's write path (`perspective.addLinks` / `addLinkExpression`) took about
 * 1.7 hours for a million messages — the executor re-verified and re-persisted every link inside one
 * transaction loop. The suite instead generates every link already signed into a file in the format
 * of `runtime.exportData` (`{"links":[ <link>, ... ]}`) and asks `runtime.importData` to load it
 * straight into the space's perspective. Signing is the suite's work and scales with its cores;
 * the import is the executor's single bulk read of a file.
 *
 * - Every one of a message's links — the class flag, each property and the collection's `has_child`
 *   link — is signed here by the message's own author agent (`signer.mjs`), so the executor stores
 *   them verified under that author. A message's `author` and `createdAt` are those of its earliest
 *   link (ad4m `model_query/hydration.rs`): the flag is stamped at the message's time `atMs` and the
 *   rest at `atMs + 1`, so the flag stays earliest and the Feed reads the message as written by that
 *   person at that time.
 * - All links carry `status: "local"`: nothing is published to the neighbourhood's link language.
 *   This is not a sync test; what the Feed reads is the same either way.
 * - `runtime.importData` is operator-only, so it is called with the executor's admin credential, not
 *   the managed user's token. It can run for many minutes at a million messages, so it goes over the
 *   suite's own raw WebSocket (`writer.mjs`) which keeps no client-side timeout.
 *
 * ## How the file is generated
 *
 * The message range is split across `os.availableParallelism()` worker threads (`seed-worker.mjs`),
 * each writing its own part file; the main thread then streams `{"links":[` + parts + `]}` into one
 * file. Determinism is what makes the split safe: message `i`'s randomness is drawn from a generator
 * keyed by `(seed, i)` rather than one sequential stream, so a slice `i..j` is identical however the
 * range is divided, and the 40 author agents are rebuilt from `seed` in every worker
 * (`authorAgents`), so all workers sign as the same 40 people. Generation writes buffered chunks to
 * disk instead of building one large string in memory.
 */
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { makeAgent } from './signer.mjs';
import { openWriter } from './writer.mjs';

/** How many people the messages are spread over. */
export const AUTHORS = 40;

/** How far back the oldest message is: a year of conversation. */
export const SPAN_MS = 365 * 24 * 3_600_000;

/** The class flag of the space's message class, as the TextBlock model writes it. */
const FLAG = { predicate: 'we://flag', target: 'we://text_block' };
const TEXT = 'we://text';
const HAS_CHILD = 'ad4m://has_child';

/**
 * The links one message is made of, read off a message the app wrote: `id` is that message, `root`
 * the space collection it was written into. Throws when the message is not the shape the seeder
 * relies on — a class flag, its words, and its place in the collection — so a model change that moves
 * one of those fails here, loudly, rather than seeding something the Feed does not read.
 */
export function messageShape(links, id, root) {
  const own = links.filter((l) => l.data.source === id);
  const placed = links.filter((l) => l.data.target === id && l.data.source === root);
  const has = (p, t) => own.some((l) => l.data.predicate === p && (t === undefined || l.data.target === t));
  if (!has(FLAG.predicate, FLAG.target)) throw new Error(`message ${id} has no ${FLAG.target} flag`);
  if (!has(TEXT)) throw new Error(`message ${id} has no ${TEXT}`);
  if (placed.length !== 1 || placed[0].data.predicate !== HAS_CHILD) {
    throw new Error(`message ${id} is not in the space collection ${root} by ${HAS_CHILD}: ${JSON.stringify(placed)}`);
  }
  const properties = own
    .filter((l) => !(l.data.predicate === FLAG.predicate && l.data.target === FLAG.target))
    .map((l) => ({ predicate: l.data.predicate, target: l.data.predicate === TEXT ? null : l.data.target }));
  // One link per predicate: a property written twice would be seeded twice.
  const predicates = properties.map((p) => p.predicate);
  if (new Set(predicates).size !== predicates.length) {
    throw new Error(`message ${id} repeats a property: ${predicates}`);
  }
  return { root, properties, links: own.length + placed.length };
}

/** The predicate an auto-processor's config node holds its id by (ad4m `hardwired_sdna/auto_processor.json`). */
export const PROCESSOR_ID = 'ad4m://processor_id';

/**
 * The ids of the auto-processors registered in a perspective, from its `ad4m://processor_id` links.
 * The id is written as a string literal (`literal:string:<encoded>`); one written bare is read as is.
 */
export function processorIds(links) {
  const ids = links
    .filter((l) => l.data.predicate === PROCESSOR_ID)
    .map((l) => {
      const t = l.data.target;
      return t.startsWith('literal:string:') ? decodeURIComponent(t.slice('literal:string:'.length)) : t;
    });
  return [...new Set(ids)].sort();
}

/** A small, fast, seeded generator, so a run's messages are the same each time it is asked for. */
export function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4_294_967_296;
  };
}

const WORDS = (
  'the a we our team space call notes plan ship review fix test build release design docs feed board ' +
  'task bug idea draft today tomorrow monday after before during while with about for from into ' +
  'looks good agreed thanks question answer maybe later soon now done doing next blocked waiting ' +
  'merged deployed reverted pinned shared private public sync query index page scroll render load ' +
  'fast slow faster slower memory latency budget ceiling regression nightly runner host executor'
).split(' ');

/** The words of message `i`: 3 to 30 of them, a sentence's worth, numbered so each is findable. */
export function words(rand, i) {
  const n = 3 + Math.floor(rand() * 28);
  const out = [];
  for (let k = 0; k < n; k++) out.push(WORDS[Math.floor(rand() * WORDS.length)]);
  return `${out.join(' ')} #${i}`;
}

const ID_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** An id of the form the model gives a new record: `ad4m://obj/` and 24 lowercase letters. */
function objectId(rand) {
  let s = 'ad4m://obj/';
  for (let k = 0; k < 24; k++) s += ID_LETTERS[Math.floor(rand() * 26)];
  return s;
}

/** As `Literal.from(text).toUrl()` writes a string. */
const literal = (text) => `literal:string:${encodeURIComponent(text)}`;

/**
 * The {@link AUTHORS} author agents of a run, rebuilt from `seed`: agent `i`'s private key seed is
 * `sha256("feed-scale-author:<seed>:<i>")`, so every process that knows `seed` holds the same 40
 * `did:key`s — which is what lets each generation worker sign as the same people without keys being
 * passed between threads.
 */
export function authorAgents(seed) {
  return Array.from({ length: AUTHORS }, (_, i) =>
    makeAgent(createHash('sha256').update(`feed-scale-author:${seed}:${i}`).digest()),
  );
}

/**
 * The messages, oldest first: message `i` of `count` is at an even step through {@link SPAN_MS}
 * ending `endMs`, nudged by up to half a step, so the order is the index order and no two share a
 * time. `from`/`to` bound the range for a worker's slice; because each message's generator is keyed
 * by `(seed, i)` — spread by an unrelated large multiplier — message `i` is identical whether it is
 * produced by `from = 0` or by a slice starting at `i`.
 */
export function* messages({ count, endMs, seed = 1, authors, from = 0, to = count }) {
  const step = SPAN_MS / count;
  const startMs = endMs - SPAN_MS;
  for (let i = from; i < to; i++) {
    const rand = random(seed * 0x9e3779b1 + i);
    const atMs = Math.floor(startMs + i * step + rand() * step * 0.5);
    yield { i, id: objectId(rand), text: words(rand, i), atMs, author: authors[Math.floor(rand() * authors.length)] };
  }
}

/**
 * A link expression as `runtime.exportData` writes one: `data` in `source`/`predicate`/`target`
 * order, plus the `status` the import stores it under. Signing still uses the `data` object's
 * serde order (`predicate`,`source`,`target`), which `signer.mjs` keeps inside `link()`.
 */
const fileLink = (le) => ({
  author: le.author,
  timestamp: le.timestamp,
  data: { source: le.data.source, predicate: le.data.predicate, target: le.data.target },
  proof: le.proof,
  status: 'local',
});

/**
 * Every link of message `m`, as rows of the links file: the class flag at `atMs` — so it stays the
 * message's earliest link and the model reads `author`/`createdAt` from it — then each property and
 * the collection's `has_child` link one millisecond later.
 */
export function messageLinks(m, shape) {
  const rows = [fileLink(m.author.link(m.id, FLAG.predicate, FLAG.target, m.atMs))];
  for (const p of shape.properties) {
    rows.push(fileLink(m.author.link(m.id, p.predicate, p.target ?? literal(m.text), m.atMs + 1)));
  }
  rows.push(fileLink(m.author.link(shape.root, HAS_CHILD, m.id, m.atMs + 1)));
  return rows;
}

/** A seeded message as the results name it. */
function described(m) {
  return { id: m.id, text: m.text, at: new Date(m.atMs).toISOString(), author: m.author.did };
}

// Resolved by path, not `new URL('./seed-worker.mjs', import.meta.url)`: bundlers take that shape
// for an asset reference and rewrite it into a URL that is no longer a file path.
const WORKER_FILE = join(dirname(fileURLToPath(import.meta.url)), 'seed-worker.mjs');

/** Runs one `seed-worker.mjs` worker; `onDone` receives its running message count. */
function runWorker(workerData, onDone) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, { workerData });
    worker.on('message', (m) => {
      if (typeof m?.progress === 'number') onDone(m.progress);
    });
    worker.on('error', reject);
    worker.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`a seed worker exited with code ${code}`))));
  });
}

/** Writes `s` to `out`, waiting for the buffer to drain when it is full. */
async function writeChunk(out, s) {
  if (!out.write(s)) await once(out, 'drain');
}

/** Streams `src` into `out` chunk by chunk, honouring backpressure. */
async function copyInto(out, src) {
  for await (const chunk of createReadStream(src)) await writeChunk(out, chunk);
}

/**
 * Generates the links file for `count` messages of `shape` in `dir` (a new dir under `$TMPDIR` by
 * default): splits the range across `workers` threads, each writing a `<file>.partN` file of
 * comma-joined link rows, then concatenates `{"links":[` + parts + `]}` into the file and removes
 * the parts. Resolves with the file path,
 * what was generated, and the newest and oldest messages, which the suite then looks for on screen.
 *
 * `onProgress(written, count)` is called about once a percent.
 */
export async function generateSeedFile({
  dir = null,
  shape,
  count,
  endMs = Date.now() - 3_600_000,
  seed = 1,
  workers = availableParallelism(),
  onProgress = () => {},
}) {
  dir ??= mkdtempSync(join(tmpdir(), 'feed-scale-seed-'));
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `feed-scale-links-${process.pid}-${Date.now()}.json`);
  const authors = authorAgents(seed);
  const partFiles = [];
  const tasks = [];
  const written = [];
  let ticked = 0;
  const tick = () => {
    const total = written.reduce((a, b) => a + b, 0);
    const percent = Math.floor((total * 100) / count);
    if (percent > ticked) {
      ticked = percent;
      onProgress(total, count);
    }
  };
  const slice = Math.ceil(count / workers);
  let failed = false;
  try {
    for (let k = 0; k < workers; k++) {
      const from = k * slice;
      const to = Math.min(count, (k + 1) * slice);
      if (from >= to) continue;
      const partFile = `${filePath}.part${k}`;
      partFiles.push(partFile);
      written.push(0);
      const index = written.length - 1;
      tasks.push(
        runWorker({ partFile, shape, count, from, to, endMs, seed }, (n) => {
          written[index] = n;
          tick();
        }),
      );
    }
    await Promise.all(tasks);

    // Parts join in slice order, so the file is the links of messages 0..count-1 — byte-identical
    // to what a single worker writing the whole range would produce.
    const out = createWriteStream(filePath);
    try {
      await writeChunk(out, '{"links":[');
      let needComma = false;
      for (const part of partFiles) {
        if ((await stat(part)).size === 0) continue;
        if (needComma) await writeChunk(out, ',');
        await copyInto(out, part);
        needComma = true;
      }
      await writeChunk(out, ']}');
    } finally {
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // A half-written file is never a valid input for the import: drop it with the parts.
    if (failed) await unlink(filePath).catch(() => {});
    for (const part of partFiles) await unlink(part).catch(() => {});
  }

  const [oldest] = [...messages({ count, endMs, seed, authors, from: 0, to: 1 })];
  const [newest] = [...messages({ count, endMs, seed, authors, from: count - 1, to: count })];
  return {
    filePath,
    messages: count,
    links: count * shape.links,
    authors: authors.map((a) => a.did),
    oldest: described(oldest),
    newest: described(newest),
  };
}

/**
 * Seeds `count` messages of `shape` into the perspective `uuid`: generates the links file, calls
 * `runtime.importData` over the suite's own raw WebSocket as `token` (the executor's admin
 * credential — the call is operator-only, the managed user's token is refused), then deletes the
 * file. Resolves with what was written and how long each step took, and the newest and oldest
 * messages, which the suite then looks for on screen.
 *
 * `onProgress(written, count)` is called about once a percent, over the generation.
 */
export async function seedMessages({
  url,
  token,
  uuid,
  shape,
  count,
  endMs = Date.now() - 3_600_000,
  seed = 1,
  workers = availableParallelism(),
  onProgress = () => {},
}) {
  const started = Date.now();
  const generated = await generateSeedFile({ shape, count, endMs, seed, workers, onProgress });
  const generateSeconds = (Date.now() - started) / 1_000;

  let result = null;
  const importStart = Date.now();
  const writer = await openWriter(url, token);
  try {
    result = await writer.importPerspective(uuid, generated.filePath);
  } finally {
    writer.close();
    await unlink(generated.filePath).catch(() => {});
  }
  const importSeconds = (Date.now() - importStart) / 1_000;
  // An executor before ad4m #1780 answers the call with the file echoed back and stores nothing.
  if (typeof result?.imported !== 'number') {
    throw new Error('runtime.importData did not import (needs an executor with ad4m #1780)');
  }

  return {
    messages: generated.messages,
    links: generated.links,
    generateSeconds,
    importSeconds,
    imported: result.imported,
    skipped: result.skipped,
    authors: generated.authors,
    oldest: generated.oldest,
    newest: generated.newest,
  };
}
