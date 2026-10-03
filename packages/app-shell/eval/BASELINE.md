# What the eval has measured

A run writes `report.md` and `results.json` to `eval/results/<timestamp>/`, which is gitignored —
it holds raw per-case output and spends tokens to produce. **The summary belongs here**, in the
repo, because these numbers decide which strategy the editor ships, and a decision whose evidence
lives in one person's terminal is a decision nobody can revisit.

Record the date, the commit, the models, the strategies, the repeat count and the table. Say what
the payload was: that is the part that goes stale. **Say which scale it was**, and keep the two in
separate tables — `small` and `large` answer different questions and a combined pass rate is a
figure about nothing. See "Two scales" in `README.md`.

---

## Not yet measured — the `large` scale

Five cases on a real template (`kanban`), added so the harness can see the half of the budget it
has been blind to. Nothing has been run against them; **this section is here so their absence is
visible rather than implied.**

What they are for: every figure below is from cases where the template is ~1% of the payload, so
none of them says anything about what trimming a template costs or buys. Two of the five also
test the shared-shape semantics `$defs` introduced in #248, which no run has ever exercised.

Expect them to cost several times a small case per call — the template is 37,516 chars compacted
against `blank`'s 394 — and the system prompt cache does not help, since the template rides in the
user turn.

---

## 2026-10-03 — the current baseline (scale: `small`)

`6788c202a`, the commit that made the harness send what the editor sends. 17 cases × 3 strategies
× **3 repeats** = 153 runs. Model: the node's `Claude`, which is `claude-sonnet-5` over the
**Anthropic protocol** — the path that caches; an OpenAI-compatible endpoint would not. Payload:
the template **compacted and numbered once**, as the editor sends it.

| strategy   | passed    | valid | model calls | context calls | sent per case |
| ---------- | --------- | ----- | ----------- | ------------- | ------------- |
| `full`     | 48/51     | 51/51 | 2.1         | 0.0           | 207K          |
| `sections` | 46/51     | 51/51 | 3.0         | 1.2           | 67K           |
| `lookup`   | **51/51** | 51/51 | 2.4         | 0.2           | 86K           |

**Every strategy produced a valid template every time.** Failures are always "did not do the
task", never "broke the schema", so validation is not what separates these.

### The failures, and which are findings

| case               | `full`  | `sections` | `lookup` |
| ------------------ | ------- | ---------- | -------- |
| `tabs-with-pages`  | **1/3** | 3/3        | 3/3      |
| `post-count-badge` | 3/3     | **0/3**    | 3/3      |
| `card-style`       | 3/3     | **1/3**    | 3/3      |
| `empty-state`      | 2/3     | 3/3        | 3/3      |
| the other 13       | 3/3     | 3/3        | 3/3      |

- **`full` loses `tabs-with-pages` two times in three**, with the same symptom each time:
  `root routes are ["/","/members"]` — it writes the Members route and drops `/posts`. `lookup`,
  with a third of the context, passes it three times in three. A large model doing _worse_ with
  more context, reproducibly. Not yet explained; worth its own look, because "less context is also
  better" is a different claim from "less context is cheaper" and would shape how much of a
  template a skeleton needs to keep.
- **`sections` loses `post-count-badge` every time** — a deterministic blind spot rather than
  variance. Loading whole sections behind tools never surfaces what that case needs.
- **`empty-state` under `full`** failed once with the session exhausted. One in three, no pattern:
  read as flakiness unless it recurs.

### What it decides

`lookup` stays the editor's strategy, now on the payload the editor actually sends. It is also the
cheaper of the two serious options — 86K per case against `full`'s 207K — so the better answer and
the smaller one are the same, which is not what the context plan assumed.

### Cost

**About $12 for all 153 runs**, read off the Anthropic billing page rather than estimated — an
arithmetic estimate from the cache figures below came out at $8, so treat a calculation here as a
lower bound and the bill as the number.

It is that low because the system prompt is cached. From the node's log:

```
Anthropic usage (claude-sonnet-5): in=275 out=92  cache_read=0       cache_write=143507
Anthropic usage (claude-sonnet-5): in=366 out=17  cache_read=143507  cache_write=0
```

The first call of a strategy writes the prefix; every later one reads it and pays full price for a
few hundred tokens. This only holds on the Anthropic protocol path — check Settings → AI before
assuming a run will be cheap.

---

## 2026-09, `feat/ai-context-eval` — the run that chose `lookup`

Superseded by the above, and kept because it is the reason this file exists. **Not recorded at the
time**; the figures below are reconstructed from the conversation that followed, so they are
indicative rather than evidence.

| model         | `full` | `sections` | `lookup`  |
| ------------- | ------ | ---------- | --------- |
| Claude Sonnet | 15/17  | —          | **17/17** |
| qwen3:4b      | —      | 4/13       | **6/13**  |

One repeat, and against the _authored_ template — a payload the editor stopped sending at #248.
The 2026-10 run reproduces its shape on the current payload: `full` loses cases that `lookup`
passes.

What it showed that the newer run does not: preselection, rather than splitting, is what makes a
reduced context work for a weak model. No small model has been re-measured on the current payload.
