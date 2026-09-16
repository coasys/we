# Context eval

Measures how well the template editor's model carries out edits under each way of giving it the schema
reference. The question it exists to answer is whether splitting the ~87K-token reference helps (it
might for small local models) or hurts (it might for large cached ones). Answer that from a run
rather than from reasoning about it.

It runs the editor's own request loop (`src/shared/ai/editSession.ts`) against a live node, so a
result describes what the editor actually does.

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
| `WE_EVAL_CASES`      | all                      | Case ids from `cases.ts`.                                                                                        |
| `WE_EVAL_REPEAT`     | `1`                      | Runs per combination. Models are not deterministic; use 3 before drawing a conclusion.                           |

Start small: `WE_EVAL_CASES=rename-heading,todo-tasks WE_EVAL_STRATEGIES=full` confirms the setup
before a full run.

Results go to `eval/results/<timestamp>/`, which is gitignored: `report.md` (a summary table,
a case × combination grid, and every failure with its reason) and `results.json`.

### Models worth including

- **Claude Sonnet**, through the Anthropic protocol with coasys/ad4m#1044, so tools are native.
- **A ~35B local model**, e.g. Qwen3.6, which Josh ran with the full prompt.
- **A ~8B local model**, the case the split is meant for.

Local Ollama models need coasys/ad4m#1001, or `PARAMETER num_ctx` raised in a Modelfile. Without
either, Ollama's OpenAI-compatible endpoint silently truncates the prompt, and the run measures the
truncation instead of the strategy.

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
