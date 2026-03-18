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
    expect(() => zSchemaProp.parse({ $store: 'x.y' })).not.toThrow(); // record
    expect(() => zSchemaProp.parse(['a', 1, true])).not.toThrow(); // array
  });

  it('accepts token objects as SchemaProp records', () => {
    expect(() => zSchemaProp.parse({ $store: 'userStore.name' })).not.toThrow();
    expect(() => zSchemaProp.parse({ $action: 'routeStore.navigate', args: ['/'] })).not.toThrow();
    expect(() => zSchemaProp.parse({ $if: { condition: true, then: 'a', else: 'b' } })).not.toThrow();
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
});
