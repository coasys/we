/**
 * The template tools as a host calls them: one call at a time, each given the record as it is
 * stored now, nothing held in between.
 *
 * The rules for an edit are the session's and are pinned there. What is pinned here is the
 * contract a host relies on: errors come back as text the model can act on rather than as throws,
 * arguments arrive in either form a provider sends, a read and the update written from it agree on
 * what every id means, and what an update returns is what the app's own save writes.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import { decodeTemplateFile, encodeTemplateFile } from '@we/entities';
import { ensureNodeIds, forEachNode, type SchemaNode, type TemplateSchema } from '@we/schema-shared';
import { kanbanTemplate } from '@we/template-showcase';
import { describe, expect, it } from 'vitest';

import type { RecordInput } from '../src/core/toolset';
import { prepareForModel } from '../src/templates/nodeAliases';
import { TEMPLATE_CREATE, TEMPLATE_READ, TEMPLATE_UPDATE, templateToolset } from '../src/templates/templateToolset';
import { toolsets } from '../src/toolsets';

const schema = ensureNodeIds({
  type: 'Column',
  meta: { name: 'Test', description: '', icon: 'cube' },
  props: { bg: 'page' },
  author: 'did:someone-earlier',
  children: [
    { type: 'we-text', children: ['Hello'] },
    { type: 'we-text', children: ['Goodbye'] },
  ],
} as unknown as TemplateSchema) as TemplateSchema;

/** The record as a host reads it: the file resolved to the data URI the app reads it as. */
const record = (properties: Record<string, unknown> = {}, of: TemplateSchema = schema): RecordInput => ({
  id: 'record-1',
  className: 'Template',
  properties: {
    name: 'Test',
    version: 3,
    schema: `data:application/json;base64,${encodeTemplateFile(of).data_base64}`,
    ...properties,
  },
});

const read = async (args: unknown = {}, input: Partial<Parameters<typeof templateToolset.call>[1]> = {}) =>
  (await templateToolset.call(TEMPLATE_READ, { record: record(), args, ...input })).text;
const update = (args: unknown, input: Partial<Parameters<typeof templateToolset.call>[1]> = {}) =>
  templateToolset.call(TEMPLATE_UPDATE, { record: record(), args, ...input });

const insert = (node: unknown) => ({ targetId: '', insert: { children: { node } } });
const world = { version: 3, patches: [insert({ type: 'we-text', children: ['World'] })] };

const written = (properties: Record<string, unknown> | undefined) =>
  decodeTemplateFile<TemplateSchema>(properties?.schema)!;
const idsOf = (node: SchemaNode) => {
  const ids = new Set<string>();
  forEachNode(node, (n) => void (n.id && ids.add(n.id)));
  return ids;
};

const sightings: EntityManifestEntry = {
  name: 'Sighting',
  targetClass: 'community://sighting',
  properties: [
    {
      name: 'species',
      predicate: 'community://species',
      type: 'string',
      isCollection: false,
      required: true,
      writable: true,
    },
  ],
};
const listSightings = insert({
  type: '$each',
  props: { items: { $query: { entity: 'Sighting', limit: 10 } }, as: 'row' },
  children: [{ type: 'we-text', children: [{ $: 'row.species' }] }],
});

describe('the template tools', () => {
  it('are found by the entity they work on, and say which of them writes', () => {
    expect(Object.values(toolsets).find((t) => t.appliesTo.includes('Template'))).toBe(templateToolset);
    expect(templateToolset.tools.map(({ name, writes, creates }) => ({ name, writes, creates }))).toEqual([
      { name: TEMPLATE_READ, writes: false, creates: undefined },
      { name: TEMPLATE_UPDATE, writes: true, creates: undefined },
      { name: TEMPLATE_CREATE, writes: true, creates: { entity: 'Template', places: ['library', 'space'] } },
    ]);
  });

  it('read the template with its version, and do not show who saved it last', async () => {
    const answer = JSON.parse(await read());
    expect(answer.version).toBe(3);
    expect(JSON.stringify(answer.currentSchema)).toContain('Hello');
    expect(JSON.stringify(answer)).not.toContain('did:someone-earlier');
  });

  it('read the same ids every time from the same stored template', async () => {
    expect(await read()).toBe(await read());
  });

  it('read the same ids for a template with shared shapes, whose own ids are minted afresh each time', async () => {
    // Compaction gives a shared shape's nodes new ids on every pass, so only the aliases — numbered
    // by walking the tree — can be the same twice. This is what a read and the update after it rely on.
    const tree = prepareForModel(kanbanTemplate as SchemaNode);
    const kanban = record({}, tree.restore(tree.schema) as TemplateSchema);
    const readKanban = async () => (await templateToolset.call(TEMPLATE_READ, { record: kanban, args: {} })).text;

    const first = await readKanban();
    expect(first).toBe(await readKanban());

    const defs = JSON.parse(first).currentSchema.$defs as Record<string, SchemaNode>;
    const inside = Object.values(defs)[0].id!;
    const answer = await templateToolset.call(TEMPLATE_UPDATE, {
      record: kanban,
      args: { version: 3, patches: [{ targetId: inside, node: { props: { 'data-smoke': 'yes' } } }] },
    });
    expect(answer.text).toMatch(/^Saved as version 4\./);
    expect(JSON.stringify(written(answer.properties))).toContain('"data-smoke":"yes"');
  });

  it('read nodes by id, and find them by what they say', async () => {
    const found = await read({ find: 'Goodbye' });
    expect(found).toMatch(/^Template version 3\./);
    const id = found.match(/(n\d+) we-text — Goodbye/)?.[1];
    expect(id).toBeDefined();
    expect(await read({ ids: [id] })).toContain('"Goodbye"');
  });

  it('save an update written from a read on the node that read named', async () => {
    const id = (await read({ find: 'Goodbye' })).match(/(n\d+) we-text — Goodbye/)![1];
    const { text, properties } = await update({
      version: 3,
      patches: [{ targetId: id, node: { children: ['Farewell'] } }],
    });
    expect(text).toMatch(/^Saved as version 4\./);

    const after = written(properties);
    const original = (schema.children as SchemaNode[])[1];
    const edited = (after.children as SchemaNode[]).find((child) => child.id === original.id);
    expect(edited?.children).toEqual(['Farewell']);
  });

  it('write the schema as the app does, with the version the app watches moved on', async () => {
    const { text, properties } = await update(world, { author: 'did:me' });
    expect(text).toContain(`call ${TEMPLATE_READ} again`);
    expect(Object.keys(properties!).sort()).toEqual(['schema', 'version']);
    expect(properties!.version).toBe(4);
    expect(properties!.schema).toMatchObject({ name: 'template-schema.json', file_type: 'application/json' });

    const after = written(properties);
    expect(JSON.stringify(after)).toContain('"World"');
    expect(after.id).toBe(schema.id);
    expect(after.meta).toEqual(schema.meta);
    expect(after.author).toBe('did:me');

    const before = idsOf(schema);
    const kept = idsOf(after);
    expect([...before].every((id) => kept.has(id))).toBe(true);
    expect(kept.size).toBe(before.size + 1);
  });

  it('record no author when not told who the write goes out as', async () => {
    expect(written((await update(world)).properties).author).toBeUndefined();
  });

  it('start from version 1 for a record that never had one', async () => {
    const answer = await templateToolset.call(TEMPLATE_UPDATE, {
      record: record({ version: undefined }),
      args: { ...world, version: 1 },
    });
    expect(answer.properties?.version).toBe(2);
  });

  it('refuse an update written against another version, and one that does not say', async () => {
    const stale = await update({ ...world, version: 2 });
    expect(stale.text).toMatch(/^Error: The template has changed since it was read — it is version 3 now/);
    expect(stale.properties).toBeUndefined();

    expect((await update({ patches: world.patches })).text).toMatch(/^Error: Pass the version/);
  });

  it('answer a refused edit with an error the model can act on, and write nothing', async () => {
    const answer = await update({ version: 3, patches: [insert({ type: 'we-nonexistent' })] });
    expect(answer.text).toMatch(/^Error: Semantic validation failed/);
    expect(answer.properties).toBeUndefined();
    expect((await update({ version: 3, patches: [] })).text).toMatch(/^Error: No patches/);
  });

  it('check a dry run and write nothing', async () => {
    const answer = await update({ ...world, dry_run: true });
    expect(answer.text).toMatch(/^Valid: .*Nothing was saved/);
    expect(answer.properties).toBeUndefined();
  });

  it('take arguments as the JSON string a provider may send', async () => {
    expect((await update(JSON.stringify(world))).properties?.version).toBe(4);
    expect((await update('{not json')).text).toMatch(/^Error: The arguments/);
    expect(await read('{not json')).toMatch(/^Error: The arguments/);
  });

  it('refuse a tool they do not have rather than throwing', async () => {
    expect((await templateToolset.call('delete_everything', { record: record(), args: {} })).text).toBe(
      'Error: Unknown tool: delete_everything',
    );
  });

  it("let a template query the dataset's own models, and say what they hold", async () => {
    expect((await update({ version: 3, patches: [listSightings] })).text).toMatch(
      /^Error: Semantic validation failed \(1 issues\).*Sighting/,
    );

    const answer = await read({}, { models: [sightings] });
    expect(answer).toContain('Sighting');
    expect(answer).toContain('species');
    expect((await update({ version: 3, patches: [listSightings] }, { models: [sightings] })).text).toMatch(/^Saved/);
  });

  it('throw for a record they cannot read, as the host’s mistake rather than the model’s', async () => {
    await expect(templateToolset.call(TEMPLATE_READ, { record: record({ schema: '' }), args: {} })).rejects.toThrow(
      /no schema/,
    );
    await expect(
      templateToolset.call(TEMPLATE_READ, { record: { ...record(), className: 'Theme' }, args: {} }),
    ).rejects.toThrow(/not Theme/);
  });
});

describe('the template documentation', () => {
  it('lists the topic to start from first, then a topic per component, store and section', async () => {
    const paths = (await templateToolset.docs.list()).map((doc) => doc.path);
    expect(paths[0]).toBe('template');
    expect(paths).toEqual(
      expect.arrayContaining([
        'template/core/expressions',
        'template/core/design-props',
        'template/components/we-button',
        'template/stores/spaceStore',
        'template/sections/patterns',
      ]),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('starts with the tools and how a template is built, and ends with what else there is', async () => {
    const start = (await templateToolset.docs.read('template'))!;
    expect(start).toContain(TEMPLATE_READ);
    expect(start).toContain(`Prefer a single ${TEMPLATE_UPDATE} call`);
    expect(start).toContain('## Schema Structure');
    expect(start).toContain('template/core/expressions');
    expect(start).toContain('template/components/<name>');
    // What most edits need and some do not is a topic of its own, so the start fits a small window.
    expect(start).not.toContain('## Prop-level Dynamic Logic & Expressions');
    expect(start).not.toContain('## Component Registry');
    expect(await templateToolset.docs.read('template/core/expressions')).toContain('## Prop-level Dynamic Logic');
  });

  it('answers a topic with its text, and a path that is not one with nothing', async () => {
    expect(await templateToolset.docs.read('template/components/we-button')).toMatch(/- we-button/);
    expect(await templateToolset.docs.read('template/stores/spaceStore')).toContain('SpaceStore:');
    expect(await templateToolset.docs.read('template/nothing')).toBeUndefined();
  });
});
