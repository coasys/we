/**
 * templateToolset — editing one template, as tools an agent host can offer a model.
 *
 * The editor's panel runs its own conversation (`runEditSession`). A host that runs the
 * conversation itself — the AD4M executor's harness, answering a request someone typed into a
 * space's feed — needs the same edit as tools instead: the same reference, the same template
 * outline, the same patching and the same validation. This is that, built from the same parts:
 * `prepareTemplateRequest` for what the model is told, `createTemplateSession` for what an edit may
 * do. Nothing here decides anything those two do not already decide for the editor.
 *
 * One difference, and it follows from who holds the loop: the editor judges a turn's patches as
 * one batch, while a host answers calls one at a time, so here each `update_schema` call is its
 * own batch — kept whole or not at all.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import {
  buildValidationContext,
  contextData,
  type SchemaNode,
  type ValidationContext,
  withEntities,
} from '@we/schema-shared';

import { readArguments, type Toolset } from '../core/toolset';
import { datasetModelExtras, prepareTemplateRequest, requestMessage } from './aiInfra';
import { createTemplateSession } from './templateSession';

export interface TemplateToolsetOptions {
  /** The template as stored: expanded, with permanent ids. */
  template: SchemaNode;
  /** What the person asked for, in their words. */
  request: string;
  /**
   * The dataset's own models — those another app synced in, and those its community defined. A
   * template may query them, so they are valid names, and the model is told what they hold.
   */
  models?: EntityManifestEntry[];
  /**
   * What a template may name. Built from the catalogue this package was built with when absent,
   * which is the right answer for a host that has no catalogue of its own.
   */
  validationContext?: ValidationContext;
  /** The template's share of the prompt, in characters. See `boundTemplate`. */
  budget?: number;
}

export interface TemplateEdit {
  /** The template as it stands: expanded, every node it had keeping its id, new nodes given one. */
  template: SchemaNode;
  /** Whether any edit was kept. */
  changed: boolean;
  /** How many `update_schema` calls were kept. */
  edits: number;
}

let catalogue: ValidationContext | undefined;

/** What the model is told after an edit is kept. The host, not the toolset, decides what happens to it. */
const KEPT =
  'Applied, and the template validates. Make any further changes, then finish with a short summary for the person who asked.';

export async function createTemplateToolset(options: TemplateToolsetOptions): Promise<Toolset<TemplateEdit>> {
  const models = options.models ?? [];
  const base = options.validationContext ?? (catalogue ??= buildValidationContext(contextData));
  const validationContext = withEntities(
    base,
    models.map((m) => m.name),
  );

  const prepared = await prepareTemplateRequest({
    template: options.template,
    request: options.request,
    budget: options.budget,
  });
  const { tree } = prepared;
  const session = createTemplateSession({
    schema: tree.schema,
    mint: tree.mint,
    uses: tree.uses,
    validationContext,
  });

  let edits = 0;
  let calls = 0;

  return {
    system: prepared.system,
    prompt: requestMessage(options.request, prepared.sent, datasetModelExtras(models, base.entityNames)),
    tools: prepared.tools.map((tool) => ({ ...tool, kind: tool.name === 'update_schema' ? 'edit' : 'lookup' })),

    async call(name, args) {
      const id = `call-${++calls}`;
      const parsed = readArguments(args);
      if (!parsed) return `Error: The arguments to ${name} must be a JSON object.`;

      if (name === 'update_schema') {
        const batch = session.apply([{ id, arguments: parsed }]);
        if (batch.candidate) {
          batch.commit();
          edits++;
          batch.acknowledge(KEPT);
        }
        const [result] = batch.results;
        return result.isError ? `Error: ${result.content}` : result.content;
      }

      const answer = prepared.resolveTool({ id, name, arguments: parsed });
      return answer ?? `Error: Unknown tool: ${name}`;
    },

    result() {
      return { template: tree.restore(session.current()), changed: edits > 0, edits };
    },
  };
}
