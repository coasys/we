/**
 * The template editor's request loop, against a scripted model.
 *
 * The editor and the context eval both run this, so what is pinned here holds for both: a patch that
 * validates is accepted, one that does not goes back to the model as an error and is retried, every
 * call is answered by name, a context tool is answered without touching the template, and a reply
 * cut off mid-call is never reported as applied.
 */
import type { ConversationReply, ConversationRequest, ConversationTurn } from '@we/backend-shared';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { buildValidationContext, contextData } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { updateSchemaTool } from '../src/shared/ai/aiInfra';
import { runEditSession } from '../src/shared/ai/editSession';

const validationContext = buildValidationContext(contextData);

const starter = (): SchemaNode =>
  ({
    type: 'Column',
    meta: { name: 'Test', description: '', icon: 'cube' },
    props: { bg: 'page' },
    children: [{ type: 'we-text', children: ['Hello'] }],
  }) as unknown as SchemaNode;

/** A model that answers with each reply in turn, and records what it was sent. */
function scripted(replies: ConversationReply[]) {
  const seen: ConversationRequest[] = [];
  let next = 0;
  return {
    seen,
    converse: async (request: ConversationRequest) => {
      seen.push({ ...request, turns: structuredClone(request.turns) });
      const reply = replies[next++];
      if (!reply) throw new Error('the script ran out');
      return reply;
    },
  };
}

const patch = (id: string, patches: unknown[]) => ({ id, name: 'update_schema', arguments: { patches } });
const addText = (words: string) => ({
  targetId: '',
  insert: { children: { node: { type: 'we-text', children: [words] } } },
});

function session(replies: ConversationReply[], extra: Partial<Parameters<typeof runEditSession>[0]> = {}) {
  const model = scripted(replies);
  const accepted: TemplateSchema[] = [];
  const turns: ConversationTurn[] = [{ role: 'user', text: 'do it' }];
  const run = runEditSession({
    converse: model.converse,
    system: 'system',
    turns,
    tools: [updateSchemaTool],
    schema: starter(),
    validationContext,
    accept: (template) => {
      accepted.push(template);
      return 'Template updated successfully.';
    },
    ...extra,
  });
  return { run, model, accepted, turns };
}

const children = (schema: SchemaNode) => (schema.children ?? []) as SchemaNode[];

describe('an edit session', () => {
  it('accepts a patch that validates, tells the model so, and finishes on its closing text', async () => {
    const { run, accepted, turns } = session([
      { text: 'Adding it.', calls: [patch('c1', [addText('World')])], finish: 'tool_calls' },
      { text: 'Done.', calls: [], finish: 'done' },
    ]);
    const result = await run;

    expect(result.outcome).toBe('done');
    expect(accepted).toHaveLength(1);
    expect(children(result.schema).map((c) => c.children?.[0])).toEqual(['Hello', 'World']);
    expect(turns.find((t) => t.role === 'tool')).toEqual({
      role: 'tool',
      callId: 'c1',
      result: 'Template updated successfully.',
    });
    expect(result.transcript).toContain('✓ Template updated');
    expect(result.stats).toMatchObject({ modelCalls: 2, patchCalls: 1, accepted: 1, semanticFailures: 0 });
  });

  it('sends an invalid patch back as an error, and accepts the retry', async () => {
    const { run, accepted, model } = session([
      {
        text: '',
        calls: [patch('c1', [{ targetId: '', insert: { children: { node: { type: 'we-nonexistent' } } } }])],
        finish: 'tool_calls',
      },
      { text: '', calls: [patch('c2', [addText('Fixed')])], finish: 'tool_calls' },
      { text: 'Done.', calls: [], finish: 'done' },
    ]);
    const result = await run;

    expect(accepted).toHaveLength(1);
    expect(result.stats.semanticFailures).toBe(1);
    const firstResult = model.seen[1].turns.find((t) => t.role === 'tool');
    expect(firstResult).toMatchObject({
      callId: 'c1',
      result: expect.stringMatching(/^Error: Semantic validation failed/),
    });
  });

  it('answers every call in a turn by name, and keeps a failed turn off the template entirely', async () => {
    const { run, accepted, model } = session([
      {
        text: '',
        calls: [patch('a', [addText('One')]), patch('b', [{ targetId: 'missing', remove: { children: 'x' } }])],
        finish: 'tool_calls',
      },
      { text: 'Gave up.', calls: [], finish: 'done' },
    ]);
    const result = await run;

    // Atomic: the valid half of a turn is not applied without the other half.
    expect(accepted).toHaveLength(0);
    expect(children(result.schema)).toHaveLength(1);
    const results = model.seen[1].turns.filter((t) => t.role === 'tool');
    expect(results.map((t) => (t as { callId: string }).callId)).toEqual(['a', 'b']);
    expect(result.stats.patchFailures).toBe(1);
  });

  it('answers a context tool from resolveTool, without validating or accepting anything', async () => {
    const { run, accepted, model } = session(
      [
        {
          text: '',
          calls: [{ id: 'k', name: 'we_lookup', arguments: { components: ['we-button'] } }],
          finish: 'tool_calls',
        },
        { text: 'Now I know.', calls: [], finish: 'done' },
      ],
      { resolveTool: (call) => (call.name === 'we_lookup' ? 'we-button docs' : undefined) },
    );
    const result = await run;

    expect(accepted).toHaveLength(0);
    expect(result.stats.contextCalls).toBe(1);
    expect(result.transcript).not.toContain('Template updated');
    expect(model.seen[1].turns.at(-1)).toEqual({ role: 'tool', callId: 'k', result: 'we-button docs' });
  });

  it('reports a tool nobody knows as an error rather than silence', async () => {
    const { run, model } = session([
      { text: '', calls: [{ id: 'z', name: 'mystery', arguments: {} }], finish: 'tool_calls' },
      { text: 'Oh.', calls: [], finish: 'done' },
    ]);
    await run;
    expect(model.seen[1].turns.at(-1)).toEqual({ role: 'tool', callId: 'z', result: 'Error: Unknown tool: mystery' });
  });

  it('stops at a truncated reply without applying what it was writing', async () => {
    const { run, accepted } = session([{ text: 'Half of', calls: [], finish: 'truncated' }]);
    const result = await run;
    expect(result.outcome).toBe('truncated');
    expect(accepted).toHaveLength(0);
  });

  it('gives up once the retry budget is spent', async () => {
    const bad = {
      text: '',
      calls: [patch('x', [{ targetId: 'nope', remove: { children: 'y' } }])],
      finish: 'tool_calls' as const,
    };
    const { run } = session([bad, bad, bad], { maxContinuations: 2 });
    const result = await run;
    expect(result.outcome).toBe('exhausted');
    expect(result.stats.modelCalls).toBe(3);
  });

  it('passes a chosen model through, and measures what each call sends', async () => {
    const { run, model } = session([{ text: 'Hi.', calls: [], finish: 'done' }], { model: 'claude-sonnet-5' });
    const result = await run;
    expect(model.seen[0].model).toBe('claude-sonnet-5');
    expect(result.stats.requestChars[0]).toBeGreaterThan('system'.length);
  });
});
