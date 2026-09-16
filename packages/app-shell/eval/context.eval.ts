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
import { buildValidationContext, contextData, ensureNodeIds } from '@we/schema-shared';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { EVAL_CASES, startingTemplate } from './cases';
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
const cases = caseIds.length ? EVAL_CASES.filter((c) => caseIds.includes(c.id)) : EVAL_CASES;
const repeat = Math.max(1, Number(env.WE_EVAL_REPEAT) || 1);

const port = createAd4mLanguageModelPort({}, () => ({ url, token }));
const validationContext = buildValidationContext(contextData);
const records: EvalRecord[] = [];
const startedAt = new Date();

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
            const prepared = prepareContext(strategy, chatSystemPreamble, schemaContext, {
              request: evalCase.request,
              schema: start,
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
                turns: [
                  { role: 'user', text: requestMessage(evalCase.request, ensureNodeIds(structuredClone(start))) },
                ],
                tools: [updateSchemaTool, ...prepared.tools],
                resolveTool: prepared.resolveTool,
                schema: start,
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
          });
        }
      }
    });
  }
}
