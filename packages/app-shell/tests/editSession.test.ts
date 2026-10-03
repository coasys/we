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
import {
  buildValidationContext,
  compactDefinitions,
  contextData,
  definitionsOf,
  ensureNodeIds,
  expandDefinitions,
  validateStructure,
} from '@we/schema-shared';
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

  /*
    What a patch DID survives being told what became of the template.

    The two are written to the same field, the second overwriting the first, and acceptance is the
    only path where the first is worth anything — so a note composed and then discarded looked
    exactly like no note at all. Caught by driving the real editor and reading the tool result.
  */
  it('keeps the reach of a shared-shape patch in the result it accepts', async () => {
    const shape = (): SchemaNode =>
      ({
        type: 'Column',
        props: { gap: '300', p: '400', bg: 'surface' },
        children: [{ type: 'we-text', children: ['Card'] }],
      }) as SchemaNode;
    const shared = compactDefinitions(
      {
        type: 'Column',
        meta: { name: 'Test', description: '', icon: 'cube' },
        children: [shape(), shape(), shape()],
      } as unknown as SchemaNode,
      { minChars: 0 }, // the fixture is small; what is under test is the reporting, not the threshold
    );
    expect(shared.hoisted).toBe(1);

    const inside = Object.values(definitionsOf(ensureNodeIds(shared.schema)))[0].children![0] as SchemaNode;
    const { run, turns } = session(
      [
        {
          text: '',
          calls: [patch('c1', [{ targetId: inside.id!, node: { props: { color: 'accent-text' } } }])],
          finish: 'tool_calls',
        },
        { text: 'Done.', calls: [], finish: 'done' },
      ],
      { schema: shared.schema },
    );
    await run;

    const result = (turns.find((t) => t.role === 'tool') as { result: string }).result;
    expect(result).toContain('Template updated successfully.'); // what became of the template
    expect(result).toContain('shows in 3 places'); // and what the patch did
  });

  /*
    A template carrying definitions is judged as what it renders, not as what it is sent as.

    `$defs` is the STRICTER path: a definition's body is checked as a node, where the same subtree
    in a prop is reached through a union that falls back to accepting a plain object. So a shape
    that passes inline can fail once hoisted — on the workshop template that was 91 faults the
    moment compaction moved them. Judged that way, every patch is refused for something the model
    did not do and cannot fix.

    The fixture repeats a handler carrying a key no resolver reads, which is the shape that
    actually caused it: tolerated in a prop, refused as a definition. A real template was used
    here until the fault it relied on was fixed — the hazard outlives any one template, so the
    test should not need a broken one.
  */
  it('judges a compacted template by its rendered form, not its sent form', async () => {
    const strayKey = { $if: { condition: { $: 'local.x' }, then: { $action: 'store.go' } }, onSuccess: [] };
    // Held in a PROP, the only position the union has a fallback behind — and the wrappers differ,
    // so what repeats, and so what gets hoisted onto the strict path, is the held shape itself.
    const held = (): SchemaNode =>
      ({
        type: 'Column',
        props: { gap: '300' },
        children: [{ type: 'we-button', props: { onClick: strayKey }, children: ['Go'] }],
      }) as unknown as SchemaNode;
    const wrapper = (which: string): SchemaNode =>
      ({ type: '$if', props: { condition: { $: `local.${which}` }, then: held() } }) as unknown as SchemaNode;
    const { schema, hoisted } = compactDefinitions(
      {
        type: 'Column',
        meta: { name: 'T', description: '', icon: 'cube' },
        children: [wrapper('a'), wrapper('b')],
      } as SchemaNode,
      { minChars: 0 },
    );
    expect(hoisted).toBeGreaterThan(0);

    // The hazard this guards: hoisting alone flips the verdict on a tree nothing else changed.
    expect(validateStructure(schema).valid).toBe(false);
    expect(validateStructure(expandDefinitions(schema)).valid).toBe(true);

    const { run, accepted } = session(
      [
        { text: '', calls: [patch('c1', [addText('Added')])], finish: 'tool_calls' },
        { text: 'Done.', calls: [], finish: 'done' },
      ],
      { schema },
    );
    const result = await run;

    expect(result.outcome).toBe('done');
    expect(accepted).toHaveLength(1); // not refused for a fault the patch did not introduce
    expect(result.stats.structuralFailures).toBe(0);
  });

  /*
    A run of accepted turns is one thing that happened, and says how much it did.

    Three identical ticks in a column are unreadable: they look like a repeat rather than three
    changes, which is exactly how they were read the first time. Separated by what the model said,
    they belong to that reasoning and stay; adjacent, they are one line that counts up.
  */
  it('counts a run of accepted turns as one line, and keeps the ones prose separates', async () => {
    const { run } = session([
      { text: 'First.', calls: [patch('c1', [addText('One')])], finish: 'tool_calls' },
      { text: '', calls: [patch('c2', [addText('Two'), addText('Three')])], finish: 'tool_calls' },
      { text: 'Done.', calls: [], finish: 'done' },
    ]);
    const { transcript } = await run;

    // Turn two said nothing, so it folds into turn one's line and takes the total with it.
    expect(transcript.match(/✓ Template updated/g)).toHaveLength(1);
    expect(transcript).toContain('✓ Template updated (3 patches)');
    expect(transcript).not.toContain('(1 patch)');
    expect(transcript.indexOf('First.')).toBeLessThan(transcript.indexOf('✓'));
  });

  it('keeps a tick per turn when the model speaks between them', async () => {
    const { run } = session([
      { text: 'Doing the first.', calls: [patch('c1', [addText('One')])], finish: 'tool_calls' },
      { text: 'Now the second.', calls: [patch('c2', [addText('Two')])], finish: 'tool_calls' },
      { text: 'Done.', calls: [], finish: 'done' },
    ]);
    const { transcript } = await run;

    expect(transcript.match(/✓ Template updated \(1 patch\)/g)).toHaveLength(2);
  });

  it('passes a chosen model through, and measures what each call sends', async () => {
    const { run, model } = session([{ text: 'Hi.', calls: [], finish: 'done' }], { model: 'claude-sonnet-5' });
    const result = await run;
    expect(model.seen[0].model).toBe('claude-sonnet-5');
    expect(result.stats.requestChars[0]).toBeGreaterThan('system'.length);
  });
});
