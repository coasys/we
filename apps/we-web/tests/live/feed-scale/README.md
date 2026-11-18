# feed-scale — the Feed of a very large space

A live suite. It puts many messages into one space on a real executor, opens that space in WE web in
Chromium, and measures how long the Feed takes to show its newest page and the page before it. It
also records what the executor does while that happens: its memory, and the CPU it uses. ad4m's
nightly runs it as the `feed-scale` job at a million messages (the nightly job in coasys/ad4m,
`scripts/feed-scale.sh`).

```sh
pnpm --filter @we/app-web build
FEED_SCALE_MESSAGES=10000 AD4M_EXECUTOR=/path/to/ad4m-executor pnpm --filter @we/app-web test:feed-scale
```

The executor binary is found as it is for the other live suites (`../harness.mjs`). The environment
table is at the top of `feed-scale.live.mjs`.

## What it measures

Each run loads the space once. The first run is cold (a new browser profile). The other runs are
reloads (warm). There are 5 runs by default.

| Metric                                               | Unit            | What it is                                                                                                                     |
| ---------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `feed.newest_page.cold` · `.median` · `.max`         | ms              | From navigation (or reload) until the newest seeded message is visible and the 49th is in the DOM                              |
| `feed.older_page.median` · `.max`                    | ms              | From a scroll to the Feed's older edge until message 150 is in the DOM                                                         |
| `executor.feed_query.median` · `.max`                | ms              | The round trip of each `TextBlock` model query that the page sent over the space's collection, measured from the page's socket |
| `executor.feed_other_queries.max`                    | ms              | The slowest of the Feed's other model queries in the same read (calls, tasks, events, relationships)                           |
| `executor.cpu_seconds.ui_phase`                      | s               | The executor's CPU time (user + system) over all the loads                                                                     |
| `executor.idle_cpu_percent.after_seed` · `.after_ui` | % of one core   | The executor's CPU over a quiet spell with no page open: after the seeding, and after the loads                                |
| `executor.rss.after_seed` · `.after_ui` · `.peak`    | MiB             | The executor's `VmRSS` after the seeding, after the loads, and its `VmHWM`                                                     |
| `seed.generate_s` · `seed.import_s`                  | s               | Generating the links file, and the executor's `runtime.importData` of it                                                       |
| `seed.links` · `seed.links_per_second`               | links · links/s | The seeded link count, and the executor's import rate                                                                          |

All of them are better when lower, except `seed.links_per_second`.

`feed.newest_page.cold` is the cold load's own time: when the cold load never draws it is left
out, and a warm reload's time is never reported in its place.

The page times come from the page itself. An init script watches the DOM and writes a mark, with
`Date.now()`, when the newest message is attached and visible, when the 49th is attached, and when
message 150 is attached. The suite's own waits (Playwright polls a locator up to every 500 ms) are
not in the numbers. The suite still waits for the same rows, so a row that never shows still fails
the run.

The suite writes two files in `FEED_SCALE_ARTIFACTS`:

- `metrics.json` holds the metrics alone, as `{"metrics": [...]}`. This is the input of ad4m's
  `scripts/perf/record`. When `PERF_RESULTS_DIR` is set, the suite also writes the same file there
  as `feed-scale.json`. Each record has the metric name, `value`, `unit`, `better`, and `params`
  `{"messages": N}`.
- `results.json` holds the same metrics and a `detail` section. The detail has every run's Feed
  calls, where each load's time went (see below), the slowest other calls of each run, the space's
  auto-processors at each step, and the executor's answer to the Feed's query from outside the page.
  If a run fails, `detail.failedRun` holds the calls that run sent and the calls that never got an
  answer.

A load whose page never draws is a result, not a failure of the suite. The run is recorded with
`detail.runs[].outcome` (`feed-call-refused`, `timeout`, `page-closed`) and the calls it made, and
the counts land in the `feed.newest_page.failures`, `feed.older_page.failures` and
`executor.feed_query.failures` metrics. Feed calls the executor did answer before the load gave up
still count toward `executor.feed_query.*`. When the tab itself is what closed, the next load runs
in a fresh tab of the same device, so the loads after it are still measured. `feed-call-refused` is
the executor declining to answer: its
SPARQL eval deadline (`query_deadline_secs`, 30 s on `dev`, not configurable from outside) kills a
query it cannot answer in time, and the page then has nothing to draw. The suite's own Feed query
from outside the page is recorded the same way in `detail.direct[].error`. A slower query is
measured to its end: the suite gives its calls `FEED_SCALE_PAGE_TIMEOUT` (10 minutes by default),
so what bounds a measurement is the executor's own deadline, not the suite's.

The last line of the log is one summary line:

```
feed-scale passed: messages=100000 seed=3s+12s/1200000links newest(cold/median/max)=28199/28199/29310ms older(median/max)=19877/21494ms query(median/max)=17339/18344ms others(max)=1683ms cpu(ui/idle-seed/idle-ui)=1067s/4%/199% rss(seed/ui/peak)=2036/1642/2557MiB runs=5
```

(`seed=` is the links file's generation seconds + the import's seconds, then the link count.)

## The space's watch

When a space opens, WE registers an auto-processor on the executor for the space's own collection,
the one the Feed reads (`SpaceStore` → `DatasetStore.watchConversation`, id
`we-call-<collection>`). This is how a space interprets the messages typed straight into it. It is
on by default. Its scope is every message under the collection with a `we://text_source` of
`typed`, `spoken` or `corrected`, so every seeded message is in its scope.

The suite treats the watch in two ways:

- **During the seeding, the suite removes it.** The seeding is setup, not a measurement. With the
  watch in place, the executor's tick re-reads every message in scope twice a second, which costs
  O(messages) per tick and would run while the import fills the perspective. The suite removes
  every auto-processor of the space before it seeds, with `perspective.removeAutoProcessor`, and
  records which ones in `detail.watch.removedBeforeSeed`. No page is open during the seeding, so
  nothing registers it again. The suite checks this after the seeding (`detail.watch.afterSeed`).
- **During the loads, the suite keeps it.** The app registers the watch again when it opens the
  space, as it does for every user. The page times and the executor's CPU include its cost.
  `executor.cpu_seconds.ui_phase` and `executor.idle_cpu_percent.after_ui` are the numbers that
  move when the watch's cost changes. `idle_cpu_percent.after_seed` is the same executor and store
  with no watch, for comparison.

## How the space is filled

The suite does not hard-code a message. It types one line into the Feed, reads back the links that
the app wrote, and copies that shape for each seeded message (`seed.mjs`, `messageShape`). On ad4m
`dev` a message is 12 links:

- the class flag
- the text
- nine defaulted properties
- the collection's `has_child` link

If the TextBlock model gets a new property, the seeding writes it with no change here.

### The links file and the import

The suite does not push links through the executor's write path. It generates every link already
signed into a file in `runtime.exportData`'s perspective format (`{"links":[ <link>, ... ]}`) and
asks `runtime.importData` (`{type: "perspective", filePath, perspectiveUuid}`) to load it straight
into the space's perspective. Writing through `perspective.addLinks` / `addLinkExpression` cost
about 6 181 s at a million messages: roughly half of the perspective writer thread's time was
ed25519 sign/verify of every link inside the executor's single-transaction write loop, and the
fallback sync's O(links) passes stopped the writes for minutes about every 100 000 messages.
Generation moves the signing to the suite, where it scales with cores, and the import is the
executor's one bulk read of a file.

- **Why every link is signed by its author.** A link the executor signs is authored by the asking
  account and stamped at write time — a million rows by one person in one afternoon is not a feed
  anybody has. Every link is instead signed by one of 40 `did:key` agents, rebuilt from the run's
  seed, at the message's own time over the past year (`signer.mjs`). The flag goes at the message's
  `atMs`, the other links at `atMs + 1`, so the flag stays each message's earliest link and the
  model reads the message's `author`/`createdAt` from it (ad4m `model_query/hydration.rs`). The
  executor verifies the signatures on import, so the seeded flags are verified links — which is
  what ad4m's scope index keys a member on (ad4m #1734). All links carry `status: "local"`: nothing
  is published to the neighbourhood's link language; this is not a sync test.
- **How it is generated.** The message range is split across `os.availableParallelism()` worker
  threads (`seed-worker.mjs`; `FEED_SCALE_WORKERS` changes it), each writing its own part file;
  the main thread then streams `{"links":[` + parts + `]}` into one file under `$TMPDIR` (not the
  artifacts: a run stopped mid-import must not leave the file for CI to upload). Message `i`'s randomness is drawn from a generator keyed by `(seed, i)`
  rather than one sequential stream, so a slice is identical however the range is divided, and the
  same 40 author keys are rebuilt from `seed` in every worker — a one-worker file and a 32-worker
  file are byte-identical. At a million messages the file is about 6 GB (twice that while the parts
  are joined), so `$TMPDIR` needs the disk for it; it is deleted after the import.
- **Why the suite has its own writer for the call.** `runtime.importData` is operator-only: it goes
  on a raw WebSocket (`writer.mjs`) as the executor's admin credential, not the managed user's
  token. The socket keeps no client-side timeout — the SDK's fixed 30 s would give up on a call
  that runs over a minute at a million messages.
- **It needs an executor with the import.** Before ad4m #1780, `runtime.importData` with
  `type: "perspective"` stored nothing; the suite then fails its check that the seeded messages
  are there.

Measured on one Linux workstation (32 cores) at a million messages: the file generates in 20.4 s
and the executor imports its 12 000 000 links in 78.1 s (154 000 links/s) — against 6 181 s when
the same messages went through the executor's write path.

## Where a load's time goes

`detail.runs[].phases` and one `phases:` log line for each run give, in ms from the start of the
load: the page's first call to the executor, when its `Space` query was answered, when the Feed
asked for its messages and was answered, when the last author profile (`agent.byDid`) asked before
the draw was answered, when the app registered the watch, and the page's own marks.

Medians over the 5 runs of each suite run:

| Messages | Executor | `Space` answered | Feed asked | Feed answered | Newest visible | Last profile answered | 49th row attached |
| -------- | -------- | ---------------- | ---------- | ------------- | -------------- | --------------------- | ----------------- |
| 10k      | `dev`    | 0.55 s           | 0.95 s     | 1.96 s        | 3.93 s         | 11.3 s                | 10.3 s            |
| 100k     | `dev`    | 0.55 s           | 2.35 s     | 19.5 s        | 19.8 s         | 28.2 s                | 28.2 s            |
| 100k     | #1734    | 20.1 s           | 20.6 s     | 22.1 s        | 22.7 s         | 30.2 s                | 30.0 s            |

What fills the time:

- **The suite's own waits are less than 0.52 s.** The suite's locators noticed the rows 33–515 ms
  after the page's marks. They are no longer in the numbers.
- **At 10k, the Feed's query is not the cost.** The Feed asks at 0.95 s and is answered at 1.96 s,
  and the newest message shows at 2.3–4.1 s. The 49th row comes at 7.7–10.7 s, while the page's
  25–28 `agent.byDid` calls (one for each seeded author in the window) are still being answered,
  about 310 ms apart, until 9.7–11.8 s. At 30k and at 100k, the 49th row is attached within 10 ms
  of the last of those answers in 14 of 17 runs, and 0.36–0.91 s before it in the other 3. The
  timing shows this; the suite does not prove the cause.
- **At 100k on `dev`, the Feed's query is the cost.** It takes about 17 s, from 2.4 s to 19.5 s.
  Then the profiles take 8 s more.
- **At 100k on #1734, the `Space` query is the cost.** The Feed's query takes 1.5 s, but the Feed
  asks only after a `Space` model query with `limit: 1` is answered, at about 20 s. On `dev` that
  query is answered at 0.55 s.
- **The watch does not move the page times on this host.** A diagnostic run at 100k on `dev`
  removed the watch each time the app registered it (a script outside the suite, not part of it).
  The newest page's median was 27.9 s without the watch and 28.2 s with it. The Feed's query took
  17.9 s and 17.3 s. But the executor used 622 s of CPU over the loads without the watch and
  1067 s with it, and 5% and 199% of a core when idle after the loads. The watch costs about two
  cores for as long as the space holds that many messages in scope. On a host with fewer cores
  this can move the page times too. `executor.cpu_seconds.ui_phase` is the metric that shows a fix.
- **The older page overlaps a load that is already running.** The Feed asks for the 150-row window
  by itself just after the first draw, before the suite scrolls. The older-page time is the time
  from the scroll until that window is drawn, and it can be shorter than the query. When the window
  is already drawn at the scroll, the older-page time is 0, and `olderBeforeScroll` is true in the
  run's detail.

## Results so far

Measured on one Linux workstation, with executors built from ad4m `dev` at 2d341e651 and from
[#1734](https://github.com/coasys/ad4m/pull/1734) (`feat/scope-index`, cb2901d0d). The watch is
removed for the seeding and kept for the loads. Each row is one run of 5 loads. The `Seed` column
predates the links-file path: those runs wrote through `addLinks`/`addLinkExpression`, which is why
their seeding took minutes to hours where the file path now takes seconds.

| Messages | Executor                           | Seed   | Newest page cold / median / max | Older page median / max | `TextBlock` query median / max | Same query from outside the page (50 rows) | Executor CPU over the loads | Idle CPU after seed / after loads | RSS seed / ui / peak   |
| -------- | ---------------------------------- | ------ | ------------------------------- | ----------------------- | ------------------------------ | ------------------------------------------ | --------------------------- | --------------------------------- | ---------------------- |
| 10k      | `dev`                              | 26.5 s | 7.7 / 10.3 / 10.7 s             | 1.3 / 1.4 s             | 1.2 / 1.5 s                    | 0.98 s                                     | 101 s                       | 3% / 93%                          | 1432 / 1467 / 1563 MiB |
| 100k     | `dev`                              | 258 s  | 28.2 / 28.2 / 29.3 s            | 19.9 / 21.5 s           | 17.3 / 18.3 s                  | 14.4 s                                     | 1067 s                      | 4% / 199%                         | 2036 / 1642 / 2557 MiB |
| 100k     | #1734                              | 435 s  | 29.8 / 30.0 / 31.3 s            | 5.3 / 6.1 s             | 2.3 / 3.1 s                    | 1.1 s                                      | 763 s                       | 3% / 189%                         | 2118 / 2666 / 2994 MiB |
| 100k     | `dev`, watch kept off (diagnostic) | 263 s  | 27.5 / 27.9 / 28.3 s            | 20.4 / 21.6 s           | 17.9 / 18.4 s                  | 16.0 s                                     | 622 s                       | 4% / 5%                           | 2018 / 2159 / 3351 MiB |
| 1M       | `dev`                              | 6181 s | — all 5 refused                 | —                       | refused ×5                     | refused (53.9 s)                           | 3238 s                      | 2.8% / 276%                       | 2594 / 8732 / 9286 MiB |

What the numbers show:

- **At a million on `dev`, no page can draw.** Every `TextBlock` model query is killed by the
  executor's SPARQL eval deadline (`query_deadline_secs`, 30 s): the suite's own query from outside
  the page after the seeding, each load's feed query (all 5 loads recorded `feed-call-refused` in
  about 85 s), and both queries after the loads. The page's other feed calls
  (`EventBlock`/`TaskBlock`/`CollectionBlock`/`Relationship`, `limit: 50`–`150`) were refused the
  same way — `executor.feed_query.failures` counts 5. The refusal is a measurement of the executor,
  not a failure of the suite.
- **The watch costs almost three cores at a million.** The executor used 3238 s of CPU over the
  ~7 minutes of loads, and idles at 276% of a core afterwards with the space's watch registered —
  against 2.8% after the seeding without it (the watch is removed for the seeding only). Its tick
  re-reads a million messages twice a second.

- **#1734's scope index is used for the seeded messages.** The seeded flags are verified links,
  which is what the index keys a member on. At 100k, the Feed's query from outside the page takes
  1.1 s with #1734 and 14.4 s on `dev`, and the older page is about 4 times faster.
- **#1734 makes the seeding slower, and it is not flat.** 100k took 435 s with #1734 and 258 s on
  `dev`, and its rate falls as the store grows.
- **Once, the older window did not arrive.** In one earlier run on `dev` at 10k, the newest page drew
  but message 150 did not appear in 10 minutes. The Feed showed its "start here" header, as if it
  had reached the oldest message. Later runs at the same size passed. The suite records the calls
  that a failed run sent and the calls that got no answer, to find the cause.
