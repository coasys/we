# What the eval has measured

A run writes `report.md` and `results.json` to `eval/results/<timestamp>/`, which is gitignored —
it holds raw per-case output and spends tokens to produce. **The summary belongs here**, in the
repo, because these numbers decide which strategy the editor ships, and a decision whose evidence
lives in one person's terminal is a decision nobody can revisit.

Record: the date, the commit, the models, the strategies, the repeat count, and the table. Say what
the payload was — that is the part that goes stale.

---

## 2026-09, `feat/ai-context-eval` — the run that chose `lookup`

**Not recorded at the time**, and reconstructed here from the conversation that followed it, so
treat the figures as indicative rather than as evidence. This file exists because of that gap.

| model         | `full` | `sections` | `lookup`  |
| ------------- | ------ | ---------- | --------- |
| Claude Sonnet | 15/17  | —          | **17/17** |
| qwen3:4b      | —      | 4/13       | **6/13**  |

One repeat. The README's own guidance is three before drawing a conclusion, so the two cases Sonnet
lost under `full` may be noise; which two is not recorded.

What it decided: the editor sends `lookup`. What it showed: preselection, rather than splitting, is
what makes a reduced context work for a weak model.

**This baseline is stale.** It was measured against the _authored_ template. Since #248 the editor
compacts before sending, which is a different payload and a different set of ids — and until the
commit that added this file, the harness still sent the authored form, so it was no longer
measuring the product. Any comparison against these numbers is a comparison across two different
inputs.

---

## Next

Re-run the three existing strategies on the current payload before any new strategy is built:

```sh
WE_EVAL_TOKEN=<token> \
WE_EVAL_MODELS=claude-sonnet-5 \
WE_EVAL_REPEAT=3 \
pnpm --filter @we/app-shell eval:context
```

That re-establishes the baseline and answers whether `full` really does lose two cases that
`lookup` passes. Then add the skeleton arms.
