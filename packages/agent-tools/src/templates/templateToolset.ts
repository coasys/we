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
 * - **A new template is made by the host.** `template_create` answers with the new record's
 *   properties and the place it goes — the person's library unless the call asks for the space — and
 *   the host makes the record there. It is judged as an edit is, so a template an agent made opens.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import { decodeTemplateFile, encodeTemplateFile } from '@we/entities';
import {
  buildValidationContext,
  contextData,
  ensureNodeIds,
  type SchemaNode,
  type TemplateSchema,
  type ValidationContext,
  withEntities,
} from '@we/schema-shared';

import {
  type AgentTool,
  type Place,
  readArguments,
  type RecordInput,
  type RecordToolset,
  type ToolAnswer,
  type ToolCall,
} from '../core/toolset';
import { datasetModelExtras, loadReference, updateSchemaTool } from './aiInfra';
import { toolsPreamble } from './chatSystemPrompt';
import { type ReferenceDoc, referenceDocs, selectReference } from './contextStrategies';
import { prepareForModel } from './nodeAliases';
import { roleOfTemplate, starterTemplate, TEMPLATE_ROLES, type TemplateRole } from './starterTemplates';
import { boundTemplate } from './templateContext';
import { createTemplateSession, judgeTemplate, templateIssues } from './templateSession';

export const TEMPLATE_READ = 'template_read';
export const TEMPLATE_UPDATE = 'template_update';
export const TEMPLATE_CREATE = 'template_create';

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
function readRecord(record: RecordInput | undefined): { template: SchemaNode; version: number } {
  if (!record) throw new Error('The template tools work on a Template record, and none was given.');
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
    reference: referenceFor(await loadReference(), about, bounded.sent),
  });
}

/** How much of `template_read`'s answer the reference entries may take, in characters. */
export const READ_REFERENCE_BUDGET = 30_000;

/**
 * The reference entries a read's edit probably needs, beside the template: the components in what
 * was sent in full and the ones the request names, and the stores either mentions.
 *
 * In the answer rather than left to be asked for, because a small model does not ask: given the
 * entries it uses them, and without them it guesses a prop. The editor's own conversation puts the
 * same selection in its prompt; an agent on a host has no prompt of ours, and its first read is the
 * one place to put it.
 */
function referenceFor(reference: string, about: string, sent: unknown): string {
  const selected = selectReference(reference, { request: about, schema: sent }, READ_REFERENCE_BUDGET);
  if (!selected.components.length && !selected.stores.length) return '';
  return [
    'Reference entries for what this template uses and the request names. Anything else is a documentation topic.',
    ...(selected.components.length ? [selected.componentsIntro, ...selected.components] : []),
    ...(selected.stores.length ? [selected.storesIntro, ...selected.stores] : []),
    ...(selected.omitted.length
      ? [
          `Also involved, left out for room — each is the topic template/components/<name> or template/stores/<name>: ${selected.omitted.join(', ')}.`,
        ]
      : []),
  ].join('\n\n');
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

const PLACES: Place[] = ['library', 'space'];

const createTool: AgentTool = {
  name: TEMPLATE_CREATE,
  description:
    'Make a new template and SAVE it. A shell is a space’s whole interface, a view is one section of ' +
    'a space, an app is the chrome around every space. `place` is `library` — the person’s own, the ' +
    'default — or `space`, only when they asked for it to be in this space; an app is always the ' +
    'person’s. It starts from a working template of its role, from the template the call names (a ' +
    `fork), or from \`schema\`, a whole template you write. Then read the new record with ${TEMPLATE_READ} ` +
    `and change it with ${TEMPLATE_UPDATE}. \`dry_run\` checks it and saves nothing.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'What the template is called, as the person will see it.' },
      role: { type: 'string', enum: TEMPLATE_ROLES, description: 'shell (the default), view or app.' },
      place: { type: 'string', enum: PLACES, description: 'library (the default) or space.' },
      description: { type: 'string', description: 'One line on what it is for.' },
      icon: { type: 'string', description: 'A Phosphor icon name, e.g. "kanban".' },
      schema: { type: 'object', description: 'A whole template to start from, instead of the starting one.' },
      dry_run: { type: 'boolean', description: 'Check the template and save nothing.' },
    },
    required: ['name'],
  },
  writes: true,
  creates: { entity: 'Template', places: PLACES },
};

/** The name as a path segment: `Lending Desk` → `lending-desk`. */
const segmentOf = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'template';

/**
 * The new template's id, which is also its slug: the name, with a suffix so it cannot take the id
 * of a template already in the library — where a second template with the same id would replace the
 * first in every list.
 */
function newSlug(name: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${segmentOf(name)}-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('')}`;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function create({ record, args, models = [], author }: ToolCall): ToolAnswer {
  const parsed = readArguments(args ?? {});
  if (!parsed) return { text: `Error: The arguments to ${TEMPLATE_CREATE} must be a JSON object.` };

  const name = text(parsed.name);
  if (!name) return { text: 'Error: Give the template a `name`.' };
  if (parsed.role !== undefined && !TEMPLATE_ROLES.includes(parsed.role as TemplateRole))
    return { text: `Error: \`role\` is one of ${TEMPLATE_ROLES.join(', ')}.` };
  const place = (parsed.place ?? 'library') as Place;
  if (!PLACES.includes(place)) return { text: `Error: \`place\` is one of ${PLACES.join(', ')}.` };
  if (
    parsed.schema !== undefined &&
    (!parsed.schema || typeof parsed.schema !== 'object' || Array.isArray(parsed.schema))
  )
    return { text: 'Error: `schema` must be a whole template: an object with a `type` and a `meta`.' };

  // Where it starts: a whole template the agent wrote, the one it forks, or the starter for its role.
  const fork = !parsed.schema && record ? readRecord(record).template : undefined;
  const asked = parsed.role as TemplateRole | undefined;
  const given = (parsed.schema as SchemaNode | undefined) ?? fork;
  const role = given ? roleOfTemplate(given as TemplateSchema) : (asked ?? 'shell');
  if (given && asked && asked !== role)
    return {
      text:
        `Error: The template to start from is a ${role}, and \`role\` asks for a ${asked}. Leave \`role\` out to ` +
        `keep it a ${role}, or start from a ${asked}.`,
    };
  if (role === 'app' && place !== 'library')
    return {
      text: 'Error: An app is the chrome around every space the person opens, so it is theirs: make it in the library.',
    };

  const slug = newSlug(name);
  const base = (given ? structuredClone(given) : starterTemplate(role, name, segmentOf(name))) as TemplateSchema;
  const { author: _previous, ...design } = base as TemplateSchema & { author?: string };
  // Description and icon are required of every template; a schema written without them gets them blank.
  const meta = {
    description: '',
    icon: '',
    ...(design.meta as Partial<TemplateSchema['meta']>),
    name,
    ...(text(parsed.description) !== undefined ? { description: text(parsed.description) } : {}),
    ...(text(parsed.icon) !== undefined ? { icon: text(parsed.icon) } : {}),
  };
  const template = {
    ...(ensureNodeIds(design as SchemaNode) as TemplateSchema),
    id: slug,
    meta,
    ...(author ? { author } : {}),
  } as TemplateSchema;

  // A fork answers only for what it changed: issues its source already had are not held against it.
  const { context } = validation(models);
  const baseline = fork ? templateIssues(fork, context) : undefined;
  const verdict = judgeTemplate(template as SchemaNode, context, baseline);
  if (verdict) return { text: `Error: ${verdict.message}` };

  const where = place === 'library' ? 'the person’s library' : 'this space';
  if (parsed.dry_run === true)
    return { text: `Valid: a ${role} called "${name}" would be made in ${where}. Nothing was saved.` };

  return {
    text: `Made the ${role} "${name}" in ${where}. Read the new record with ${TEMPLATE_READ} before changing it.`,
    // The fields the app's own save writes for a new template, so it lists and opens like one.
    properties: {
      name,
      description: meta.description ?? '',
      icon: meta.icon ?? '',
      origin: place === 'library' ? 'custom' : 'shared',
      slug,
      version: 1,
      schema: encodeTemplateFile(template, { savedAt: Date.now() }),
      role: role === 'view' ? 'view' : '',
    },
    create: { entity: 'Template', place },
  };
}

let docs: Promise<ReferenceDoc[]> | undefined;

/** The reference as topics, built once: the reference is the one this package was built with, and does not change. */
const loadDocs = () =>
  (docs ??= loadReference().then((reference) =>
    referenceDocs(toolsPreamble({ read: TEMPLATE_READ, update: TEMPLATE_UPDATE, create: TEMPLATE_CREATE }), reference),
  ));

export const templateToolset: RecordToolset = {
  appliesTo: ['Template'],
  tools: [readTool, updateTool, createTool],

  async call(name, input) {
    if (name === TEMPLATE_READ) return { text: await read(input) };
    if (name === TEMPLATE_UPDATE) return update(input);
    if (name === TEMPLATE_CREATE) return create(input);
    return { text: `Error: Unknown tool: ${name}` };
  },

  docs: {
    list: async () => (await loadDocs()).map(({ path, title, summary }) => ({ path, title, summary })),
    read: async (path) => (await loadDocs()).find((doc) => doc.path === path)?.text,
  },
};
