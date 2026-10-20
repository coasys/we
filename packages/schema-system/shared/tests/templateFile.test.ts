/**
 * The file a Template record's `schema` property holds: what the app writes, and every form the
 * same value can arrive in when it is read back.
 */
import { describe, expect, it } from 'vitest';

import { decodeTemplateFile, encodeTemplateFile } from '../src/templateFile';
import type { TemplateSchema } from '../src/types';

const schema = {
  type: 'Column',
  id: 'root',
  meta: { name: 'Café ☕', description: 'Not ASCII', icon: 'coffee' },
  children: [{ type: 'we-text', id: 'n1', children: ['Grüße'] }],
} as unknown as TemplateSchema;

const text = (base64: string) => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

describe('a template file', () => {
  it('holds the schema with its section index, and nothing else unless asked', () => {
    const file = encodeTemplateFile(schema);
    expect(file.name).toBe('template-schema.json');
    expect(file.file_type).toBe('application/json');
    const body = JSON.parse(text(file.data_base64));
    expect(Object.keys(body).sort()).toEqual(['schema', 'sections']);
    expect(body.schema).toEqual(schema);
  });

  it('carries savedAt beside the schema when it is a save, so the same schema twice is two files', () => {
    const first = encodeTemplateFile(schema, { savedAt: 1 });
    const second = encodeTemplateFile(schema, { savedAt: 2 });
    expect(first.data_base64).not.toBe(second.data_base64);
    expect(JSON.parse(text(first.data_base64)).savedAt).toBe(1);
  });

  it('reads back as the schema however the value arrives', () => {
    const file = encodeTemplateFile(schema, { savedAt: 5 });
    const dataUri = `data:application/json;base64,${file.data_base64}`;
    const json = text(file.data_base64);
    for (const value of [file, dataUri, json, JSON.parse(json)]) expect(decodeTemplateFile(value)).toEqual(schema);
  });

  it('reads a record written before the section index, which held the bare schema', () => {
    expect(decodeTemplateFile(JSON.stringify(schema))).toEqual(schema);
  });

  it('reads nothing from a value that holds no template', () => {
    for (const value of [undefined, null, '', 'data:application/json;base64,!!!', '{"not":"a node"}', '[1]', 42])
      expect(decodeTemplateFile(value)).toBeUndefined();
  });
});
