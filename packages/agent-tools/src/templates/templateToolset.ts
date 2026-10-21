/**
 * templateToolset — reading and editing a stored Template record, as tools any agent on a host can
 * be offered, and the reference as documentation it reads when it chooses to.
 *
 * The editor's panel runs its own conversation (`runEditSession`). An agent on a host — an MCP
 * client, the executor's own sessions — runs one the host holds, with these among its tools. They
 * are built from the same parts as the editor: `prepareForModel` for the tree the model sees,
 * `boundTemplate` for how much of it, `createTemplateSession` for what an edit may do. Nothing here
 * decides anything those do not already decide for the editor.
 *
 * Where it differs, it follows from holding nothing between calls:
 *
 * - **The template is read, not handed over.** `template_read` answers what the editor's user turn
 *   carried — the template, whole or as an outline, and the dataset's own models.
 * - **Each update is saved as it is made**, so an edit's patches go in one call: a save per patch
 *   would put every intermediate state on every screen showing the template.
 * - **A save renumbers the ids.** Aliases are numbered by walking the tree, so they are the same on
 *   every read of the same stored template — which is what lets a read and the update after it agree
 *   — and different after anything changes it. `template_update` therefore takes the `version` it
 *   was written against and refuses a template that has moved on, whoever moved it.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import { decodeTemplateFile, encodeTemplateFile } from '@we/entities';
import {
  buildValidationContext,
  contextData,
  type SchemaNode,
  type TemplateSchema,
  type ValidationContext,
  withEntities,
} from '@we/schema-shared';

import { type AgentTool, readArguments, type RecordInput, type RecordToolset, type ToolCall } from '../core/toolset';
import { datasetModelExtras, loadReference, updateSchemaTool } from './aiInfra';
import { toolsPreamble } from './chatSystemPrompt';
import { type ReferenceDoc, referenceDocs } from './contextStrategies';
import { prepareForModel } from './nodeAliases';
import { boundTemplate } from './templateContext';
import { createTemplateSession } from './templateSession';

export const TEMPLATE_READ = 'template_read';
export const TEMPLATE_UPDATE = 'template_update';

let catalogue: ValidationContext | undefined;

/**
 * What a template may name: the catalogue this package was built with, and the dataset's own
 * models, which a template may query. `base` is the catalogue alone, whose names are the ones the
 * reference already describes.
 */
function validation(models: EntityManifestEntry[]) {
  const base = (catalogue ??= buildValidationContext(contextData));
  return {
    base,
    context: withEntities(
      base,
      models.map((m) => m.name),
    ),
  };
}

/** The template a record holds, and the version a save moves on. Throws for a record it cannot read: the host's mistake. */
function readRecord(record: RecordInput): { template: SchemaNode; version: number } {
  if (!templateToolset.appliesTo.includes(record.className))
    throw new Error(`The template tools work on Template records, not ${record.className}.`);
  const stored = decodeTemplateFile<TemplateSchema>(record.properties.schema);
  if (!stored) throw new Error(`Template ${record.id} holds no schema this build can read.`);
  // Who saved it last is the app's bookkeeping, not part of the design: the model is not shown it,
  // and a write records whoever this one goes out as.
  const { author: _previous, ...template } = stored;
  return { template: template as SchemaNode, version: Number(record.properties.version) || 1 };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const readTool: AgentTool = {
  name: TEMPLATE_READ,
  description:
    'Read the template being edited. With no arguments: its version, and the template — whole, or as an ' +
    'outline of every node with the parts `about` names in full when it is too large to send — plus the ' +
    "space's own data models. With `ids`, those nodes in full; with `find`, the nodes whose type or text " +
    'matches. Read the `template` documentation topic before a first edit.',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'string' }, description: 'Node ids, e.g. "n12".' },
      find: { type: 'string', description: 'Text or a type to look for, e.g. "Load more".' },
      about: {
        type: 'string',
        description: 'What the edit is about, in words — chooses which nodes of a large template come back in full.',
      },
    },
  },
  writes: false,
};

const { patches } = (updateSchemaTool.parameters as { properties: { patches: unknown } }).properties;

const updateTool: AgentTool = {
  name: TEMPLATE_UPDATE,
  description:
    'Apply patches to the template and SAVE them, as one change everybody sees. Put every patch an edit ' +
    `needs in one call. Pass the version ${TEMPLATE_READ} gave: a template that has changed since is ` +
    'refused. `dry_run` checks the patches without saving. Each patch targets a node by its id, with ' +
    'exactly one of node, insert, remove or split.',
  parameters: {
    type: 'object',
    properties: {
      version: { type: 'number', description: `The version ${TEMPLATE_READ} answered with.` },
      patches,
      dry_run: { type: 'boolean', description: 'Check the patches and save nothing.' },
    },
    required: ['version', 'patches'],
  },
  writes: true,
};

async function read({ record, args, models = [] }: ToolCall): Promise<string> {
  const parsed = args === undefined || args === null ? {} : readArguments(args);
  if (!parsed) return `Error: The arguments to ${TEMPLATE_READ} must be a JSON object.`;
  const { template, version } = readRecord(record);
  const tree = prepareForModel(template);

  const ids = strings(parsed.ids);
  const find = typeof parsed.find === 'string' && parsed.find.trim() ? parsed.find : undefined;
  if (ids.length || find) {
    // A budget of nothing, so the tree is always addressed through the lookup, however small it is.
    const bounded = boundTemplate(tree.schema, '', 0, TEMPLATE_READ);
    const answer = bounded.resolveTool?.({ id: TEMPLATE_READ, name: TEMPLATE_READ, arguments: { ids, find } });
    return `Template version ${version}.\n\n${answer}`;
  }

  const about = typeof parsed.about === 'string' ? parsed.about : '';
  const bounded = boundTemplate(tree.schema, about, undefined, TEMPLATE_READ);
  return JSON.stringify({
    version,
    currentSchema: bounded.sent,
    ...datasetModelExtras(models, validation(models).base.entityNames),
  });
}

async function update({ record, args, models = [], author }: ToolCall) {
  const parsed = readArguments(args);
  if (!parsed) return { text: `Error: The arguments to ${TEMPLATE_UPDATE} must be a JSON object.` };
  const { template, version } = readRecord(record);

  if (parsed.version === undefined)
    return {
      text: `Error: Pass the version ${TEMPLATE_READ} answered with, so a template that has changed is not patched blind.`,
    };
  if (Number(parsed.version) !== version)
    return {
      text:
        `Error: The template has changed since it was read — it is version ${version} now, and these patches ` +
        `were written against version ${parsed.version}. Read it again with ${TEMPLATE_READ}: its node ids ` +
        'may have changed. Then write the patches against what it says now.',
    };
  if (Array.isArray(parsed.patches) && parsed.patches.length === 0)
    return { text: 'Error: No patches were given, so there is nothing to apply.' };

  const tree = prepareForModel(template);
  const session = createTemplateSession({
    schema: tree.schema,
    mint: tree.mint,
    uses: tree.uses,
    validationContext: validation(models).context,
  });
  const batch = session.apply([{ id: TEMPLATE_UPDATE, arguments: { patches: parsed.patches } }]);
  const [result] = batch.results;
  if (!batch.candidate) return { text: `Error: ${result.content}` };

  if (parsed.dry_run === true)
    return {
      text: [
        'Valid: the patches apply and the template validates. Nothing was saved — call again without dry_run to save them.',
        result.note,
      ]
        .filter(Boolean)
        .join(' '),
    };

  batch.commit();
  const schema = { ...tree.restore(session.current()), ...(author ? { author } : {}) } as TemplateSchema;
  return {
    text: [
      `Saved as version ${version + 1}.`,
      result.note,
      `Node ids are renumbered by a save: call ${TEMPLATE_READ} again before another edit.`,
    ]
      .filter(Boolean)
      .join(' '),
    // The same pair the app's save writes, and for the same reason: a screen showing this template
    // hears of the change through the version, so the two land together.
    properties: { schema: encodeTemplateFile(schema, { savedAt: Date.now() }), version: version + 1 },
  };
}

let docs: Promise<ReferenceDoc[]> | undefined;

/** The reference as topics, built once: the reference is the one this package was built with, and does not change. */
const loadDocs = () =>
  (docs ??= loadReference().then((reference) =>
    referenceDocs(toolsPreamble({ read: TEMPLATE_READ, update: TEMPLATE_UPDATE }), reference),
  ));

export const templateToolset: RecordToolset = {
  appliesTo: ['Template'],
  tools: [readTool, updateTool],

  async call(name, input) {
    if (name === TEMPLATE_READ) return { text: await read(input) };
    if (name === TEMPLATE_UPDATE) return update(input);
    return { text: `Error: Unknown tool: ${name}` };
  },

  docs: {
    list: async () => (await loadDocs()).map(({ path, title, summary }) => ({ path, title, summary })),
    read: async (path) => (await loadDocs()).find((doc) => doc.path === path)?.text,
  },
};
