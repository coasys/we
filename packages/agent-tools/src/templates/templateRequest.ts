/**
 * templateRequest — everything one template edit needs before the model is asked, for a
 * conversation WE runs: the template prepared once, the reference chosen for it, the tools, and the
 * turns the conversation opens with.
 *
 * Four strategies. `full`, `sections` and `lookup` put the reference in the system prompt and the
 * template in the user turn, and the model patches with `update_schema`. `toolset` gives the model
 * exactly what an agent on a host gets from the template tools: the `template` documentation topic
 * as its prompt, the template and the reference entries it needs as `template_read`'s answer, the
 * rest of the reference as topics it reads, and `template_update` to patch with. It exists so the
 * editor and a host's agent can run on one set of tools, and so the eval can say whether that costs
 * anything before the editor moves.
 */
import type { ConversationTool, ConversationToolCall, ConversationTurn } from '@we/backend-shared';
import { encodeTemplateFile } from '@we/entities';
import type { SchemaNode } from '@we/schema-shared';

import { chatContext, requestMessage, updateSchemaTool } from './aiInfra';
import { CONTEXT_STRATEGIES, type ContextStrategyId } from './contextStrategies';
import { type ModelTree, prepareForModel } from './nodeAliases';
import { type BoundedTemplate, boundTemplate } from './templateContext';
import { TEMPLATE_READ, TEMPLATE_UPDATE, templateToolset } from './templateToolset';

export type TemplateStrategyId = ContextStrategyId | 'toolset';

export const TEMPLATE_STRATEGIES: TemplateStrategyId[] = [...CONTEXT_STRATEGIES, 'toolset'];

/** The documentation tool an agent on a host reads topics with, under the name a host gives it. */
export const DOCS_TOOL = 'get_documentation';

export interface TemplateRequest {
  /** The one tree the request is about: what the model is shown, and what its ids resolve against. */
  tree: ModelTree;
  system: string;
  /** Every tool the model is offered, the patch tool first. */
  tools: ConversationTool[];
  /** The name of the tool whose calls carry patches. Pass it to `runEditSession`. */
  patchTool: string;
  /** The answer to a lookup tool, or undefined for a name no tool here claims. */
  resolveTool: (call: ConversationToolCall) => string | undefined;
  /**
   * The turns this request adds to the conversation: the request with the template, or — for
   * `toolset` — the request, a `template_read` call and its answer.
   */
  opening: ConversationTurn[];
  /** What a patch the session kept is answered with. */
  accepted: string;
  /** What the user turn carries as the template — the tree itself, or an outline when it is over budget. */
  sent: unknown;
  /** How the template was bounded, for diagnostics. */
  bounded: BoundedTemplate['stats'] & { whole: boolean };
}

/**
 * Everything one request needs before the model is asked: the template prepared once, the
 * reference chosen for the request, and the template bounded to its budget.
 *
 * ONE tree, numbered once, for everything this request: what the model is shown, what its ids are
 * resolved against, and what the context strategy preselects from. Compacting in one place and
 * patching the uncompacted template in another gave two independent numberings that drift apart at
 * the first hoisted shape — and the failure was quiet: a patch the model wrote against a shared
 * definition resolved, on this side, to one inline copy of it. It validated, it saved, it changed
 * something plausible, and the model's explanation of what it had done was confidently wrong. So
 * every host builds a request here rather than assembling the parts itself.
 */
export async function prepareTemplateRequest(options: {
  /** The template as stored: expanded, with permanent ids. */
  template: SchemaNode;
  request: string;
  /** How much of the reference goes in the prompt. The editor's choice when absent. */
  strategy?: TemplateStrategyId;
  /** The template's share of the budget, in characters. See `boundTemplate`. */
  budget?: number;
}): Promise<TemplateRequest> {
  if (options.strategy === 'toolset') return toolsetRequest(options);
  const tree = prepareForModel(options.template);
  const context = await chatContext({ request: options.request, schema: tree.schema }, options.strategy);
  /*
    How much of the TEMPLATE goes with it. `chatContext` bounds the reference; this bounds the
    other half, which on a real template is the larger one. A template inside the budget is sent
    whole — kanban is, workshop is not.
  */
  const bounded = boundTemplate(tree.schema, options.request, options.budget);
  return {
    tree,
    system: context.system,
    tools: [updateSchemaTool, ...context.tools, ...bounded.tools],
    patchTool: updateSchemaTool.name,
    // Whichever tool owns the name answers; a tool nobody claims is reported by the caller.
    resolveTool: (call) => context.resolveTool?.(call) ?? bounded.resolveTool?.(call),
    opening: [{ role: 'user', text: requestMessage(options.request, bounded.sent) }],
    accepted: 'Template updated successfully.',
    sent: bounded.sent,
    bounded: { ...bounded.stats, whole: bounded.whole },
  };
}

/** What a read with no ids or search says once the conversation already holds the template. */
const ALREADY_READ =
  'You have the template already, from the read at the start of this conversation, and its node ids have not ' +
  'changed: patches made here are kept in the same tree. Ask for nodes by `ids` or `find` them instead.';

async function toolsetRequest(options: {
  template: SchemaNode;
  request: string;
  budget?: number;
}): Promise<TemplateRequest> {
  const tree = prepareForModel(options.template);
  const bounded = boundTemplate(tree.schema, options.request, options.budget, TEMPLATE_READ);
  const lookup = boundTemplate(tree.schema, '', 0, TEMPLATE_READ);

  // The same answer an agent on a host gets from its first read, from the same tool.
  const record = {
    id: 'template',
    className: 'Template',
    properties: { version: 1, schema: encodeTemplateFile(options.template) },
  };
  const read = await templateToolset.call(TEMPLATE_READ, { record, args: { about: options.request } });

  const topics = await templateToolset.docs.list();
  const texts = new Map(
    await Promise.all(topics.map(async ({ path }) => [path, (await templateToolset.docs.read(path)) ?? ''] as const)),
  );
  const tool = (name: string) => templateToolset.tools.find((t) => t.name === name)!;

  const docsTool: ConversationTool = {
    name: DOCS_TOOL,
    description:
      'Read a documentation topic by its path — `template/core/expressions`, `template/components/we-button`. ' +
      'The `template` topic you were given lists them all.',
    parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
  };
  const readCall = { id: 'read-template', name: TEMPLATE_READ, arguments: { about: options.request } };

  return {
    tree,
    system: texts.get('template') ?? '',
    tools: [
      {
        name: TEMPLATE_UPDATE,
        description: tool(TEMPLATE_UPDATE).description,
        parameters: tool(TEMPLATE_UPDATE).parameters,
      },
      { name: TEMPLATE_READ, description: tool(TEMPLATE_READ).description, parameters: tool(TEMPLATE_READ).parameters },
      docsTool,
    ],
    patchTool: TEMPLATE_UPDATE,
    resolveTool: (call) => {
      if (call.name === DOCS_TOOL) {
        const topic = String((call.arguments as { topic?: unknown }).topic ?? '');
        return texts.get(topic) ?? `No topic "${topic}". The \`template\` topic lists them all.`;
      }
      if (call.name !== TEMPLATE_READ) return undefined;
      const args = call.arguments as { ids?: unknown; find?: unknown };
      const asks = (Array.isArray(args.ids) && args.ids.length) || (typeof args.find === 'string' && args.find.trim());
      // A budget of nothing, as `template_read` itself uses, so a tree of any size answers by id.
      return asks ? `Template version 1.\n\n${lookup.resolveTool?.(call) ?? ''}` : ALREADY_READ;
    },
    opening: [
      { role: 'user', text: options.request },
      { role: 'assistant', text: '', calls: [readCall] },
      { role: 'tool', callId: readCall.id, result: read.text },
    ],
    accepted: 'Saved. The node ids you have are unchanged in this conversation, so go on patching by them.',
    sent: bounded.sent,
    bounded: { ...bounded.stats, whole: bounded.whole },
  };
}
