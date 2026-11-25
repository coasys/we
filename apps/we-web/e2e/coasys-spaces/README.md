# coasys-spaces — the product end-to-end suite

These tests drive the built Coasys app in a real Chromium against a real AD4M executor. The executor runs in
multi-user mode with MCP on. The suite follows the product film: a space is made, people join, a
call is held, records are found in what was said, a social DNA package shapes the space, flows move
those records, an agent works over MCP, and the space is read as a Feed, a page, a canvas and a theme.

Each step checks two things: **what the screen shows** (Playwright, by role and accessible name) and
**what is stored** (links read from Node with `@coasys/ad4m`, or through the backend ports from
`@we/backend-ad4m`). If a film step is not shipped yet, it is an `it.todo` with a one-line reason.
The suite does not skip a step silently.

## Coverage

| Vertical              | File                             | Asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Todo                                                                                                                                                    |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 space              | `v1-space.e2e.mjs`               | Alice makes a shared space from the starter. The empty state and the tree show. The starter's SHACL shapes are in the perspective. The invite link is in Space settings. Bob joins from it. Both see two members.                                                                                                                                                                                                                                                                                                                      | "+ Invite" in the tree. The agent badge.                                                                                                                |
| V2 call               | `v2-call-interpretation.e2e.mjs` | The DNA installs through the UI. Its classes are the call's targets. A call starts and shows as live in the tree. Lines land in the transcript. Interpretation makes records of the package's classes, linked to the call. They show on the canvas. One dragged onto the canvas is stored as a placement, and when the canvas is opened again it reads its placements with no `cannot read` or `cannot watch` warning. Accepting one clears its pending mark. Leaving ends the live mark.                                              | The "Big picture" graph. The records in the Feed (product bug, see below).                                                                              |
| V3 social DNA         | `v3-social-dna.e2e.mjs`          | Install from a file. The shapes are in the space's SHACL. They are listed under Social DNA. They are offered and switched on as call targets. A field added in the shape wizard changes the stored shape.                                                                                                                                                                                                                                                                                                                              | The setup prompt. Suggested shapes. A shape edited by voice.                                                                                            |
| V4 Decide flow        | `v4-decide-flow.e2e.mjs`         | The package's workflows install with it and the Workflows page lists them. Bob joins. A call finds a TeamQuestion, and Alice accepts it. Alice starts Decide from the inspector and moves it step by step. The gated move waits for a second approval. Bob agrees, and the history has both approvers. Alice's screen follows.                                                                                                                                                                                                         | The ring diagram. The timeline. The decision spec.                                                                                                      |
| V5 Build flow + agent | `v5-build-agent.e2e.mjs`         | An agent account speaks only MCP. It joins from the neighbourhood link, finds the Task with `instance_query`/`instance_get`, and takes it with `instance_update`. Alice's screen shows the owner. The agent moves the Task through the flow, and Alice's screen follows. Shipped without evidence is refused (`unmet`). The agent makes a `LinkBlock` with `instance_create`, adds it to the Task's responses with `instance_add_to_collection`, asks again, and the move waits. Alice agrees, and the Task ships with both approvers. | The agent asks for a flow move over MCP (no MCP tool proposes one). The agent in the call. CONTEXT for the agent. The decision spec starts Build.       |
| V6 interfaces         | `v6-interfaces-feed.e2e.mjs`     | A call finds records, and the call is a record of the space. The space reads as a canvas (records, no lines) and as a page again. A personal theme from Space settings → Appearance repaints the page.                                                                                                                                                                                                                                                                                                                                 | The Feed: the call, its lines, what was found, and a line's call button (product bug, see below). A Board for Build. A Vote for Decide. The Graph view. |

The verticals run in order in one process (`all.e2e.mjs`). They share one executor, one served
app and one browser (`context.mjs`). Each vertical makes its own accounts and its own space, so one
vertical's installs do not leak into the next. When a step fails, the later steps of that vertical are
skipped, and the other verticals still run.

## Tiers

`COASYS_SPACES_TIER` selects the tier.

- **`stub`** (default) — no model, no microphone, no GPU.
  - `stub-llm.mjs` serves an OpenAI-compatible endpoint. It answers interpretation from a script.
  - What is said goes in as typed lines, written from Node as the call's author. This is the same
    `TextBlock` with `source: 'typed'` that the transcribe module's composer writes.
  - The results are exact and repeatable, so the steps assert the exact records.
  - The suite registers the call's interpretation watch from Node (`watchCall` in `call.mjs`). It sends
    the same request that the app's `watchConversation` sends. This is necessary because the app
    registers a call's watch only when the transcribe module files its first transcribed line. With
    no transcription model, the module does not join the call. Thus the app does not watch a call
    that has only typed lines (see "Product gaps" below).
  - When interpretation does not find the records, the error includes what the executor holds for the
    call's watch: the config links, the turns that its scope query reads, and the calls made to the
    stub.
- **`real`** — a real language model, and a speech-to-text model for the call.
  - The fake microphone plays a recording, and the executor sends each utterance to its
    transcription model. The executor runs no model itself: every model is a model on an endpoint,
    a server that the executor reaches over HTTP.
  - `COASYS_SPACES_TRANSCRIPTION_BASE_URL` names an OpenAI-compatible speech server (for example
    speaches). If it is not set, the stub server writes the transcript: it answers each utterance
    with the next line of the recording (`TRANSCRIPT` in `stub-llm.mjs`). The run log then says
    `transcription is stubbed`. The audio path (microphone, worklet, executor, upstream) still runs;
    only the speech-to-text step is fixed.
  - The steps assert the shape of the result (records of the package's classes, linked to the call),
    not exact titles.

### The stub's reply format

WE registers its call watch with no tool budget, so the executor takes its single-shot path:

- It sends one non-streaming `POST /v1/chat/completions`, with no `tools`.
- The last user message is a JSON document `{"classes":[…], "transcript":[…]}`. The earlier user
  messages are few-shot examples.

The stub reads the last user message and answers with a **bare JSON array**, for example
`[{"class":"Task","title":"…", …fields}]`. This is the simplest answer the executor's parser accepts.
The parser (`parse.rs`) takes the first JSON value in the content.

The stub has the same discipline that a real model is asked for:

- It answers only the classes that the prompt offers.
- It fills only the fields that the prompt lists.
- It does not propose a record whose title the prompt lists as existing.

So the result converges through the stub's own answers, not through the executor's dedup.

## The social DNA package

`SOCIAL_DNA_PACKAGE` names the package. The default is `fixtures/software-team.dna.json`.

A package is a **WE bundle** (`format: "we-bundle"`, see `docs/architecture/apps-as-data.md`) with
`recordTypes` (TeamQuestion, Tension, Decision, Task), the `workflows` they move through, and a theme:

```jsonc
{
  "format": "we-bundle",
  "recordTypes": [{ "name": "Task", "manifest": { "entities": { "Task": { … } } } }, …],
  "workflows": [ /* WorkflowDefinition[] — @we/backend-shared, workflows.ts */ ]
}
```

- **It installs through the UI.** The path is Settings → Apps & templates → install from a file, with the
  space ticked in the install prompt. A person takes the same path. Setting the space up adds the record
  types and installs the workflows.
- **The suite reads the workflows back from Node** (`expectWorkflows`), through
  `createAd4mBackendPorts(client).workflows`, after declaring the package's shapes in its own process
  (`schemas.declareInDataset`, module id `shape/<name>`): Build's evidence names a relation of a bundle
  record type (`responses` of a Task), and the port resolves a relation only from shapes declared in
  the process that uses it.
- **`TeamQuestion`, not `Question`.** The Coasys starter brings a `Question` of its own, and setting a
  space up refuses a record type of a name the space already has from another app.

The fixture holds two flows:

- **Decide**: TeamQuestion, Raised → Discussed → Options → Decided. Decided needs two approvals.
- **Build**: Task, ToDo → Doing → Review → Shipped. Shipped needs evidence (a `LinkBlock` among the Task's
  `responses`) and two approvals.

## Running it locally

Linux x64 only, because that is the one platform that ad4m publishes executors for.

```sh
unset NODE_ENV
pnpm install
GITHUB_TOKEN=$(gh auth token) pnpm e2e spaces   # --tier stub|real, --only v2,v4, --no-build
```

`pnpm e2e spaces` builds the app with the Coasys seed (`WE_SEED=seeds/coasys.seed.json pnpm
build:web`), fetches the pinned executor once into `~/.cache/we` (`pnpm ad4m:executor`), and runs
`pnpm --filter @we/app-web test:spaces`. That last command is the suite on its own, for a build and an
executor you already have.

- `GITHUB_TOKEN` raises GitHub's rate limit for the executor download. Without it, anonymous downloads can
  fail.
- `--only v2,v4` (`COASYS_SPACES_ONLY`) runs only the verticals that you name.
- A full stub run is long, because it makes many accounts and spaces and waits for P2P sync. Run it
  detached (for example under `systemd-run --user`) and read the log.

For the real tier:

```sh
COASYS_SPACES_LLM_BASE_URL=http://127.0.0.1:8080/v1 COASYS_SPACES_LLM_MODEL=<model> \
COASYS_SPACES_TRANSCRIPTION_BASE_URL=http://127.0.0.1:8000/v1 \
pnpm e2e spaces --tier real
```

Leave out `COASYS_SPACES_TRANSCRIPTION_BASE_URL` to use the stub server's transcript instead of a
speech server. The speech server must already have the model: the suite waits up to three minutes
for the executor to report it `READY`, and does not download it.

The fake microphone plays `fixtures/call.wav`: the four lines in `stub-llm.mjs` (`LINES`), spoken by
a TTS voice with 1.5 s of silence before, between and after them, 16 kHz mono PCM (19.7 s). A
speech-to-text model reads it back word for word:

1. "Sync dropped my edits again. Should we rebuild it?"
2. "Okay: mobile comes first this quarter."
3. "A rebuild could push back the v2.4 release."
4. "Alice will rebuild the sync script by Friday." (the line that states a task, for V5)

Change `LINES`, `HEARD` and the recording together. `COASYS_SPACES_WAV` names another recording.

- Chromium plays the recording in a loop. So the suite waits until the call's stored lines hold one
  word of each line (`HEARD`: edits, quarter, release, friday), and then presses the call bar's
  "Stop transcribing". The call and its interpretation watch stay. Interpretation then reads one pass of
  the recording, not a transcript that grows every 20 s.
- The transcript check reads those words from the call's `TextBlock` records. Then it finds on the
  screen a stored line that holds one of them, as the speech model wrote it. No space name holds these words,
  so only the transcript can pass the check.
- V4 waits for a titled `TeamQuestion` and V5 for a titled `Task`. Each waits for the class that it
  uses, not for the first record of any class.
- A wait longer than a minute writes one line each minute (`[until] still waiting for …`), so that
  CI's no-output timeout does not stop a long real-tier run.

### A red V4 or V5 in the real tier

In the real tier, a model decides what is in the call. If V4 does not get a `TeamQuestion` or V5 does
not get a `Task`, the cause can be model variance and not a product break. To find which:

1. Read the step's error. It ends with the interpretation facts: the call's watch config, the `turns`
   that its scope query reads, and the call's links. If the turns hold the four lines and the call
   has records of other classes, interpretation ran. Step 2 says whether it asked for that class.
2. Read `executor.log` in the artifacts. Find the interpretation lines:
   - `🧠 interpretation start … classes=[…]` — a pass started, and the classes it asked for.
   - `✅ 🧠 interpretation done … bases_written=N` — the pass ended and wrote N records.
   - `❌ 🧠 interpretation failed … err=…` (after `prompt attempt N failed` warnings) — the model
     endpoint refused the prompt, for example because the prompt is larger than its context.

   A pass can write records without having asked for the missing class, so `bases_written` above 0
   says nothing on its own. First check that the class is a target of the call: it is in the
   `classes=[…]` of the passes, and in the call's watch config in the step's error (the space's
   interpretation targets, Space settings → Features → "What new calls look for", when the call
   started). If it is not, the cause is the interpretation setup, not the model. If the passes asked for
   the class, ended with `bases_written` above 0, and the class is not in the step's records, the
   cause is model variance. If no pass started, or every pass failed, the cause is a product break
   or a setup break.

3. Look at the screenshot and the ARIA snapshot of the failed step. Make sure that the call bar shows
   "Transcribe this call" (transcription stopped) and that the transcript shows the lines.
4. If it is model variance, run the vertical again (`COASYS_SPACES_ONLY=v4`) or use a stronger model.
   The stub tier is the gate for product breaks.

### Environment

| Variable                                           | Use                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `COASYS_SPACES_TIER`                               | `stub` (default) or `real`.                                                                                |
| `COASYS_SPACES_LLM_BASE_URL`, `_MODEL`, `_API_KEY` | The real tier's OpenAI-compatible language model.                                                          |
| `COASYS_SPACES_LLM_ENDPOINT_KIND`                  | The endpoint kind of that server. The default is `OPEN_AI_COMPATIBLE`. Use `LLAMA_SERVER` for llama.cpp.   |
| `COASYS_SPACES_LLM_NATIVE_TOOLS`                   | `true`: send tools as tool definitions, not in the prompt. If it is not set, the executor decides.         |
| `COASYS_SPACES_LLM_REQUEST_TIMEOUT_SECS`           | The time one request may take, queueing included. If it is not set, the executor's default applies.        |
| `COASYS_SPACES_LLM_MAX_NUM_CTX`                    | The context the server gives one request. If it is not set, the executor sends no output cap.              |
| `COASYS_SPACES_TRANSCRIPTION_BASE_URL`             | The real tier's OpenAI-compatible speech server. If it is not set, the stub server writes the transcript.  |
| `COASYS_SPACES_TRANSCRIPTION_MODEL`                | The model on that server. The default is the transcription model that AD4M recommends.                     |
| `COASYS_SPACES_TRANSCRIPTION_API_KEY`              | The key for that server. The default is no key.                                                            |
| `COASYS_SPACES_WAV`                                | The real tier's recording, played by the fake microphone (default `fixtures/call.wav`).                    |
| `COASYS_SPACES_ONLY`                               | A comma list of verticals (`v1`…`v6`).                                                                     |
| `COASYS_SPACES_ARTIFACTS`                          | The folder for failure artifacts. Else `WE_E2E_ARTIFACTS`, else a new temp folder.                         |
| `SOCIAL_DNA_PACKAGE`                               | The package to install.                                                                                    |
| `AD4M_EXECUTOR`                                    | The executor binary. If it is not set, the pinned commit's executor is used (`scripts/ad4m-executor.mjs`). |
| `WE_CHROME`                                        | The Chromium binary, in place of the one `chromePath()` in `@we/e2e` finds.                                |
| `WE_LIVE_VERBOSE`                                  | Writes each page's console log when a vertical passes too.                                                 |
| `WE_LIVE_LOG`                                      | Writes the executor's output to this file.                                                                 |
| `GITHUB_TOKEN` / `GH_TOKEN`                        | For the executor download.                                                                                 |

## Timings

The suite measures how long the product takes from a person's action to what the person sees. It
adds no test of its own. It times the steps of V2 and V6 while they run.

A metric is in milliseconds and lower is better. A step that fails or is skipped records nothing:
its metrics are left out of the file. A metric is never written as 0. A timing that cannot be taken
is said in the log and left out. Timing never decides if a step passes. A metric that repeats is
reported as its median. Some also report the largest sample as `<name>_max_ms`.

The page takes the times (`probe.mjs`). A watcher in the page marks the frame in which a thing
shows. All the watchers of a page share one loop, which reads the page once a frame and stops when
no watcher is left. A click starts the clock at the event's own time stamp. Where a step writes data from Node,
the clock starts at that write.

| Metric                                         | Start                                                       | End                                                      | Tier                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| `call.join_ms`                                 | The click on "Start a call".                                | The "Live" tag shows on the call's row in the tree.      | Both. Samples from V2 and V6.                                         |
| `call.leave_ms`                                | The click on "Leave the call".                              | The "Live" tag is gone from the call's row.              | Both.                                                                 |
| `transcript.line_ms`, `transcript.line_max_ms` | Stub: the suite writes a line into the call (one per line). | The line's text shows on the page.                       | Stub: the write-to-screen time of a line.                             |
|                                                | Real: the click on "Unmute" (one sample).                   | The first heard word shows on the page.                  | Real: includes the recording, the speech model and the write.         |
| `interpretation.first_record_ms`               | The first transcript line shows.                            | The Interpretation button names at least one suggestion. | Stub: the scripted model. Real: the language model named in `params`. |
| `interpretation.all_records_ms`                | The last transcript line shows.                             | The button names all the suggestions that are stored.    | Stub only. The real model may still write more, so no total is known. |
| `graph.first_node_ms`                          | The click on "Canvas".                                      | The first node is in the graph.                          | Both.                                                                 |
| `graph.all_records_ms`                         | The click on "Canvas".                                      | The title of every record shows in the graph.            | Both.                                                                 |
| `graph.zoom_ms`, `graph.zoom_max_ms`           | A wheel event (5 rounds).                                   | The frame after the graph layer's transform changes.     | Both.                                                                 |
| `graph.pan_ms`, `graph.pan_max_ms`             | The first pointer move of a drag on bare ground (5 rounds). | The frame after the graph layer's transform changes.     | Both.                                                                 |
| `graph.drag_ms`, `graph.drag_max_ms`           | The first pointer move of a drag on a node (5 rounds).      | The frame after the node's position changes.             | Both.                                                                 |
| `graph.select_ms`, `graph.select_max_ms`       | The pointer up of a click on a node (5 rounds).             | The frame after the node gets its selected class.        | Both.                                                                 |

The graph gestures use the page's real mouse, because the graph captures the pointer. A gesture that
changes nothing (no bare ground, or no node under the pointer) records nothing.

`params` says what the numbers depend on, so no run is compared with a run of another tier:

- Stub tier: `{"tier": "stub"}`.
- Real tier: `{"tier": "real", "llm": <model>, "transcription": <model>}`. When the stub server
  writes the transcript, `transcription` is `"stub transcript"`.

At the end of the suite, the suite writes `{"job": "coasys-spaces", "metrics": [...], "detail": {...}}`
to `metrics.json` in `COASYS_SPACES_ARTIFACTS`. `detail` holds every sample. When `PERF_RESULTS_DIR` is
set, the suite also writes the metrics alone to `$PERF_RESULTS_DIR/coasys-spaces.json`. The writer is
`writeMetrics` in `@we/e2e`; the feed-scale suite uses it too.

## Artifacts

When a step fails, the suite writes these to `COASYS_SPACES_ARTIFACTS` (else `WE_E2E_ARTIFACTS`),
with `captureFailure` from `@we/e2e`, named `<vertical>-<step>-<person>-<page>`:

- a full-page screenshot of every page the vertical holds (`.png`);
- an ARIA snapshot of every page, its URL on the first line (`.aria.txt`);
- each page's console log;
- the vertical's Playwright trace (`npx playwright show-trace <file>.trace.zip`).

The executor's log (`executor.log`) is written there at the end of every run.

## The ad4m nightly

[coasys/ad4m#1708](https://github.com/coasys/ad4m/pull/1708) adds a nightly CircleCI job,
`coasys-spaces`, that runs this suite in the **real** tier against ad4m `dev`, not against WE's pin.
The job runs only after that PR merges. Until then, no nightly runs this suite. The job does two
things:

1. It overrides `@coasys/ad4m` and `@coasys/ad4m-connect` with tarballs packed from the ad4m commit under
   test. To do this, it replaces the `pnpm.overrides` entries in the root `package.json` with
   `file:` paths to the `.tgz` files, and then runs `pnpm install` and `pnpm build:web`.
2. It sets `AD4M_EXECUTOR` to the executor built from that same commit. The suite then runs that
   binary instead of downloading the pinned one.

The client, the app's connect UI and the executor then all come from the same commit. The job gives
the real tier a model endpoint on its runner (see the PR for the model and its context window).
The job's `test` step does not pass a speech server, so its transcript comes from the stub server
unless `COASYS_SPACES_TRANSCRIPTION_BASE_URL` is set in the job's environment. The stub tier needs
no model: it runs locally, and on WE's pin in the `spaces` job of
`.github/workflows/ad4m-live.yaml`.

## Selectors

Find things by role and accessible name. When a control has no name, add a `label` to the product
instead of a CSS selector.

Shadow DOM matters in one way. `we-tree` and `we-modal` put their `role` element inside the shadow
root and slot their content, so the content is not a DOM descendant of that role element. To find
the rows or the content, start from the host: `spaceTree()` in `steps.mjs`, and `we-modal` in
`dna.mjs`.

## Backlog (the todos)

- V1: "+ Invite" in the tree. The agent badge on a member.
- V2: the "Big picture" graph of what a call found. The records in the Feed (blocked by the Feed bug below).
- V3: the setup prompt "What are you doing together?". Suggested shapes. A shape edited by voice.
- V4: the ring diagram ("YOU ARE HERE"). The timeline of moves. The decision spec.
- V5: an MCP tool to propose a flow move. The agent in the call. CONTEXT handed to an agent. The decision
  spec starting Build.
- V6: the Feed and a line's call button (blocked by the Feed bug below). A Board for Build. A Vote for Decide.
  The Graph view.

## Product bugs that block steps

- **The Feed is empty when a target class comes from a bundle.** The module host's `findEntities`
  looks a class up in the global entity registry (`packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx:487`,
  `getEntity`). A class that a bundle declares in the space (the starter's `Question`) is not there,
  so the read throws `Model "Question" not found in registry`. The Feed reads all kinds in one
  `Promise.all` (`packages/module-system/feed/src/feed.ts:244`), so one class fails the whole read.
  The Feed then shows "Nothing said here yet". The Feed steps of V2 and V6 are todos (`FEED_BUG` in
  `steps.mjs`).

## Product gaps the suite works around

- **A call that nobody transcribes is not interpreted.** Typed lines (`addMessage`,
  `packages/module-system/transcribe/src/store.ts`) do not register the call's watch. Only
  `ensureCollection` registers it, on the first transcribed line. With no transcription model,
  auto-join stops (`giveUpAutoJoin`, "no-model"). The suite registers the watch from Node.
- **No MCP tool proposes a flow move.** V5 moves the flow through the workflow port.
- **Flow evidence needs shapes declared in-process.** A relation in a flow's evidence resolves only
  from shapes declared in the process that installs the flow. The suite declares them before the install.
- **The Workflows page does not hear another client's install.** `WorkflowStore` reads the space's
  workflows when the space changes and after its own writes
  (`packages/app-shell/src/frameworks/solid/stores/WorkflowStore.tsx:272-302`). The flows install from
  Node, so V4 and V5 load the space again after the install.
- **A page load during `share()` loses the space's address.** `createSpace` waits for the `we://url`
  link before it returns.
