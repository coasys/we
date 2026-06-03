import { describe, expect, it } from 'vitest';

import { validateStructure } from '../src/validators';

describe('validators', () => {
  it('validates a node successfully', () => {
    const node = { type: 'div' };
    const res = validateStructure(node);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns errors for invalid node', () => {
    const node = { type: 'div', unknown: 1 };
    const res = validateStructure(node);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toHaveProperty('path');
    expect(res.errors[0]).toHaveProperty('message');
    expect(res.errors[0]).toHaveProperty('severity', 'error');
  });

  it('validates SchemaNode without meta', () => {
    const node = { type: 'root' };
    const res = validateStructure(node);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('validates TemplateSchema with meta and reports icon type error', () => {
    const template = { type: 'root', meta: { name: 'T', description: 'd', icon: 123 } };
    const res = validateStructure(template);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('meta'))).toBe(true);
  });

  it('reports array children item errors', () => {
    const node = { type: 'div', children: [123] };
    const res = validateStructure(node);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('reports multiple nested errors in TemplateSchema', () => {
    const template = {
      type: 'root',
      meta: { name: 123, description: [], icon: null },
      routes: [{ path: 123 }],
    };
    const res = validateStructure(template);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
