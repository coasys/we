import { describe, expect, it } from 'vitest';

import { zRouteSchema, zSchemaNode, zSchemaProp, zTemplateMeta, zTemplateSchema } from '../src/zodSchemas';

describe('zodSchemas', () => {
  // --- SchemaNode ---
  it('parses a minimal schema node', () => {
    const node = { type: 'div' };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('parses a schema node with no type (fragment)', () => {
    const node = { children: [{ type: 'div' }] };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('parses a schema node with all optional fields', () => {
    const node = {
      type: 'Column',
      props: { gap: 300, label: 'hello' },
      slots: { header: { type: 'we-text' } },
      slot: 'content',
      routes: [{ type: 'Page', path: '/home' }],
      children: [{ type: 'we-button' }, 'plain text'],
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('parses deeply nested children', () => {
    const node = {
      type: 'a',
      children: [{ type: 'b', children: [{ type: 'c', children: [{ type: 'd' }] }] }],
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('rejects unknown properties (strict)', () => {
    const node = { type: 'div', unknown: 1 };
    expect(() => zSchemaNode.parse(node)).toThrow();
  });

  // --- SchemaProp ---
  it('accepts all SchemaProp union arms', () => {
    expect(() => zSchemaProp.parse('hello')).not.toThrow(); // string
    expect(() => zSchemaProp.parse(42)).not.toThrow(); // number
    expect(() => zSchemaProp.parse(true)).not.toThrow(); // boolean
    expect(() => zSchemaProp.parse(undefined)).not.toThrow(); // undefined
    expect(() => zSchemaProp.parse({ $: 'x.y' })).not.toThrow(); // expression
    expect(() => zSchemaProp.parse(['a', 1, true])).not.toThrow(); // array
  });

  it('accepts token objects as SchemaProp records', () => {
    expect(() => zSchemaProp.parse({ $: 'userStore.name' })).not.toThrow();
    expect(() => zSchemaProp.parse({ $action: 'routeStore.navigate', args: ['/'] })).not.toThrow();
    expect(() =>
      zSchemaProp.parse({ $if: { condition: { $: 'local.ok' }, then: { $action: 'a.b' }, else: { $action: 'c.d' } } }),
    ).not.toThrow();
  });

  // --- TemplateMeta ---
  it('parses valid TemplateMeta', () => {
    expect(() => zTemplateMeta.parse({ name: 'T', description: 'd', icon: 'i' })).not.toThrow();
  });

  it('rejects TemplateMeta with missing fields', () => {
    expect(() => zTemplateMeta.parse({ name: 'T' })).toThrow();
    expect(() => zTemplateMeta.parse({})).toThrow();
  });

  it('rejects TemplateMeta with extra fields (strict)', () => {
    expect(() => zTemplateMeta.parse({ name: 'T', description: 'd', icon: 'i', extra: true })).toThrow();
  });

  // --- TemplateSchema ---
  it('parses a template schema with meta', () => {
    const template = {
      meta: { name: 'T', description: 'd', icon: 'i' },
      type: 'root',
    };
    expect(() => zTemplateSchema.parse(template)).not.toThrow();
  });

  it('parses a template schema with id and schemaVersion', () => {
    const template = {
      id: 'tmpl-1',
      schemaVersion: 1,
      meta: { name: 'T', description: 'd', icon: 'i' },
      type: 'root',
    };
    expect(() => zTemplateSchema.parse(template)).not.toThrow();
  });

  it('rejects template schema without meta', () => {
    expect(() => zTemplateSchema.parse({ type: 'root' })).toThrow();
  });

  it('rejects template schema with extra fields (strict)', () => {
    const template = {
      meta: { name: 'T', description: 'd', icon: 'i' },
      type: 'root',
      bogus: 123,
    };
    expect(() => zTemplateSchema.parse(template)).toThrow();
  });

  // --- RouteSchema ---
  it('parses a valid route schema', () => {
    const route = { type: 'Page', path: '/home' };
    expect(() => zRouteSchema.parse(route)).not.toThrow();
  });

  it('rejects route schema without path', () => {
    expect(() => zRouteSchema.parse({ type: 'Page' })).toThrow();
  });

  it('rejects route schema with extra fields (strict)', () => {
    expect(() => zRouteSchema.parse({ type: 'Page', path: '/', extra: 1 })).toThrow();
  });

  // --- local reads / $setLocal tokens ---
  it('reads a local through an expression', () => {
    expect(() => zSchemaProp.parse({ $: 'local.name' })).not.toThrow();
  });

  it('accepts $setLocal with an expression value', () => {
    expect(() => zSchemaProp.parse({ $setLocal: 'name', value: { $: 'event.target.value' } })).not.toThrow();
  });

  it('accepts $setLocal with a literal value', () => {
    expect(() => zSchemaProp.parse({ $setLocal: 'name', value: 'hello' })).not.toThrow();
  });

  it('accepts $setLocal with merge', () => {
    expect(() => zSchemaProp.parse({ $setLocal: 'location', merge: { city: { $: 'event.detail' } } })).not.toThrow();
  });

  it('rejects $setLocal with neither value nor merge', () => {
    expect(() => zSchemaProp.parse({ $setLocal: 'name' })).toThrow();
  });

  // --- $toggleLocal ---
  it('accepts $toggleLocal token as SchemaProp', () => {
    expect(() => zSchemaProp.parse({ $toggleLocal: 'showComments' })).not.toThrow();
  });

  it('rejects $toggleLocal with empty string', () => {
    expect(() => zSchemaProp.parse({ $toggleLocal: '' })).toThrow();
  });

  it('rejects $toggleLocal with extra keys (strict)', () => {
    expect(() => zSchemaProp.parse({ $toggleLocal: 'name', extra: true })).toThrow();
  });

  // --- $localState on SchemaNode ---
  it('accepts SchemaNode with $localState declaration', () => {
    const node = {
      type: 'Column',
      $localState: {
        name: { type: 'string', initial: '' },
        loading: { type: 'boolean', initial: false },
        count: { type: 'number', initial: 0 },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('accepts $localState with file type and null initial', () => {
    const node = {
      type: 'Column',
      $localState: {
        thumbnail: { type: 'file', initial: null },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('rejects $localState with invalid field type', () => {
    const node = {
      type: 'Column',
      $localState: { name: { type: 'object', initial: {} } },
    };
    expect(() => zSchemaNode.parse(node)).toThrow();
  });

  it('rejects $localState with missing initial', () => {
    const node = {
      type: 'Column',
      $localState: { name: { type: 'string' } },
    };
    expect(() => zSchemaNode.parse(node)).toThrow();
  });

  // --- Validation tokens ---

  it('reads validation state through the expression functions', () => {
    expect(() => zSchemaProp.parse({ $: "error('name')" })).not.toThrow();
    expect(() => zSchemaProp.parse({ $: 'formValid()' })).not.toThrow();
  });

  it('accepts $touch token with field name', () => {
    expect(() => zSchemaProp.parse({ $touch: 'name' })).not.toThrow();
  });

  it('accepts $touch token with $all', () => {
    expect(() => zSchemaProp.parse({ $touch: '$all' })).not.toThrow();
  });

  it('accepts $resetLocal token', () => {
    expect(() => zSchemaProp.parse({ $resetLocal: '$scope' })).not.toThrow();
  });

  it('rejects $resetLocal with extra keys', () => {
    expect(() => zSchemaProp.parse({ $resetLocal: '$scope', extra: true })).toThrow();
  });

  // --- Validation rules in $localState ---

  it('accepts $localState with validate rules', () => {
    const node = {
      type: 'Column',
      $localState: {
        name: {
          type: 'string',
          initial: '',
          validate: [{ rule: 'required' }, { rule: 'minLength', value: 3 }],
        },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('accepts $localState with custom messages', () => {
    const node = {
      type: 'Column',
      $localState: {
        email: {
          type: 'string',
          initial: '',
          validate: [
            { rule: 'required', message: 'Email is required' },
            { rule: 'pattern', value: '^[^@]+@[^@]+$', message: 'Invalid email' },
          ],
        },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('accepts $localState with match rule', () => {
    const node = {
      type: 'Column',
      $localState: {
        confirmPassword: {
          type: 'string',
          initial: '',
          validate: [{ rule: 'match', field: 'password', message: 'Passwords must match' }],
        },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('accepts $localState with all rule types', () => {
    const node = {
      type: 'Column',
      $localState: {
        field: {
          type: 'string',
          initial: '',
          validate: [
            { rule: 'required' },
            { rule: 'minLength', value: 1 },
            { rule: 'maxLength', value: 100 },
            { rule: 'min', value: 0 },
            { rule: 'max', value: 999 },
            { rule: 'pattern', value: '.*' },
            { rule: 'match', field: 'other' },
          ],
        },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('rejects invalid rule name', () => {
    const node = {
      type: 'Column',
      $localState: {
        name: {
          type: 'string',
          initial: '',
          validate: [{ rule: 'invalid' }],
        },
      },
    };
    expect(() => zSchemaNode.parse(node)).toThrow();
  });

  it('rejects minLength without value', () => {
    const node = {
      type: 'Column',
      $localState: {
        name: {
          type: 'string',
          initial: '',
          validate: [{ rule: 'minLength' }],
        },
      },
    };
    expect(() => zSchemaNode.parse(node)).toThrow();
  });

  it('accepts $localState without validate (backwards compatible)', () => {
    const node = {
      type: 'Column',
      $localState: {
        name: { type: 'string', initial: '' },
      },
    };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });
});
