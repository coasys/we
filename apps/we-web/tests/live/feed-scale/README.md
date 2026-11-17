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

| Metric                                                  | Unit                | What it is                                                                                                                     |
| ------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `feed.newest_page.cold` · `.median` · `.max`            | ms                  | From navigation (or reload) until the newest seeded message is visible and the 49th is in the DOM                              |
| `feed.older_page.median` · `.max`                       | ms                  | From a scroll to the Feed's older edge until message 150 is in the DOM                                                         |
| `executor.feed_query.median` · `.max`                   | ms                  | The round trip of each `TextBlock` model query that the page sent over the space's collection, measured from the page's socket |
| `executor.feed_other_queries.max`                       | ms                  | The slowest of the Feed's other model queries in the same read (calls, tasks, events, relationships)                           |
| `executor.cpu_seconds.ui_phase`                         | s                   | The executor's CPU time (user + system) over all the loads                                                                     |
| `executor.idle_cpu_percent.after_seed` · `.after_ui`    | % of one core       | The executor's CPU over a quiet spell with no page open: after the seeding, and after the loads                                |
| `executor.rss.after_seed` · `.after_ui` · `.peak`       | MiB                 | The executor's `VmRSS` after the seeding, after the loads, and its `VmHWM`                                                     |
| `seed.seconds` · `seed.links` · `seed.links_per_second` | s · links · links/s | The seeding                                                                                                                    |

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

## Keeping the seeded store

At a million messages the seeding is the expensive part of a run, and a failure in the load phase
should not cost it again. Two environment variables keep and reuse the executor's data directory:

- `FEED_SCALE_KEEP_STORE=<dir>` runs the suite as usual, but the executor's data directory is
  `<dir>` (it must be empty or not exist) and it is kept after the run. Right after the seeding the
  suite writes `feed-scale-store.json` into it — the space's URL, the collection the Feed reads,
  the newest message's id, author and time — everything a later run needs to find it again.
- `FEED_SCALE_REUSE_STORE=<dir>` starts the executor on a directory `KEEP` left, skips making the
  space and seeding it, and runs the load phase on what is there: the sign-in, the newest-flag
  check, the direct Feed query, the idle CPU read, the loads, and `results.json` as usual — only
  the `seed.*` metrics are absent (this run did not seed). A watch the earlier run's loads left
  registered is removed first, so the load phase is the same as after a seeding. The agent is
  unlocked again at the start (a restart locks it).

`FEED_SCALE_MESSAGES` must not disagree with the kept store's count; unset, it is read from the
store. Keep the store on a disk with room — it is the whole executor data directory (tens of GB at
a million messages) — and point `FEED_SCALE_KEEP_STORE` outside `$TMPDIR`, which the ad4m job
empties around the suite. A store kept is reusable only by the same executor version (`init`
cleans a directory whose recorded version is out of range).

The last line of the log is one summary line:

```
feed-scale passed: messages=100000 seed=258s/1200000links/hybrid newest(cold/median/max)=28199/28199/29310ms older(median/max)=19877/21494ms query(median/max)=17339/18344ms others(max)=1683ms cpu(ui/idle-seed/idle-ui)=1067s/4%/199% rss(seed/ui/peak)=2036/1642/2557MiB runs=5
```

## The space's watch

When a space opens, WE registers an auto-processor on the executor for the space's own collection,
the one the Feed reads (`SpaceStore` → `DatasetStore.watchConversation`, id
`we-call-<collection>`). This is how a space interprets the messages typed straight into it. It is
on by default. Its scope is every message under the collection with a `we://text_source` of
`typed`, `spoken` or `corrected`, so every seeded message is in its scope.

The suite treats the watch in two ways:

- **During the seeding, the suite removes it.** The seeding is setup, not a measurement. With the
  watch in place, the executor's tick re-reads every message in scope while the suite writes, and
  the seeding slows as the store grows (see below). The suite removes every auto-processor of the
  space before it seeds, with `perspective.removeAutoProcessor`, and records which ones in
  `detail.watch.removedBeforeSeed`. No page is open during the seeding, so nothing registers it
  again. The suite checks this after the seeding (`detail.watch.afterSeed`).
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

A message's author and `createdAt` come from its earliest link. The default mode, `hybrid`, writes
the flag as a link that the suite signs itself. It uses one of 40 `did:key` agents, at the message's
own time over the past year, and sends it with `perspective.addLinkExpression`. The executor
verifies the signature. The other 11 links go in batches through `perspective.addLinks`, which the
executor signs. This gives the Feed real authors and real times, at a fraction of the cost of
signing every link.

| Mode                                    | 30k messages                                                                   | Messages/s | What the Feed reads                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| `executor` (all through `addLinks`)     | 44.9 s                                                                         | 670        | All by the account, in write order. The run stops after the seeding: the pages cannot be timed |
| `hybrid` (default)                      | 77–87 s                                                                        | 345–390    | 40 authors over a year, in time order                                                          |
| `signed` (all 12 signed, one call each) | not run at size; the signed-link rate (~770 links/s) gives about 64 messages/s | ~64        | The same as `hybrid`                                                                           |

### Why the suite has its own writer

`writer.mjs` sends the same two calls with the same frames as the SDK, with no client-side timeout.
The executor writes one transaction at a time per perspective, so a batch waits behind all the
batches queued before it. When the store was large and the watch was on, a queued `addLinks` passed
the SDK's fixed 30 s limit (`DEFAULT_TIMEOUT_MS`) at about 92 000 messages, and the run failed. The
suite cannot send a timed-out write again, because the executor still completes it and the data
would be written twice. If the connection drops, all pending calls still fail.

### How fast the seeding is

With the watch removed, the seeding on ad4m `dev` (2d341e651) is flat up to 100 000 messages. Each
10 000 messages took 365, 398, 391, 400, 404, 401, 375, 395, 367 and 392 messages/s. 100 000
messages took 258 s. Past that, the rate between stops stays the same, but the executor stops the
writes for minutes about every 100 000 messages (see below). A million messages took 6 122 s.

| Executor                             | 10k    | 100k           | 1M                                     | Messages/s from 0 to 100k                                     |
| ------------------------------------ | ------ | -------------- | -------------------------------------- | ------------------------------------------------------------- |
| `dev`, watch removed                 | 26.5 s | 258 s, 263 s   | 6 122 s (about 2 900 s of it in stops) | 365–404, flat                                                 |
| #1734, watch removed                 | —      | 435 s          | —                                      | 288 at the start, 217–228 after 60k, with one 10k step at 107 |
| `dev`, watch on (before this change) | 28.9 s | 629 s          | —                                      | 388 at the start, 196 from 10k to 50k                         |
| #1734, watch on (before this change) | 32.2 s | 1571 s, 1958 s | —                                      | —                                                             |

The batch settings do not change the rate. At 30 000 messages on `dev`, batches of 100, 500 and
1000, with 2, 4 or 8 in flight, all took 77–87 s. At 100 000, batches of 100 and 500 took 258 s and
263 s.

A million messages does not meet a 20-minute target. With no stops, the `dev` rate gives about
48 minutes. The `executor` mode, with no signed links at all, writes about 670 messages/s, so even
that would take about 25 minutes. The limits are the executor's write path and its fallback sync, not
the suite.

#### Where the seeding time goes

gdb stack samples of the executor while it seeds 30 000 messages on `dev` (the executor runs as
gdb's child, and SIGUSR2 takes all thread stacks, every 0.5 s, 183 samples) show one busy thread at a
time (1.04 busy threads for each sample). That thread is the perspective's writer. Of its busy
stacks:

| Share | Where                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 83%   | `addLinks` (`add_links_bulk` → `link_mutations`)                                                                                                                    |
| 9%    | `addLinkExpression` (the signed flags)                                                                                                                              |
| 53%   | `persist_link_diff` → `SparqlStore::apply_diff`                                                                                                                     |
| 32%   | `write_link_quads_proof` → `verify_or_false`: the store verifies again the signature of each link as it writes it, also the links that the executor has just signed |
| 18%   | `create_signed_expression`: signing each link, of which 12% is `did_document_for_context` (a DID document read for each link)                                       |
| 21%   | the RocksDB commit (`oxigraph::store::Transaction::commit`)                                                                                                         |

The shares overlap, because one stack can hold more than one of these functions. About half of the
writer's time is ed25519 work: signing and verifying each link. This is executor behaviour. This
suite does not change it.

#### Why the seeding stops for minutes past 100 000 messages

Past about 110 000 messages, the seeding on `dev` stops for a while about every 100 000 messages,
and the stops grow longer. Between the stops, each 10 000 messages takes 26–34 s (about 345
messages/s), from the first to the millionth. In the run of a million messages, the 10 000 messages
that held a stop took this much more than the others:

| Stop at | 120k | 220k  | 330k  | 430k  | 540k  | 650k  | 750k  | 850k  | 960k  |
| ------- | ---- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Added   | 69 s | 132 s | 238 s | 261 s | 303 s | 489 s | 489 s | 640 s | 625 s |

The stops took about 2 900 s of the run's 6 122 s. The executor's peak RSS in that run was 9 957 MiB,
against 2 557 MiB after the seeding.

gdb samples of a stop (130 000 messages on `dev`, a 70 s stop at 110 500, 66 samples) show one busy
thread. 94% of its stacks are in `PerspectiveInstance::share_links_missing_remotely` →
`SparqlStore::get_all_links`: the fallback sync (`fallback_sync_loop`) reads every link of the
perspective, to find the shared links that the link language lacks. The space is a neighbourhood,
so the loop runs for it. After a pass that succeeds, it runs again 300 s later. The read costs
O(links), so the stops grow with the store. While the read runs, the seeding's writes are not
answered, and the writer threads have no busy stacks. The read holds `share_links_mutex`, and the
commit loop takes the same lock. The samples do not show where the writes wait; that part is a
guess. This is executor behaviour. This suite does not change it.

#### Why the seeding is not flat with #1734

The same sampling with #1734, at 100 000 messages (493 samples, 1.03 busy threads for each sample),
split into the first 30 000 messages and the last 30 000:

| Share of the writer's busy stacks                                      | First 30k (283 messages/s) | Last 30k (144 messages/s) |
| ---------------------------------------------------------------------- | -------------------------- | ------------------------- |
| `scope_index::writer::Apply::reconcile_member`                         | 13%                        | 41%                       |
| of which `aux_count` (a RocksDB read of a counter)                     | 13%                        | 39%                       |
| RocksDB merge of the counter's operands (`FullMergeV2`, `PushOperand`) | under 4%                   | 11–19%                    |
| `addLinkExpression` (the signed flags)                                 | 20%                        | 46%                       |
| `write_link_quads_proof` (verifying each link again)                   | 32%                        | 18%                       |

The scope index's writer reads a member count for each link that it writes, and that read takes a
larger share as the store grows. The merge frames suggest that the count is kept as RocksDB merge
operands, which each read merges again until a compaction folds them. That is a guess from the
stacks; the suite does not prove it. The rest of the write path is the same as on `dev`. The
sampled run took 495 s under gdb, against 435 s without it.

#### Why the seeding slowed with the watch on

Before the suite removed the watch, the seeding slowed as the store grew. With no writes for 30 s,
the executor used 0.2 s of CPU per 5 s at 0 messages, 4–5.5 s at 10 000, and 7.3–9 s at 50 000.
gdb samples at 10 000 messages put 92% of the busy stacks while idle, and 75% while filling, in
`PerspectiveInstance::run_auto_processor_tick`:

- Each tick reads all the messages in scope again (`gather_transcript_sparql`), which costs
  O(messages). It then adds each to the pending list through `WatcherState::record_item`, which
  first checks for that item with a linear search (`auto_processor/watcher.rs:258`). That is
  O(messages²) for each tick.
- With no language model, no item is ever processed. Items stay pending, so the tick runs at its
  fastest rate (500 ms). Two loops run it on the same space: the main agent's
  (`auto_processor_watch_loop`) and the signed-in user's
  (`managed_user_auto_processor_supervisor`).

The same cost is in the loads, where the suite keeps the watch (see the next section).

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
removed for the seeding and kept for the loads. Each row is one run of 5 loads.

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
