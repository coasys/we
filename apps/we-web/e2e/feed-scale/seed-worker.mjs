/**
 * One slice of the seeding's links file, generated on a worker thread (`seed.mjs`,
 * `generateSeedFile`). Given `workerData` — the shared `shape`, the whole `count`, this worker's
 * range `from`/`to`, `endMs`, the run's `seed` and its `partFile` — it regenerates exactly the
 * messages of its range: `messages()` draws each message's randomness from `(seed, i)`, and
 * `authorAgents(seed)` rebuilds the same 40 author keys in every worker, so a slice is identical
 * whoever produces it.
 *
 * The part file is written streamed, not built as a string: each link row is serialised and written
 * with a comma before every link after the first, so part files hold `link,link,…` and the main
 * thread only has to put `{"links":[`, the parts and `]}` together. Progress is posted back as a
 * running count, about once a percent of the range.
 */
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

import { authorAgents, messageLinks, messages } from './seed.mjs';

const { partFile, shape, count, from, to, endMs, seed } = workerData;
const authors = authorAgents(seed);
const out = createWriteStream(partFile);
const report = Math.max(1, Math.ceil((to - from) / 100));
let first = true;
let done = 0;
for (const m of messages({ count, endMs, seed, authors, from, to })) {
  for (const link of messageLinks(m, shape)) {
    const row = JSON.stringify(link);
    if (!out.write(first ? row : `,${row}`)) await once(out, 'drain');
    first = false;
  }
  if (++done % report === 0) parentPort.postMessage({ progress: done });
}
await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
parentPort.postMessage({ progress: done });
