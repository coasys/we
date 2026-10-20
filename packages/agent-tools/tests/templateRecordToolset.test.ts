/**
 * A Template record in, the properties to write back out — the contract a host holds instead of
 * a schema. What is pinned here is that what comes out is what the app's own save writes, since
 * that is what the app is able to open and what an open screen hears about.
 */
import { decodeTemplateFile, encodeTemplateFile, ensureNodeIds, type TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { toolsets } from '../src/toolsets';

const schema = ensureNodeIds({
  type: 'Column',
  meta: { name: 'Test', description: '', icon: 'cube' },
  props: { bg: 'page' },
  author: 'did:someone-earlier',
  children: [{ type: 'we-text', children: ['Hello'] }],
} as unknown as TemplateSchema) as TemplateSchema;

/** The record as a host reads it: the file resolved to the data URI the app reads it as. */
const record = (properties: Record<string, unknown> = {}) => ({
  id: 'record-1',
  className: 'Template',
  properties: {
    name: 'Test',
    version: 3,
    schema: `data:application/json;base64,${encodeTemplateFile(schema).data_base64}`,
    ...properties,
  },
});

const world = { patches: [{ targetId: '', insert: { children: { node: { type: 'we-text', children: ['World'] } } } }] };
const request = 'Add a line saying World';

describe('the template toolset over a record', () => {
  it('is found by the entity it edits', () => {
    expect(Object.values(toolsets).find((t) => t.appliesTo.includes('Template'))).toBe(toolsets.template);
  });

  it('writes nothing when nothing was kept', async () => {
    const toolset = await toolsets.template.open({ record: record(), request });
    await toolset.call('update_schema', {
      patches: [{ targetId: '', insert: { children: { node: { type: 'we-nonexistent' } } } }],
    });
    expect(toolset.result()).toEqual({ changed: false, properties: {} });
  });

  it('writes the schema as the app does, with the version the app watches moved on', async () => {
    const toolset = await toolsets.template.open({ record: record(), request, author: 'did:me' });
    expect(await toolset.call('update_schema', world)).not.toMatch(/^Error/);

    const { changed, properties } = toolset.result();
    expect(changed).toBe(true);
    expect(Object.keys(properties).sort()).toEqual(['schema', 'version']);
    expect(properties.version).toBe(4);

    const file = properties.schema as { data_base64: string; name: string; file_type: string };
    expect(file).toMatchObject({ name: 'template-schema.json', file_type: 'application/json' });
    const written = decodeTemplateFile(file)!;
    expect(JSON.stringify(written)).toContain('"World"');
    expect(written.id).toBe(schema.id);
    expect(written.meta).toEqual(schema.meta);
    expect(written.author).toBe('did:me');
  });

  it('records no author when it is not told who the write goes out as', async () => {
    const toolset = await toolsets.template.open({ record: record(), request });
    await toolset.call('update_schema', world);
    expect(decodeTemplateFile(toolset.result().properties.schema)!.author).toBeUndefined();
  });

  it('does not show the model who saved the template last', async () => {
    const toolset = await toolsets.template.open({ record: record(), request });
    expect(toolset.prompt).not.toContain('did:someone-earlier');
  });

  it('starts from version 1 for a record that never had one', async () => {
    const toolset = await toolsets.template.open({ record: record({ version: undefined }), request });
    await toolset.call('update_schema', world);
    expect(toolset.result().properties.version).toBe(2);
  });

  it('refuses a record it cannot read, as the host’s mistake rather than the model’s', async () => {
    await expect(toolsets.template.open({ record: record({ schema: '' }), request })).rejects.toThrow(/no schema/);
    await expect(toolsets.template.open({ record: { ...record(), className: 'Theme' }, request })).rejects.toThrow(
      /not Theme/,
    );
  });
});
