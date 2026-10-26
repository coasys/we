/**
 * dataToolset — a space's records, as tools for a conversation WE runs itself.
 *
 * A backend that runs agents brings its own tools for this: it holds the data and the policy, and
 * describes its own graph. These are for when WE runs the conversation instead (see
 * `docs/architecture/agents.md`), and they go through WE's own write path, so everything a write
 * passes for a person — the space's policy among it — it passes for an agent writing as them.
 *
 * Two kinds of tool, and the line between them is the one the decision record draws:
 *
 * - **Records in general** — describe, find, read, create, update, delete — over the entity proxies,
 *   for any entity the space knows, its own models included.
 * - **WE's conventions** — what only WE can say is right. `write_post` writes a composed document,
 *   and a reply as a response threaded under its subject, never as a child of anything; `in` puts a
 *   record into a collection in the order it keeps. A backend's generic tools can make each link
 *   these make, but not know which links a reply needs.
 *
 * App configuration is left out on purpose: the person's settings, templates and themes (which have
 * tools of their own), and who may do what in the space.
 */
import { type EntityManifestEntry, type EntityManifestProperty, manifestEntries } from '@we/backend-shared';
import { type ContentBlock, createBlocks, type TextContentBlock } from '@we/block-shared';
import { completeResponse, getEntityForDataset } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

import type { SessionAnswer, SessionTool, SessionToolset } from '../core/conversation';

/** Core entities that are the app's configuration rather than what a space is about. */
const CONFIGURATION = new Set([
  'AgentSettings',
  'ChatMessage',
  'ChatSession',
  'EdgeRoute',
  'ExtractionAmendment',
  'ExtractionPass',
  'MutedAgent',
  'Placement',
  'Policy',
  'ReadMarker',
  'Role',
  'RoleGrant',
  'Shape',
  'Space',
  'SpaceLandmark',
  'SpacePreference',
  'SpaceTemplatePreference',
  'Template',
  'Theme',
  'TypeStyle',
]);

/** How many records a find answers at most, and how much of one long field it shows. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_FIELD = 400;

/** What a registered entity class offers, as far as these tools use it. */
interface RecordModel {
  findOne(dataset: unknown, query: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  findAll(dataset: unknown, query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  create(dataset: unknown, fields: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string }>;
  update(dataset: unknown, id: string, fields: Record<string, unknown>): Promise<unknown>;
  delete(dataset: unknown, id: string): Promise<unknown>;
}

export interface ModelDefinition {
  name: string;
  description?: string;
  properties: { name: string; type: 'string' | 'number' | 'boolean'; required?: boolean }[];
}

export interface DataToolsetOptions {
  /** The space the conversation is in, as the backend's dataset handle. */
  dataset: unknown;
  /** The space's own models, beside WE's. */
  models?: EntityManifestEntry[];
  /** Define a new kind of record in the space, answering its name. Absent: the tool is not offered. */
  defineModel?: (definition: ModelDefinition) => Promise<string>;
}

const coreEntries = (() => {
  let entries: EntityManifestEntry[] | undefined;
  return () =>
    (entries ??= manifestEntries(CORE_MANIFEST).filter(
      (entry) => !CORE_MANIFEST.entities[entry.name]?.abstract && !CONFIGURATION.has(entry.name),
    ));
})();

const isRelation = (property: EntityManifestProperty) => property.isCollection || property.type === 'uri';
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A field's value as the model reads it: ids for related records, long text cut short. */
function shown(value: unknown, relation: boolean): unknown {
  if (relation) {
    const ids = (Array.isArray(value) ? value : value ? [value] : []).map((v) =>
      typeof v === 'string' ? v : (v as { id?: string })?.id,
    );
    return ids.length > 10 ? [...ids.slice(0, 10), `…${ids.length - 10} more`] : ids;
  }
  if (typeof value === 'string' && value.length > MAX_FIELD) return `${value.slice(0, MAX_FIELD)}…`;
  return value;
}

/** Text as a composition: a paragraph per blank-line-separated run, `#` headings and `-` items read. */
export function textToBlocks(text: string): ContentBlock[] {
  return text.split(/\n\s*\n/).flatMap((part) => {
    const lines = part.split('\n').map((l) => l.trimEnd());
    if (lines.length > 1 && lines.every((l) => /^\s*[-*]\s+/.test(l)))
      return lines.map((l): TextContentBlock => ({
        _type: 'block',
        listItem: 'bullet',
        text: l.replace(/^\s*[-*]\s+/, ''),
      }));
    const joined = lines.join('\n').trim();
    if (!joined) return [];
    const heading = /^(#{1,3})\s+(.*)$/s.exec(joined);
    if (heading) return [{ _type: 'block', style: `h${heading[1].length}` as 'h1', text: heading[2] }];
    return [{ _type: 'block', text: joined } as TextContentBlock];
  });
}

export function createDataToolset(options: DataToolsetOptions): SessionToolset {
  const { dataset } = options;
  const entries = () => [...coreEntries(), ...(options.models ?? [])];
  const entryOf = (name: string) => entries().find((e) => e.name === name);

  const unknownEntity = (name: string) =>
    `Error: There is no kind of record called "${name}" here. The kinds are: ${entries()
      .map((e) => e.name)
      .join(', ')}. describe_space explains each.`;

  const model = (name: string) => getEntityForDataset(name, dataset) as RecordModel | undefined;

  async function spaceRoot(): Promise<{ id: string; name: string }> {
    try {
      const space = await model('Space')?.findOne(dataset, { include: { root: true } });
      return { id: (space?.root as { id?: string } | undefined)?.id ?? '', name: String(space?.name ?? '') };
    } catch {
      return { id: '', name: '' };
    }
  }

  function row(entry: EntityManifestEntry, record: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { id: record.id };
    for (const property of entry.properties) {
      const value = record[property.name];
      if (value === undefined || value === null || value === '') continue;
      out[property.name] = shown(value, isRelation(property));
    }
    return out;
  }

  /** Where a write puts the record: in a collection, or as a response to something. */
  function placement(args: Record<string, unknown>): { parent?: Record<string, unknown>; error?: string } {
    const inId = str(args.in);
    const respondsTo = str(args.respondsTo);
    if (inId && respondsTo)
      return { error: 'Error: A record is either in a collection (`in`) or a response (`respondsTo`), never both.' };
    if (inId) return { parent: { id: inId, relation: 'children', entity: 'CollectionBlock' } };
    if (respondsTo) return { parent: { id: respondsTo, relation: 'responses' } };
    return {};
  }

  const describe = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.entity);
    if (name) {
      const entry = entryOf(name);
      if (!entry) return { text: unknownEntity(name) };
      const declared = CORE_MANIFEST.entities[name];
      const lines = [`${name}${declared?.description ? ` — ${declared.description}` : ''}`];
      if (entry.interpretationHint) lines.push(entry.interpretationHint);
      for (const p of entry.properties) {
        const options = declared?.properties[p.name]?.options;
        lines.push(
          isRelation(p)
            ? `- ${p.name}: ${p.isCollection ? 'many' : 'one'} ${p.relatedEntity || 'record'}${p.ordered ? ', in order' : ''}${p.reverse ? ' (read from the other end)' : ''}`
            : `- ${p.name}: ${p.type}${p.required ? ', required' : ''}${options?.length ? ` — one of ${options.join(', ')}` : ''}`,
        );
      }
      return { text: lines.join('\n') };
    }
    const root = await spaceRoot();
    const kinds = entries().map((e) => {
      const description = CORE_MANIFEST.entities[e.name]?.description;
      return `- ${e.name}${description ? ` — ${description}` : options.models?.includes(e) ? ' (this space’s own)' : ''}`;
    });
    return {
      text: [
        `The space${root.name ? ` "${root.name}"` : ''}. Its top-level collection is ${root.id || 'not known'}: what is posted to the space goes there.`,
        '',
        'How WE links records:',
        '- A collection (CollectionBlock) holds its children in order; `kind` says what it is: post, reply, feed, board, column…',
        '- A reply is a response to what it answers, never a child of anything. write_post with `respondsTo` makes one.',
        '- Something made in a collection is its child: `in` on create_record or write_post.',
        '',
        'The kinds of record here (describe_space with `entity` for one’s fields):',
        ...kinds,
      ].join('\n'),
    };
  };

  const find = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.entity) ?? '';
    const entry = entryOf(name);
    const Model = entry && model(name);
    if (!entry || !Model) return { text: unknownEntity(name) };
    const where = args.where === undefined ? undefined : args.where;
    if (where !== undefined && !isObject(where)) return { text: 'Error: `where` is an object, as a $query takes.' };
    const placed = placement(args);
    if (placed.error) return { text: placed.error };
    const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rows = (await Model.findAll(dataset, {
      ...(where ? { where } : {}),
      ...(isObject(args.order) ? { order: args.order } : {}),
      ...(placed.parent ? { parent: placed.parent } : {}),
      limit: limit + 1,
    })) as Record<string, unknown>[];
    const more = rows.length > limit;
    const list = rows.slice(0, limit).map((r) => row(entry, r));
    return {
      text:
        list.length === 0
          ? `No ${name} records match.`
          : `${JSON.stringify(list)}${more ? `\nThere are more than ${limit}: narrow \`where\`, or raise \`limit\` (up to ${MAX_LIMIT}).` : ''}`,
    };
  };

  const read = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.entity) ?? '';
    const id = str(args.id);
    const entry = entryOf(name);
    const Model = entry && model(name);
    if (!entry || !Model) return { text: unknownEntity(name) };
    if (!id) return { text: 'Error: Give the `id` of the record to read.' };
    const record = (await Model.findOne(dataset, { where: { id } })) as Record<string, unknown> | null;
    return { text: record ? JSON.stringify(row(entry, record)) : `Error: There is no ${name} with the id ${id}.` };
  };

  const fieldsProblem = (entry: EntityManifestEntry, fields: Record<string, unknown>) => {
    const names = new Set(entry.properties.filter((p) => !isRelation(p)).map((p) => p.name));
    const unknown = Object.keys(fields).filter((key) => !names.has(key));
    return unknown.length
      ? `Error: ${entry.name} has no field ${unknown.map((k) => `\`${k}\``).join(', ')}. Its fields: ${[...names].join(', ')}.`
      : undefined;
  };

  const createRecord = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.entity) ?? '';
    const entry = entryOf(name);
    const Model = entry && model(name);
    if (!entry || !Model) return { text: unknownEntity(name) };
    const fields = isObject(args.fields) ? args.fields : {};
    const problem = fieldsProblem(entry, fields);
    if (problem) return { text: problem };
    const placed = placement(args);
    if (placed.error) return { text: placed.error };
    const created = (await Model.create(dataset, fields, placed.parent ? { parent: placed.parent } : undefined)) as {
      id: string;
    };
    if (placed.parent?.relation === 'responses') await completeResponse(dataset, created.id, String(placed.parent.id));
    return {
      text: `Made a ${name}: ${created.id}.`,
      wrote: [{ entity: name, id: created.id, change: 'created' }],
    };
  };

  const updateRecord = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.entity) ?? '';
    const id = str(args.id);
    const entry = entryOf(name);
    const Model = entry && model(name);
    if (!entry || !Model) return { text: unknownEntity(name) };
    if (!id) return { text: 'Error: Give the `id` of the record to change.' };
    const fields = isObject(args.fields) ? args.fields : {};
    if (!Object.keys(fields).length) return { text: 'Error: `fields` says nothing to change.' };
    const problem = fieldsProblem(entry, fields);
    if (problem) return { text: problem };
    await Model.update(dataset, id, fields);
    return {
      text: `Changed ${name} ${id}: ${Object.keys(fields).join(', ')}.`,
      wrote: [{ entity: name, id, change: 'updated' }],
    };
  };

  const deleteRecord = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.entity) ?? '';
    const id = str(args.id);
    const entry = entryOf(name);
    const Model = entry && model(name);
    if (!entry || !Model) return { text: unknownEntity(name) };
    if (!id) return { text: 'Error: Give the `id` of the record to delete.' };
    await Model.delete(dataset, id);
    return { text: `Deleted ${name} ${id}.`, wrote: [{ entity: name, id, change: 'deleted' }] };
  };

  const writePost = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const text = str(args.text);
    if (!text) return { text: 'Error: Give the `text` of the post.' };
    const kind = str(args.kind) ?? (args.respondsTo ? 'reply' : 'post');
    const placed = placement(args);
    if (placed.error) return { text: placed.error };
    // With nowhere named, a post goes in the space's top-level collection, as the app's own does.
    const anchor =
      placed.parent ??
      (await spaceRoot().then((root) =>
        root.id ? { id: root.id, relation: 'children', entity: 'CollectionBlock' } : undefined,
      ));
    const root = await createBlocks(dataset, textToBlocks(text), {
      kind,
      ...(anchor ? { anchor: anchor as never } : {}),
    });
    if (!root?.id) return { text: 'Error: The post could not be written.' };
    if (anchor?.relation === 'responses') await completeResponse(dataset, root.id, String(anchor.id));
    return {
      text: `Wrote a ${kind}: ${root.id}.`,
      wrote: [{ entity: 'CollectionBlock', id: root.id, change: 'created' }],
    };
  };

  const defineModel = async (args: Record<string, unknown>): Promise<SessionAnswer> => {
    const name = str(args.name);
    if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name))
      return { text: 'Error: `name` is the kind of record in PascalCase, e.g. "Sighting".' };
    if (entryOf(name)) return { text: `Error: There is already a kind of record called ${name}.` };
    const properties = Array.isArray(args.properties) ? args.properties : [];
    const fields = properties.flatMap((p) =>
      isObject(p) && str(p.name) && ['string', 'number', 'boolean'].includes(String(p.type))
        ? [{ name: String(p.name), type: p.type as 'string', required: p.required === true }]
        : [],
    );
    if (!fields.length || fields.length !== properties.length)
      return { text: 'Error: `properties` is a list of { name, type } with type string, number or boolean.' };
    const defined = await options.defineModel!({ name, description: str(args.description), properties: fields });
    return { text: `Defined ${defined}. Records of it can be made once the space has taken it in.` };
  };

  const entityParam = { type: 'string', description: 'The kind of record, e.g. "TaskBlock".' };
  const placeParams = {
    in: { type: 'string', description: 'A collection to put it in, by id.' },
    respondsTo: { type: 'string', description: 'What it answers, by id — makes it a response.' },
  };

  const tools: (SessionTool & { run: (args: Record<string, unknown>) => Promise<SessionAnswer> })[] = [
    {
      name: 'describe_space',
      description:
        'What the space holds: its kinds of record and how WE links them. With `entity`, that kind’s fields. Call it first.',
      parameters: { type: 'object', properties: { entity: { type: 'string', description: 'One kind of record.' } } },
      writes: false,
      run: describe,
    },
    {
      name: 'find_records',
      description: `Find records of one kind. \`where\` is a $query where-object; \`in\` and \`respondsTo\` narrow to one collection’s children or one record’s responses. At most ${MAX_LIMIT}.`,
      parameters: {
        type: 'object',
        properties: {
          entity: entityParam,
          where: { type: 'object', description: 'e.g. { "status": "todo" } or { "title": { "contains": "rota" } }' },
          order: { type: 'object', description: 'e.g. { "createdAt": "desc" }' },
          limit: { type: 'number', description: `How many, up to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.` },
          ...placeParams,
        },
        required: ['entity'],
      },
      writes: false,
      untrusted: true,
      run: find,
    },
    {
      name: 'read_record',
      description: 'One record, by kind and id: its fields, and the ids of what it links to.',
      parameters: {
        type: 'object',
        properties: { entity: entityParam, id: { type: 'string' } },
        required: ['entity', 'id'],
      },
      writes: false,
      untrusted: true,
      run: read,
    },
    {
      name: 'create_record',
      description:
        'Make a record. `fields` are its own fields (describe_space lists them). Put it in a collection with `in`, or make it a response with `respondsTo`. For a post or a reply, use write_post.',
      parameters: {
        type: 'object',
        properties: { entity: entityParam, fields: { type: 'object' }, ...placeParams },
        required: ['entity', 'fields'],
      },
      writes: true,
      run: createRecord,
    },
    {
      name: 'update_record',
      description: 'Change some of a record’s fields. Fields left out stay as they are.',
      parameters: {
        type: 'object',
        properties: { entity: entityParam, id: { type: 'string' }, fields: { type: 'object' } },
        required: ['entity', 'id', 'fields'],
      },
      writes: true,
      run: updateRecord,
    },
    {
      name: 'delete_record',
      description: 'Delete a record. The person is asked first.',
      parameters: {
        type: 'object',
        properties: { entity: entityParam, id: { type: 'string' } },
        required: ['entity', 'id'],
      },
      writes: true,
      confirm: (args) => `Delete this ${String(args.entity ?? 'record')}? It cannot be brought back.`,
      run: deleteRecord,
    },
    {
      name: 'write_post',
      description:
        'Write a post, a message or a reply, as the composer would. A reply names what it answers with `respondsTo`; a message names its channel with `in`; a post with neither goes in the space. Plain text: blank lines between paragraphs, `#` for a heading, `-` for list items.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', description: 'post (default), reply (default with respondsTo), or message.' },
          ...placeParams,
        },
        required: ['text'],
      },
      writes: true,
      run: writePost,
    },
    ...(options.defineModel
      ? [
          {
            name: 'define_model',
            description:
              'Define a new kind of record for the space, when nothing describe_space lists fits. Everyone in the space gets it. The person is asked first.',
            parameters: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'PascalCase, e.g. "Sighting".' },
                description: { type: 'string' },
                properties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', enum: ['string', 'number', 'boolean'] },
                      required: { type: 'boolean' },
                    },
                  },
                },
              },
              required: ['name', 'properties'],
            },
            writes: true,
            confirm: (args: Record<string, unknown>) =>
              `Add a new kind of record, ${String(args.name ?? '')}, to this space for everyone in it?`,
            run: defineModel,
          },
        ]
      : []),
  ];

  return {
    tools: tools.map(({ run: _run, ...tool }) => tool),
    async call(name, args) {
      const tool = tools.find((t) => t.name === name);
      return tool ? tool.run(args) : { text: `Error: Unknown tool: ${name}` };
    },
  };
}
