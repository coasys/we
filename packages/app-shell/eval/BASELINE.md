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

## 2026-10-04 — bounding the template, three arms

Does sending an outline instead of the template cost accuracy, and what does it cost in tokens?
Same four `kanban` cases, same `lookup` strategy, same node, same session — only the template
budget differs. 2 repeats, 24 runs in all.

| arm                    | passed  | valid | model calls | context calls | sent per case |
| ---------------------- | ------- | ----- | ----------- | ------------- | ------------- |
| whole template         | **8/8** | 8/8   | 2.0         | 0.0           | 116K          |
| bounded, budget 20,000 | **8/8** | 8/8   | 2.4         | 0.4           | 120K          |
| bounded, budget 4,000  | **8/8** | 8/8   | 3.0         | 1.0           | 150K          |

**Accuracy is untouched: 24 of 24, every arm.** This is the finding the approach needed. A model
edits from an outline plus the parts it was handed exactly as well as from the whole tree, so
bounding is not a trade of correctness for size — and that was not obvious beforehand.

**Cost is round trips, not payload.** The system prompt is 46K tokens and is re-sent on every
call, so one extra call costs far more than the template saved. Kanban's template is 39,412
characters and its outline 4,776: a saving of about 8.7K tokens per call against an extra call
costing over 50K. That is the whole of the 29% penalty in the bottom row.

**So the budget's real job is to buy preselection, not to shrink the payload.** The only
difference between the middle row and the bottom one is how much detail was sent unasked —
10,000 characters against 2,000 — and that halves the tool calls and nearly closes the cost gap.
Where preselection guesses right, there is no second call at all: `kanban-remove-load-more` took
2 calls at 20,000 and 3 at 4,000.

**Which makes bounding a FIT mechanism rather than a cost one.** On this template it is roughly
cost-neutral at a sensible budget. Its value is the template it makes editable at all: applying
the same arithmetic to `workshopTemplate` — 400,460 characters, outline 96,706 — bounding takes a
turn from about 292K tokens to 211K, and the first of those does not fit a 200K window. The plan
listed fit, cost and accuracy as three benefits; measured, it is fit, with cost a wash and
accuracy neutral.

**Not measured:** any of this on `workshopTemplate` itself, because no case uses it. The numbers
above for it are arithmetic from the measured per-call cost, not observation.

---

## 2026-10-04 — calibration of the `large` scale

Not a baseline: one strategy, one repeat, five cases, run to find out whether the new cases
discriminate at all before paying for a matrix. `lookup` against the node's `Claude`.

| case                      | result                     |
| ------------------------- | -------------------------- |
| `kanban-card-radius`      | ✓ (9s)                     |
| `kanban-one-card-apart`   | ✗ — **removed, see below** |
| `kanban-empty-icon`       | ✓ (4s)                     |
| `kanban-remove-load-more` | ✓ (7s)                     |
| `kanban-back-tooltip`     | ✓ (15s)                    |

4/5, valid 5/5, ~116K tokens sent per case against the small suite's 86K.

**The failure was the case's fault, and finding that out is what the run was for.**
`kanban-one-card-apart` asked for "just the cards in the unplaced column" to be restyled. Run
once it changed all four cards; re-run with the session log captured, it made no tool call at all
and asked a question instead — pointing out that nothing in this template draws the unplaced
cards as their own group, and that the way to restyle one column's cards is a CONDITION inside
the shared card shape rather than a copy of it.

That is the better answer. The case was scoring the wrong thing, so it is gone. Two things to
carry forward from it:

- **A split case needs two uses that differ by their CONTEXT, not by their data.** Where the
  difference is data, the right edit is a condition inside the shared shape, and asking for a
  split is asking for worse code.
- **A clarifying question scores as a failure.** It is indistinguishable here from a wrong edit,
  which means an ambiguous case quietly rewards a model that guesses over one that asks. Worth
  fixing before any case is written whose request could be read two ways.

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
