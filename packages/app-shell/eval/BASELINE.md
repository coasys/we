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

## 2026-10-26 — `toolset` against `lookup`, Sonnet 5.5 and qwen3:4b

Can the editor run on the tools a host's agent gets (`template_read`, `template_update` and
`get_documentation`, with the `template` topic as the whole prompt), without losing anything to the
35K prompt `lookup` ships? 23 cases at both scales, 3 repeats, the Electron dev node at `bc921da62`.

Two changes to the cases came first. `delete-with-confirm` was replaced by `post-details-dialog`:
the host now confirms a destructive action itself, so the case's own dialog was a warning the
editor refuses, and every run on both strategies failed 0/3 for doing the right thing.
`evalCases.test.ts` now checks that each solution is an edit the editor would keep. And a
`template_update` sent with its patches as JSON text, which Sonnet did once, is now read.

### Sonnet 5.5

| scale | strategy  | passed    | valid | model calls | context calls | retries | sent per case | median time |
| ----- | --------- | --------- | ----- | ----------- | ------------- | ------- | ------------- | ----------- |
| small | `lookup`  | **48/51** | 51/51 | 2.5         | 0.4           | 0.2     | 96K           | 8s          |
| small | `toolset` | **48/51** | 51/51 | 3.9         | 2.3           | 0.3     | 71K           | 8s          |
| large | `lookup`  | **18/18** | 18/18 | 2.0         | 0.0           | 0.0     | 154K          | 4s          |
| large | `toolset` | **18/18** | 18/18 | 2.0         | 0.0           | 0.0     | 66K           | 3s          |

**On Sonnet, `toolset` costs nothing in accuracy and sends less.** Its prompt is 7K where
`lookup`'s is 35K. It makes up some of that by reading topics (2.3 a case on the small cases),
and a topic read sits in the conversation, where it isn't cached. On large cases it never needs
to: the reference entries come with the first read. The failures are different cases, one or two
runs each: `responsive-grid` and `post-details-dialog` for `lookup`, `tabs-with-pages` and
`responsive-grid` for `toolset`, plus the stringified patches since fixed.

### qwen3:4b, 40,960 context, 100% GPU

| scale | strategy  | passed | valid | asked | timed out | model calls | sent per case | median time\* |
| ----- | --------- | ------ | ----- | ----- | --------- | ----------- | ------------- | ------------- |
| small | `lookup`  | 13/51  | 24/51 | 4     | 27        | 0.9         | 34K           | 44s           |
| small | `toolset` | 14/51  | 51/51 | 11    | 0         | 2.3         | 20K           | 40s           |
| large | `lookup`  | 6/18   | 13/18 | 3     | 5         | 1.7         | 148K          | 61s           |
| large | `toolset` | 7/18   | 18/18 | 6     | 0         | 2.0         | 58K           | 46s           |

\* Of the runs that finished.

**The headline is not a comparison.** All 32 `lookup` timeouts are the 300s `fetch` cap described
in `README.md`: a 35K prompt is too long for the 4B to prefill and answer in time, and the cap
falls on the bigger prompt only. **On the 37 runs both finished, `lookup` passed 19 and `toolset` 16.** So for this model the larger prompt is somewhat better on quality, and four to five times
slower: its median turn including the timeouts is 250s, where `toolset`'s is 40s.

Where the 4B fails under `toolset`, it is for one of three reasons:

- **It guesses rather than reads.** It made almost no documentation calls (0.1 a case).
  `page-background` asks for "the sunken surface colour": `lookup`'s prompt lists the colour
  roles and passed 3/3, while `toolset`'s doesn't and the model wrote `surface` 3/3.
- **It answers the last thing it read.** On workshop the first read is a long outline, and the
  model described the workspace in all six runs. `template_read` now ends with what the edit was
  for, and a re-run of the `toolset` arm (`2026-10-27T03-37-22-447Z`, 19/69, the same within
  noise) shows that worked: the model then found the right node and wrote the right patch. It
  wrote the patch as JSON in its reply instead of calling the tool, so it still failed.
- **It answers with nothing.** 11 runs ended after one call with no text and no tool call. The
  node doesn't log what the model sent back, so the cause isn't known.

### What it decides

For a capable model the editor can move to `toolset`: equal accuracy, a fifth of the prompt, and
one set of tools for the editor and a host's agent. For a 4B it is the trade above, and the
editor has neither the 300s cap nor a way to say which model is weak. That decision is left
open. The editor still ships `lookup`.

---

## 2026-10-04 — bounding `workshopTemplate`, and the bug it found

The template the bounding work exists for: 400,460 characters compacted, 3,068 nodes. Two cases,
`lookup`, whole against bounded at the shipped 60,000 budget.

**The first run was 0/2 on both arms, and that was not about bounding.** The session capture
showed the model asking `find: "No replies yet."`, getting back `? we-text — No replies yet.`,
and stopping: the node had no id, so there was nothing to patch. `ensureNodeIds` never walked
`meta.panels`, which on this template is 1,127 of 1,807 nodes — the Inspector panel's 870 among
them. Rendered, shown to the model, unaddressable. See the commit; the fix is in `indexer.ts` and
`treeUtils.ts`, and `findNodeById` needed it too.

After the fix:

| arm                    | passed  | valid | model calls | context calls | sent per case | median time |
| ---------------------- | ------- | ----- | ----------- | ------------- | ------------- | ----------- |
| whole template         | **2/2** | 2/2   | 2.0         | 0.0           | 354K          | 7s          |
| bounded, budget 60,000 | **2/2** | 2/2   | 2.0         | 0.0           | **183K**      | 4s          |

**Bounding halves the cost at identical accuracy, and adds no round trip.** 183K against 354K
tokens a case, and both arms answered in two calls — preselection found the target each time, so
`we_template` was never needed.

**This reverses the conclusion drawn from kanban alone.** Bounding costs ~3% there and saves ~48%
here, and the arithmetic says why: the saving is the template minus its outline, the cost is one
more call at system-prompt price, and the first grows with the template while the second does
not. Kanban is below the crossover and workshop is well above it. So it is a cost mechanism after
all — on the templates where cost is a problem, which is the only place the question arises.

What stands from the kanban run is narrower and still true: **where preselection misses, the
extra round trip can cost more than bounding saves.** That is the thing to protect, and it makes
preselection quality the lever rather than outline size.

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

**On THIS template bounding is roughly cost-neutral**, and at the time that read as "a fit
mechanism, not a cost one". The workshop run above corrects it: kanban is simply below the
crossover. The saving grows with the template and the extra call does not, so a small template
pays for bounding and a large one is paid by it.

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
