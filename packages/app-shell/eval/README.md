# Context eval

Measures how well the template editor's model carries out edits under each way of giving it the schema
reference. The question it exists to answer is whether splitting the ~87K-token reference helps (it
might for small local models) or hurts (it might for large cached ones). Answer that from a run
rather than from reasoning about it.

It runs the editor's own request loop (`src/shared/ai/editSession.ts`) against a live node, so a
result describes what the editor actually does. That means the payload too: the template is
compacted and numbered once before it is sent, exactly as `EditorStore.sendMessage` does, and
scored expanded, as `accept` stores it. A harness measuring the authored form would be describing
a product that has not shipped since #248.

## What it compares

| Strategy   | System prompt                                                                                                                                  | The rest of the reference                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `full`     | Everything, as the editor ships (~88K tokens)                                                                                                  | —                                                                       |
| `sections` | A core (~9K): structure, rules, routing, models, tokens                                                                                        | One tool per section, loaded whole (Josh's split from #196)             |
| `lookup`   | A larger core (~30K), adding the expression grammar and design-system props, plus the components and stores the template and request implicate | One `we_reference` tool fetching components, stores or sections by name |

See `src/shared/ai/contextStrategies.ts`.

## Cases

`cases.ts` has 17 edits across two starting templates: renames, styling, navigation, lists over store
data, queries, routes and tabs, forms with validation, conditionals, a responsive grid, and a
confirmation dialog. Each has a structural check and a hand-written reference solution.
`tests/evalCases.test.ts` runs in CI and proves, for every case, that doing nothing fails the check
and the reference solution passes it and validates.

A run passes a case when the check holds and the final template has no validation errors.

## Running it

It needs a running executor with the models you want to compare, and it spends tokens: 17 cases ×
3 strategies × each model, with up to 6 model calls per case.

```sh
WE_EVAL_TOKEN=<token> \
WE_EVAL_MODELS=claude-sonnet-5,qwen3.6:35b \
pnpm --filter @we/app-shell eval:context
```

| Variable             | Default                  |                                                                                                                  |
| -------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `WE_EVAL_URL`        | `http://localhost:12000` | The executor's HTTP base.                                                                                        |
| `WE_EVAL_TOKEN`      | none                     | A token with `AI_PROMPT`. For the desktop app's executor, the `--admin-credential` in `pgrep -fa ad4m-executor`. |
| `WE_EVAL_MODELS`     | `default`                | Model names or ids as Settings → AI shows them, comma-separated. `default` is the node's default LLM.            |
| `WE_EVAL_STRATEGIES` | all three                | Any of `full,sections,lookup`.                                                                                   |
| `WE_EVAL_CASES`      | all at the chosen scale  | Case ids from `cases.ts`. Overrides `WE_EVAL_SCALE`.                                                             |
| `WE_EVAL_SCALE`      | `small`                  | `small`, `large`, or both. See **Two scales** below — a large run costs several times more.                      |
| `WE_EVAL_REPEAT`     | `1`                      | Runs per combination. Models are not deterministic; use 3 before drawing a conclusion.                           |
| `WE_EVAL_TIMEOUT`    | `180`                    | Seconds one turn may take. Raise it for a local model — see below.                                               |

Start small: `WE_EVAL_CASES=rename-heading,todo-tasks WE_EVAL_STRATEGIES=full` confirms the setup
before a full run.

## Two scales, and why a run has to say which

The cases come in two groups, and mixing them in one run produces a number that cannot be compared
with anything.

**`small`** — seventeen cases on `blank` (394 chars) and `feed` (1,146). Every baseline so far is
of these. The template is about 1% of an ~86K payload, so what they measure is the **reference**
half of the context budget: which parts of the generated schema reference a strategy puts in front
of the model. They are nearly blind to the template half — a strategy that sent no template at all
would still pass most of them.

**`large`** — four cases on `kanban`, a real template (57,440 chars, 37,516 compacted). Here the
proportions invert and the template is the bigger half. These exist to measure what bounding the
template does, which the small cases cannot see.

One of the four turns on something no small case can reach. Kanban shares shapes: its card is one
shape used four times, its column header one used twice. So `kanban-card-radius` ("the cards") is
right only when the shape itself changes — a model that patches one use leaves three cards behind.

A second case asked for the opposite, a `split`, and was removed after the calibration run
recorded in `BASELINE.md`: the model correctly answered that restyling one column's cards wants a
condition inside the shared shape, not a copy of it. **A split case needs two uses that differ by
their context rather than by their data**; nobody has written one yet.

`WE_EVAL_SCALE` defaults to `small` so an unqualified run stays comparable with `BASELINE.md` and
stays cheap. Record the two in separate tables; a combined pass rate is not a figure about
anything.

**Put the summary in `BASELINE.md` after a run.** `eval/results/` is gitignored, so a run that
chooses a default and is not written down leaves nothing behind — which has happened once already.

Results go to `eval/results/<timestamp>/`, which is gitignored: `report.md` (a summary table,
a case × combination grid, and every failure with its reason) and `results.json`.

### Watching a run

A case settles into a line as it finishes, so a long run can be followed:

```
[ 7/34] ✓ sections · todo-tasks · 184s · 3 calls +1 context · 23m elapsed
[ 8/34] ✗ sections · post-count-badge · 201s · 4 calls +1 context +1 retries · 26m elapsed — no badge counting posts
```

**Do not pipe the run through `tail`, or anywhere else that is not a terminal.** Vitest holds a
file's console output until the file ends, so a piped run of several hours shows nothing at all until
it is over — no progress, and no way to tell a slow case from a wedged one. Use `tee` if the output
is wanted in a file as well:

```sh
… pnpm --filter @we/app-shell eval:context 2>&1 | tee eval-run.log
```

The progress lines go to stdout directly for the same reason, so they survive what vitest captures.
Against a local model, expect minutes per case rather than seconds: every tool call is another whole
prefill of the prompt, and a small model's prefill is not free.

### Models worth including

- **Claude Sonnet**, through the Anthropic protocol with coasys/ad4m#1044, so tools are native.
- **A small local model** — the case the split is meant for. Pick by what fits VRAM _including_ its
  KV cache, not by parameter count: on a 12GB card driving a desktop, qwen3:4b fits at its full
  window and qwen3:8b does not (see below). The 4B is a weak model and its absolute pass rate is
  low; what it measures is the ordering between strategies, which it reproduces faithfully.
- **A ~35B local model**, e.g. Qwen3.6, which Josh ran with the full prompt.

Local Ollama models need coasys/ad4m#1001, or `PARAMETER num_ctx` raised in a Modelfile. Without
either, Ollama's OpenAI-compatible endpoint silently truncates the prompt, and the run measures the
truncation instead of the strategy.

### A local model needs VRAM for its context, not just its weights

**Check that the model fits in VRAM at the context the node asks for, before trusting a local
run.** `ollama ps` says: a `PROCESSOR` column reading anything but `100% GPU` means part of the
model is on the CPU, and generation then runs several times slower than the hardware suggests.

The context is what usually does it, because the node asks for the model's _maximum_: the executor
reads `<arch>.context_length` from Ollama's `/api/show` and passes that as `num_ctx`, so a 10K
prompt still allocates the whole window. qwen3:8b is 5.2GB of weights and a further ~6GB of KV
cache at its 40,960-token window — 11GB, which does not fit a 12GB card that is also driving a
desktop.

When it does not fit, either make room or raise `WE_EVAL_TIMEOUT` and accept a long run. What is
not an option is leaving it: every case fails as "the model did not answer", and the run has
measured the timeout.

The recipe that worked here — a second Ollama on its own port, so the system service is untouched
and no sudo is needed:

```sh
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/home/you/.ollama-eval/models \
OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 ollama serve
```

`q8_0` roughly halves the cache and is near-lossless; `q4_0` quarters it and is a quality confound
worth avoiding while measuring quality. qwen3:4b then loads at 6.4GB, `100% GPU`, 40,960 tokens.

Then register a model entry pointing at that port, and **set a context limit**. Without one the
node asks for the model's own maximum: qwen3:4b advertises a 256K window, so the node clamps to its
131,072 default and allocates ~14GB, which spills to CPU and is _worse_ than leaving it alone.
Settings → AI does both: a custom endpoint with the Ollama protocol and `http://127.0.0.1:11435`
offers a "Context limit" field. It has to be the Ollama protocol. Through the OpenAI-compatible
`/v1` the limit is ignored.

Two things about changing a model entry, both learned the hard way:

- **`removeModel` + `addModel` picks up new config; `updateModel` does not.** A provider captures its
  base URL and context ceiling when its worker thread spawns, and an update does not rebuild them.
- **Never change model config while a run is in flight.** `updateModel` tears down the LLM channel,
  and the run fails with `Model '<id>' not found in LLM channel` partway through.

### A turn longer than 300s cannot be measured

Node's `fetch` gives up after 300s with no bytes — undici's default `headersTimeout` — and
`converse` passes no dispatcher, so a slow turn fails as a bare `fetch failed` with zero model calls
however high `WE_EVAL_TIMEOUT` is. It is not a limit the shipped editor has (browsers impose no
comparable cap), and it is not ad4m's, whose Ollama timeout is 600s.

It matters because it is **not neutral between strategies**: a larger core takes proportionally
longer to prefill, and the node does not stream the first byte through for Ollama, so the silence is
longer. In the 4B run `lookup` lost four cases to it and `sections` none — which means a comparison
taken at face value understates the larger-core strategy. Compare on the cases both arms ran.

Raising it needs a dispatcher with `headersTimeout` disabled, which means adding `undici`.

## Reading the numbers

- **Passed** is the headline.
- **Model calls** and **context calls** show how much a strategy makes the model work to find out
  what it needs.
- **Retries** count patches refused by validation. A strategy that leaves the model guessing
  shows up here first.
- **Sent per case** is every character sent across a case's calls, ÷4, before caching. It is not
  cost. A provider caches a repeated system prompt, so `full` is far cheaper on Claude than this
  column suggests. Sections loaded through tools sit in the conversation, not the system prompt, so
  they are not cached.
