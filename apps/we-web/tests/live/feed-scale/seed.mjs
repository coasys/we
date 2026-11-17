/**
 * A million messages in one space, written through the executor's own write path.
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
 * ## How it is written: `hybrid` (the default)
 *
 * Two write paths, each for what only it can do:
 *
 * - The class flag (`we://flag → we://text_block`) is signed here, by one of {@link AUTHORS} agents
 *   with its own `did:key`, at the message's own time, and written with `perspective.addLinkExpression`,
 *   which stores a link exactly as signed. A message's `author` and `createdAt` are those of its
 *   earliest link (ad4m `model_query/hydration.rs`), and this one is earliest, so the Feed reads the
 *   message as written by that person at that time. The executor verifies the signature on write, so
 *   the flag is a verified link — which is what ad4m's scope index keys a member on (ad4m #1734).
 * - The other eleven links go in batches through `perspective.addLinks`, which the executor signs as
 *   the account, at the moment it writes them. Signing those here as well would make every one an RPC
 *   of its own, and the executor's batch path (`createBatch`/`commitBatch`) re-signs whatever it is
 *   given, so it cannot carry them either.
 *
 * Two others are kept for measuring against: `executor` (all twelve through `addLinks` — fast, but
 * every message by the account and timestamped by the seeding run, so the Feed's order is the order
 * of writing) and `signed` (all twelve signed here, one RPC each — the most faithful, and the slowest).
 * See README.md for the measurements that chose `hybrid`.
 *
 * Every link is written `local`: the space is shared, and `shared` would hand each write to the link
 * language to publish. This is not a sync test; what the Feed reads is the same either way.
 */
import { makeAgent } from './signer.mjs';

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
 * The messages, oldest first: message `i` of `count` is at an even step through {@link SPAN_MS}
 * ending `endMs`, nudged by up to half a step, so the order is the index order and no two share a time.
 */
export function* messages({ count, endMs, seed = 1, authors }) {
  const rand = random(seed);
  const step = SPAN_MS / count;
  const startMs = endMs - SPAN_MS;
  for (let i = 0; i < count; i++) {
    const atMs = Math.floor(startMs + i * step + rand() * step * 0.5);
    yield { i, id: objectId(rand), text: words(rand, i), atMs, author: authors[Math.floor(rand() * authors.length)] };
  }
}

/** Runs `next()`'s tasks `limit` at a time until it returns null; rejects on the first failure. */
async function pool(limit, next) {
  let failed = null;
  const worker = async () => {
    for (;;) {
      if (failed) return;
      const task = next();
      if (!task) return;
      try {
        await task();
      } catch (error) {
        failed ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  if (failed) throw failed;
}

export const MODES = ['hybrid', 'executor', 'signed'];

/**
 * Writes `count` messages of `shape` into the perspective `uuid`, through `clients` (account writers,
 * `writer.mjs`, each with `addLinks` and `addLinkExpression`; more than one spreads the RPCs over
 * sockets). Resolves with what was written and how long it took,
 * and the newest and oldest messages, which the suite then looks for on screen.
 *
 * `onProgress(written, count)` is called about once a percent.
 */
export async function seedMessages({
  clients,
  uuid,
  shape,
  count,
  mode = 'hybrid',
  endMs = Date.now() - 3_600_000,
  seed = 1,
  batch = 500,
  signedInFlight = 256,
  batchesInFlight = 4,
  onProgress = () => {},
}) {
  if (!MODES.includes(mode)) throw new Error(`no seeding mode ${mode}: one of ${MODES.join(', ')}`);
  if (!clients.length) throw new Error('seeding needs at least one client');
  const authors = Array.from({ length: AUTHORS }, () => makeAgent());
  const all = messages({ count, endMs, seed, authors });
  const started = Date.now();
  let written = 0;
  let links = 0;
  let calls = 0;
  let oldest = null;
  let newest = null;
  let ticked = 0;
  const tick = (n) => {
    written += n;
    const percent = Math.floor((written * 100) / count);
    if (percent > ticked) {
      ticked = percent;
      onProgress(written, count);
    }
  };
  const client = () => clients[calls++ % clients.length];
  const unsigned = (m) => [
    ...shape.properties.map((p) => ({ source: m.id, predicate: p.predicate, target: p.target ?? literal(m.text) })),
    { source: shape.root, predicate: HAS_CHILD, target: m.id },
  ];
  const signedLinks = (m) =>
    [{ source: m.id, ...FLAG }, ...unsigned(m)].map((l) => m.author.link(l.source, l.predicate, l.target, m.atMs));
  const addSigned = (link) => client().addLinkExpression(uuid, link, 'local');

  // Messages are taken in batches, in order, so a batch's flags and its other links land together.
  const takeBatch = () => {
    const out = [];
    for (let k = 0; k < batch; k++) {
      const { value, done } = all.next();
      if (done) break;
      oldest ??= value;
      newest = value;
      out.push(value);
    }
    return out.length ? out : null;
  };

  // A pool task for each of `list`'s links in turn, then none.
  const signing = (list) => {
    let k = 0;
    return () => {
      if (k >= list.length) return null;
      const link = list[k++];
      return () => addSigned(link);
    };
  };

  await pool(mode === 'signed' ? 1 : batchesInFlight, () => {
    const msgs = takeBatch();
    if (!msgs) return null;
    return async () => {
      if (mode === 'executor') {
        const batchLinks = msgs.flatMap((m) => [{ source: m.id, ...FLAG }, ...unsigned(m)]);
        await client().addLinks(uuid, batchLinks, 'local');
        links += batchLinks.length;
      } else if (mode === 'hybrid') {
        const flags = msgs.map((m) => m.author.link(m.id, FLAG.predicate, FLAG.target, m.atMs));
        const rest = msgs.flatMap(unsigned);
        await Promise.all([
          pool(Math.max(1, Math.floor(signedInFlight / batchesInFlight)), signing(flags)),
          client().addLinks(uuid, rest, 'local'),
        ]);
        links += flags.length + rest.length;
      } else {
        const each = msgs.flatMap(signedLinks);
        await pool(signedInFlight, signing(each));
        links += each.length;
      }
      tick(msgs.length);
    };
  });

  return {
    mode,
    messages: written,
    links,
    seconds: (Date.now() - started) / 1_000,
    authors: authors.map((a) => a.did),
    oldest: oldest && described(oldest),
    newest: newest && described(newest),
  };
}

/** A seeded message as the results name it. */
function described(m) {
  return { id: m.id, text: m.text, at: new Date(m.atMs).toISOString(), author: m.author.did };
}
