/**
 * The context eval: every case, under every context strategy, against every model asked for.
 *
 * Runs the editor's own request loop (`runEditSession`) against a live node's `/v1/chat/completions`,
 * so what it measures is what the editor does. Not part of `pnpm test` — it needs a running
 * executor with models, and it spends tokens. See `eval/README.md` for how to run it.
 *
 * Every combination is recorded, pass or fail; a model failing a case is a result, not a test
 * failure. The run fails only when the node cannot be reached at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { requestMessage, updateSchemaTool } from '@shared/ai/aiInfra';
import { CONTEXT_STRATEGIES, type ContextStrategyId, prepareContext } from '@shared/ai/contextStrategies';
import { runEditSession } from '@shared/ai/editSession';
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import { schemaContext } from '@we/ai-context';
import { createAd4mLanguageModelPort } from '@we/backend-ad4m';
import { buildValidationContext, compactDefinitions, contextData, ensureNodeIds } from '@we/schema-shared';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { EVAL_CASES, scaleOf, startingTemplate } from './cases';
import { type EvalRecord, reportMarkdown } from './report';
import { scoreCase } from './score';

const env = process.env;
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const url = env.WE_EVAL_URL || 'http://localhost:12000';
const token = env.WE_EVAL_TOKEN || '';
const models = list(env.WE_EVAL_MODELS).length ? list(env.WE_EVAL_MODELS) : ['default'];
const strategies = (list(env.WE_EVAL_STRATEGIES).length ? list(env.WE_EVAL_STRATEGIES) : CONTEXT_STRATEGIES).filter(
  (s): s is ContextStrategyId => (CONTEXT_STRATEGIES as string[]).includes(s),
);
const caseIds = list(env.WE_EVAL_CASES);
/*
  Which scales to run. Defaults to `small` — the seventeen cases on `blank` and `feed` that every
  recorded baseline is of, so an unqualified run stays comparable with `BASELINE.md` and stays
  cheap. The large cases send a real template and cost several times as much per call, so asking
  for them is deliberate: `WE_EVAL_SCALE=large`, or `small,large` for both.
*/
const scales = list(env.WE_EVAL_SCALE).length ? list(env.WE_EVAL_SCALE) : ['small'];
const cases = caseIds.length
  ? EVAL_CASES.filter((c) => caseIds.includes(c.id))
  : EVAL_CASES.filter((c) => scales.includes(scaleOf(c.template)));
const repeat = Math.max(1, Number(env.WE_EVAL_REPEAT) || 1);
/**
 * How long one turn may take, in seconds.
 *
 * The port's default of 180s suits a hosted model and is far too short for a local one whose
 * weights and KV cache do not both fit in VRAM: part of the model runs on the CPU, and a turn that
 * writes a template takes tens of minutes. Left at the default, such a run records every case as
 * "the model did not answer" and measures the timeout instead of the strategy.
 */
const timeoutMs = Math.max(1, Number(env.WE_EVAL_TIMEOUT) || 180) * 1000;

const port = createAd4mLanguageModelPort({}, () => ({ url, token, converseTimeoutMs: timeoutMs }));
const validationContext = buildValidationContext(contextData);
const records: EvalRecord[] = [];
const startedAt = new Date();

/**
 * One line per case, as it settles.
 *
 * Against a local model a full run is hours, and there is otherwise nothing to watch: vitest holds
 * a file's console output until the file ends, and holds it whatever the reporter is once stdout is
 * not a terminal — which it is not the moment the run is piped or redirected, as a run this long
 * will be. So the choice was a progress line or no way to tell a slow case from a wedged one, and
 * no way to know how far along a run is without waiting for it to finish.
 *
 * `process.stdout.write` rather than `console.log` for the same reason `afterAll` uses it: console
 * output from inside a test is captured and replayed at the end, which is exactly what this exists
 * to avoid.
 */
const total = models.length * strategies.length * cases.length * repeat;
let settled = 0;

function reportProgress(record: EvalRecord): void {
  settled += 1;
  const where = models.length > 1 ? `${record.model.slice(0, 8)} · ${record.strategy}` : record.strategy;
  const calls =
    `${record.modelCalls} call${record.modelCalls === 1 ? '' : 's'}` +
    (record.contextCalls ? ` +${record.contextCalls} context` : '') +
    (record.validationRetries ? ` +${record.validationRetries} retries` : '');
  // A failure's reason is the point of the line, so it is not truncated away.
  const why = record.passed ? '' : ` — ${record.reason || record.outcome}`;
  const count = `${settled}/${total}`.padStart(`${total}/${total}`.length);
  const elapsed = Math.round((Date.now() - startedAt.getTime()) / 1000);
  process.stdout.write(
    `[${count}] ${record.passed ? '✓' : '✗'} ${where} · ${record.caseId} · ` +
      `${(record.ms / 1000).toFixed(0)}s · ${calls} · ${Math.floor(elapsed / 60)}m elapsed${why}\n`,
  );
}

beforeAll(async () => {
  const response = await fetch(`${url.replace(/\/+$/, '')}/v1/models`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch((err: unknown) => {
    throw new Error(`Cannot reach a node at ${url} (${String(err)}). Set WE_EVAL_URL, or start the executor.`);
  });
  if (!response.ok) {
    throw new Error(`The node at ${url} refused /v1/models (${response.status}). Set WE_EVAL_TOKEN.`);
  }
});

afterAll(() => {
  if (!records.length) return;
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const dir = join(__dirname, 'results', stamp);
  mkdirSync(dir, { recursive: true });
  const meta = { startedAt: startedAt.toISOString(), url, models, strategies, cases: cases.map((c) => c.id), repeat };
  writeFileSync(join(dir, 'results.json'), JSON.stringify({ meta, records }, null, 2));
  const markdown = reportMarkdown(meta, records);
  writeFileSync(join(dir, 'report.md'), markdown);
  // Straight to stdout: vitest holds console output from hooks back, and the table is the point of the run.
  process.stdout.write(`\n${markdown}\nWritten to ${dir}\n`);
});

for (const model of models) {
  for (const strategy of strategies) {
    describe(`${model} · ${strategy}`, () => {
      for (const evalCase of cases) {
        for (let run = 1; run <= repeat; run++) {
          it(`${evalCase.id}${repeat > 1 ? ` #${run}` : ''}`, async () => {
            const start = startingTemplate(evalCase.template);
            /*
              One tree, compacted and numbered once, exactly as `EditorStore.sendMessage` does.

              This harness exists so a result describes what the editor actually does, and the
              editor stopped sending the authored template when `$defs` landed — it sends a
              compacted one, which is a different payload and a different set of ids. Measured
              against the authored form, every number here would be about a product that is no
              longer shipped.

              One tree and not two for the reason the editor had to learn: numbering walks in
              order and compaction changes the order, so a second derivation drifts and the ids
              the model is given stop meaning what the patcher resolves them to.
            */
            const sent = ensureNodeIds(compactDefinitions(structuredClone(start)).schema);
            const prepared = prepareContext(strategy, chatSystemPreamble, schemaContext, {
              request: evalCase.request,
              schema: sent,
            });
            const began = Date.now();
            const record: EvalRecord = {
              model,
              strategy,
              caseId: evalCase.id,
              run,
              passed: false,
              reason: '',
              valid: false,
              changed: false,
              outcome: 'error',
              ms: 0,
              systemChars: prepared.system.length,
              requestChars: 0,
              modelCalls: 0,
              contextCalls: 0,
              validationRetries: 0,
            };

            try {
              const result = await runEditSession({
                converse: port.converse!,
                system: prepared.system,
                turns: [{ role: 'user', text: requestMessage(evalCase.request, sent) }],
                tools: [updateSchemaTool, ...prepared.tools],
                resolveTool: prepared.resolveTool,
                schema: sent,
                validationContext,
                model: model === 'default' ? undefined : model,
                accept: () => 'Template updated successfully.',
              });
              const score = scoreCase(evalCase, start, result, validationContext);
              Object.assign(record, score, {
                requestChars: result.stats.requestChars.reduce((a, b) => a + b, 0),
                modelCalls: result.stats.modelCalls,
                contextCalls: result.stats.contextCalls,
                validationRetries:
                  result.stats.patchFailures + result.stats.structuralFailures + result.stats.semanticFailures,
              });
            } catch (err) {
              record.reason = err instanceof Error ? err.message : String(err);
            }
            record.ms = Date.now() - began;
            records.push(record);
            reportProgress(record);
          });
        }
      }
    });
  }
}
