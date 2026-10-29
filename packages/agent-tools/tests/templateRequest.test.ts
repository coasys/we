/**
 * The `toolset` strategy, driven through the editor's own loop: the conversation opens as an agent
 * on a host's would after its first read, a lookup by id or by topic is answered, and a patch made
 * with `template_update` lands in the working copy.
 *
 * What it pins is that the strategy is a faithful stand-in for a host's agent — the same prompt,
 * the same first answer, the same tool names — so that what the eval says about it is a statement
 * about that agent.
 */
import type { ConversationReply, ConversationRequest } from '@we/backend-shared';
import { buildValidationContext, contextData, ensureNodeIds, type SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { runEditSession } from '../src/templates/editSession';
import { DOCS_TOOL, prepareTemplateRequest, TEMPLATE_STRATEGIES } from '../src/templates/templateRequest';
import { TEMPLATE_READ, TEMPLATE_UPDATE, templateToolset } from '../src/templates/templateToolset';

const template = ensureNodeIds({
  type: 'Column',
  meta: { name: 'Test', description: '', icon: 'cube' },
  children: [{ type: 'we-text', children: ['Hello'] }],
} as unknown as SchemaNode);

const prepare = (strategy: 'toolset' | 'lookup' = 'toolset') =>
  prepareTemplateRequest({ template, request: 'make the button bigger', strategy });

describe('the toolset strategy', () => {
  it('is offered beside the three context strategies', () => {
    expect(TEMPLATE_STRATEGIES).toEqual(['full', 'sections', 'lookup', 'toolset']);
  });

  it('prompts with the topic a host’s agent starts from, and opens as that agent’s first read', async () => {
    const prepared = await prepare();
    expect(prepared.system).toBe(await templateToolset.docs.read('template'));
    expect(prepared.tools.map((t) => t.name)).toEqual([TEMPLATE_UPDATE, TEMPLATE_READ, DOCS_TOOL]);
    expect(prepared.patchTool).toBe(TEMPLATE_UPDATE);

    const [request, call, answer] = prepared.opening;
    expect(request).toEqual({ role: 'user', text: 'make the button bigger' });
    expect(call).toMatchObject({ role: 'assistant', calls: [{ name: TEMPLATE_READ }] });
    const read = JSON.parse((answer as { result: string }).result);
    expect(read.version).toBe(1);
    expect(read.reference).toContain('- we-button');
  });

  it('answers a topic, a read by id, and a bare re-read without handing back a stale tree', async () => {
    const prepared = await prepare();
    const ask = (name: string, args: Record<string, unknown>) =>
      prepared.resolveTool({ id: 'x', name, arguments: args }) ?? '';
    expect(ask(DOCS_TOOL, { topic: 'template/components/we-button' })).toContain('we-button');
    expect(ask(DOCS_TOOL, { topic: 'nope' })).toMatch(/^No topic "nope"/);
    expect(ask(TEMPLATE_READ, { find: 'Hello' })).toContain('Hello');
    expect(ask(TEMPLATE_READ, {})).toMatch(/You have the template already/);
  });

  it('keeps a patch made with template_update, through the editor’s own loop', async () => {
    const prepared = await prepare();
    const textId = (prepared.tree.schema.children as SchemaNode[])[0].id!;
    let call = 0;
    const converse = async (_request: ConversationRequest): Promise<ConversationReply> =>
      call++ === 0
        ? {
            text: '',
            finish: 'tool_calls',
            calls: [
              {
                id: 'p1',
                name: TEMPLATE_UPDATE,
                arguments: { version: 1, patches: [{ targetId: textId, node: { children: ['Hello, world'] } }] },
              },
            ],
          }
        : { text: 'Done.', finish: 'done', calls: [] };
    const result = await runEditSession({
      converse,
      system: prepared.system,
      turns: [...prepared.opening],
      tools: prepared.tools,
      resolveTool: prepared.resolveTool,
      patchTool: prepared.patchTool,
      schema: prepared.tree.schema,
      mint: prepared.tree.mint,
      uses: prepared.tree.uses,
      validationContext: buildValidationContext(contextData),
      accept: () => prepared.accepted,
    });
    expect(result.outcome).toBe('done');
    expect(JSON.stringify(result.schema)).toContain('Hello, world');
    expect(result.stats.patchCalls).toBe(1);
  });

  it('reads a node back as the patch left it, not as the conversation found it', async () => {
    const prepared = await prepare();
    const textId = (prepared.tree.schema.children as SchemaNode[])[0].id!;
    const requests: ConversationRequest[] = [];
    const replies: ConversationReply[] = [
      {
        text: '',
        finish: 'tool_calls',
        calls: [
          {
            id: 'p1',
            name: TEMPLATE_UPDATE,
            arguments: { version: 1, patches: [{ targetId: textId, node: { children: ['Hello, world'] } }] },
          },
        ],
      },
      { text: '', finish: 'tool_calls', calls: [{ id: 'r1', name: TEMPLATE_READ, arguments: { ids: [textId] } }] },
      { text: 'Done.', finish: 'done', calls: [] },
    ];
    await runEditSession({
      converse: async (request) => (requests.push({ ...request, turns: [...request.turns] }), replies.shift()!),
      system: prepared.system,
      turns: [...prepared.opening],
      tools: prepared.tools,
      resolveTool: prepared.resolveTool,
      patchTool: prepared.patchTool,
      schema: prepared.tree.schema,
      mint: prepared.tree.mint,
      uses: prepared.tree.uses,
      validationContext: buildValidationContext(contextData),
      accept: () => prepared.accepted,
    });
    const reread = requests[2].turns.at(-1) as { role: string; result: string };
    expect(reread.role).toBe('tool');
    expect(reread.result).toContain('Hello, world');
  });

  it('is what a request gets when it names no strategy, and sends the space’s models with the read', async () => {
    const prepared = await prepareTemplateRequest({
      template,
      request: 'list the recipes',
      models: [{ name: 'Recipe', properties: [{ name: 'title', type: 'string' }] }] as never,
    });
    expect(prepared.patchTool).toBe(TEMPLATE_UPDATE);
    expect((prepared.opening[2] as { result: string }).result).toContain('Recipe');
  });

  it('leaves the other strategies as they were: the template in the user turn, patched with update_schema', async () => {
    const prepared = await prepare('lookup');
    expect(prepared.patchTool).toBe('update_schema');
    expect(prepared.opening).toHaveLength(1);
    expect(JSON.parse(prepared.opening[0].role === 'user' ? prepared.opening[0].text : '{}').request).toBe(
      'make the button bigger',
    );
  });
});
