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

| Vertical              | File                          | Asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Todo                                                                                                                                                    |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 space              | `v1-space.live.mjs`           | Alice makes a shared space from the starter. The empty state and the tree show. The starter's SHACL shapes are in the perspective. The invite link is in Space settings. Bob joins from it. Both see two members.                                                                                                                                                                                                                                                                                                                      | "+ Invite" in the tree. The agent badge.                                                                                                                |
| V2 call               | `v2-call-extraction.live.mjs` | The DNA installs through the UI. Its classes are the call's targets. A call starts and shows as live in the tree. Lines land in the transcript. Extraction makes records of the package's classes, linked to the call. They show on the canvas. Accepting one clears its pending mark. Leaving ends the live mark.                                                                                                                                                                                                                     | The "Big picture" graph. The records in the Feed (product bug, see below).                                                                              |
| V3 social DNA         | `v3-social-dna.live.mjs`      | Install from a file. The shapes are in the space's SHACL. They are listed under Social DNA. They are offered and switched on as call targets. A field added in the shape wizard changes the stored shape.                                                                                                                                                                                                                                                                                                                              | The setup prompt. Suggested shapes. A shape edited by voice.                                                                                            |
| V4 Decide flow        | `v4-decide-flow.live.mjs`     | Flows install and the Workflows page lists them. Bob joins. A call finds a Question, and Alice accepts it. Alice starts Decide from the inspector and moves it step by step. The gated move waits for a second approval. Bob agrees, and the history has both approvers. Alice's screen follows.                                                                                                                                                                                                                                       | The ring diagram. The timeline. The decision spec.                                                                                                      |
| V5 Build flow + agent | `v5-build-agent.live.mjs`     | An agent account speaks only MCP. It joins from the neighbourhood link, finds the Task with `instance_query`/`instance_get`, and takes it with `instance_update`. Alice's screen shows the owner. The agent moves the Task through the flow, and Alice's screen follows. Shipped without evidence is refused (`unmet`). The agent makes a `LinkBlock` with `instance_create`, adds it to the Task's responses with `instance_add_to_collection`, asks again, and the move waits. Alice agrees, and the Task ships with both approvers. | The agent asks for a flow move over MCP (no MCP tool proposes one). The agent in the call. CONTEXT for the agent. The decision spec starts Build.       |
| V6 interfaces         | `v6-interfaces-feed.live.mjs` | A call finds records, and the call is a record of the space. The space reads as a canvas (records, no lines) and as a page again. A personal theme from Space settings → Appearance repaints the page.                                                                                                                                                                                                                                                                                                                                 | The Feed: the call, its lines, what was found, and a line's call button (product bug, see below). A Board for Build. A Vote for Decide. The Graph view. |

The verticals run in order in one process (`all.live.mjs`). They share one executor, one served
app and one browser (`context.mjs`). Each vertical makes its own accounts and its own space, so one
vertical's installs do not leak into the next. When a step fails, the later steps of that vertical are
skipped, and the other verticals still run.

## Tiers

`COASYS_SPACES_TIER` selects the tier.

- **`stub`** (default) — no model, no microphone, no GPU.
  - `stub-llm.mjs` serves an OpenAI-compatible endpoint. It answers extraction from a script.
  - What is said goes in as typed lines, written from Node as the call's author. This is the same
    `TextBlock` with `source: 'typed'` that the transcribe module's composer writes.
  - The results are exact and repeatable, so the steps assert the exact records.
  - The suite registers the call's extraction watch from Node (`watchCall` in `call.mjs`). It sends
    the same request that the app's `watchConversation` sends. This is necessary because the app
    registers a call's watch only when the transcribe module files its first transcribed line. With
    no transcription model, the module does not join the call. Thus the app does not watch a call
    that has only typed lines (see "Product gaps" below).
  - When extraction does not find the records, the error includes what the executor holds for the
    call's watch: the config links, the turns that its scope query reads, and the calls made to the
    stub.
- **`real`** — a real model and Whisper.
  - The fake microphone plays a recording, and the executor's Whisper writes it. Whisper's model may
    download on the first run.
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
`recordTypes` (Question, Tension, Decision, Task) and a theme. It has one extra field:

```jsonc
{
  "format": "we-bundle",
  "recordTypes": [{ "name": "Task", "manifest": { "entities": { "Task": { … } } } }, …],
  "flows": [ /* WorkflowDefinition[] — @we/backend-shared, workflows.ts */ ]
}
```

- **The bundle half installs through the UI.** The path is Settings → Apps & templates → install from a
  file, with the space ticked in the install prompt. A person takes the same path.
- **The flows install from Node.** Bundles have no field for flows yet, so the suite calls
  `createAd4mBackendPorts(client).workflows.install`. The app's Workflows page writes through the same
  port.
  - Before the install, the suite declares the package's shapes in its own process (`schemas.declareInDataset`,
    with module id `shape/<name>`). Build's evidence names a relation of a bundle record type
    (`responses` of a Task), and the port resolves a relation only from shapes declared in the
    process that installs the flow.

The fixture holds two flows:

- **Decide**: Question, Raised → Discussed → Options → Decided. Decided needs two approvals.
- **Build**: Task, ToDo → Doing → Review → Shipped. Shipped needs evidence (a `LinkBlock` among the Task's
  `responses`) and two approvals.

## Running it locally

Linux x64 only, because that is the one platform that ad4m publishes executors for.

```sh
unset NODE_ENV
pnpm install
WE_SEED=seeds/coasys.seed.json pnpm build:web
GITHUB_TOKEN=$(gh auth token) pnpm ad4m:executor   # fetches the pinned executor once, into ~/.cache/we
pnpm --filter @we/app-web test:spaces
```

- `GITHUB_TOKEN` raises GitHub's rate limit for the executor download. Without it, anonymous downloads can
  fail.
- `COASYS_SPACES_ONLY=v2,v4` runs only the verticals that you name.
- A full stub run is long, because it makes many accounts and spaces and waits for P2P sync. Run it
  detached (for example under `systemd-run --user`) and read the log.

For the real tier:

```sh
COASYS_SPACES_TIER=real \
COASYS_SPACES_LLM_BASE_URL=http://127.0.0.1:8080/v1 COASYS_SPACES_LLM_MODEL=<model> \
pnpm --filter @we/app-web test:spaces
```

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
  "Stop transcribing". The call and its extraction watch stay. Extraction then reads one pass of
  the recording, not a transcript that grows every 20 s.
- The transcript check reads those words from the call's `TextBlock` records. Then it finds on the
  screen a stored line that holds one of them, as Whisper wrote it. No space name holds these words,
  so only the transcript can pass the check.
- V4 waits for a titled `Question` and V5 for a titled `Task`. Each waits for the class that it
  uses, not for the first record of any class.
- A wait longer than a minute writes one line each minute (`[until] still waiting for …`), so that
  CI's no-output timeout does not stop a long real-tier run.

### A red V4 or V5 in the real tier

In the real tier, a model decides what is in the call. If V4 does not get a `Question` or V5 does
not get a `Task`, the cause can be model variance and not a product break. To find which:

1. Read the step's error. It ends with the extraction facts: the call's watch config, the `turns`
   that its scope query reads, and the call's links. If the turns hold the four lines and the call
   has records of other classes, extraction ran. Step 2 says whether it asked for that class.
2. Read `executor.log` in the artifacts. Find the interpretation lines:
   - `🧠 interpretation start … classes=[…]` — a pass started, and the classes it asked for.
   - `✅ 🧠 interpretation done … bases_written=N` — the pass ended and wrote N records.
   - `❌ 🧠 interpretation failed … err=…` (after `prompt attempt N failed` warnings) — the model
     endpoint refused the prompt, for example because the prompt is larger than its context.

   A pass can write records without having asked for the missing class, so `bases_written` above 0
   says nothing on its own. First check that the class is a target of the call: it is in the
   `classes=[…]` of the passes, and in the call's watch config in the step's error (the space's
   extraction targets, Space settings → Features → "What new calls look for", when the call
   started). If it is not, the cause is the extraction setup, not the model. If the passes asked for
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
| `COASYS_SPACES_LLM_BASE_URL`, `_MODEL`, `_API_KEY` | The real tier's OpenAI-compatible model.                                                                   |
| `COASYS_SPACES_WAV`                                | The real tier's recording, played by the fake microphone (default `fixtures/call.wav`).                    |
| `COASYS_SPACES_ONLY`                               | A comma list of verticals (`v1`…`v6`).                                                                     |
| `COASYS_SPACES_ARTIFACTS`                          | The folder for failure artifacts. The default is a new temp folder.                                        |
| `SOCIAL_DNA_PACKAGE`                               | The package to install.                                                                                    |
| `AD4M_EXECUTOR`                                    | The executor binary. If it is not set, the pinned commit's executor is used (`scripts/ad4m-executor.mjs`). |
| `WE_CHROME`                                        | The Chromium binary, if Playwright's is not found.                                                         |
| `WE_LIVE_VERBOSE`                                  | Writes each page's console log when a vertical passes too.                                                 |
| `WE_LIVE_LOG`                                      | Writes the executor's output to this file.                                                                 |
| `GITHUB_TOKEN` / `GH_TOKEN`                        | For the executor download.                                                                                 |

## Artifacts

When a step fails, the suite writes these to `COASYS_SPACES_ARTIFACTS`:

- a full-page screenshot of every page the vertical holds;
- an ARIA snapshot of every page;
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
2. It sets `AD4M_EXECUTOR` to the executor built from that same commit. The harness then runs that
   binary instead of downloading the pinned one.

The client, the app's connect UI and the executor then all come from the same commit. The job gives
the real tier a model endpoint on its runner (see the PR for the model and its context window). The
stub tier needs no model; run it locally, or in any job that has no model endpoint.

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

- **A call that nobody transcribes is not extracted.** Typed lines (`addMessage`,
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
