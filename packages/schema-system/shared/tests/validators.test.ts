import { describe, expect, it } from 'vitest';

import { validateNode, validateSchema } from '../src/shared/validators';

describe('validators', () => {
  it('validates a node successfully', () => {
    const node = { type: 'div' };
    const res = validateNode(node);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns errors for invalid node', () => {
    const node = { type: 'div', unknown: 1 };
    const res = validateNode(node);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toHaveProperty('path');
    expect(res.errors[0]).toHaveProperty('message');
  });

  it('validateSchema requires meta for template', () => {
    const template = { type: 'root' };
    const res = validateSchema(template);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('validateSchema reports nested meta icon type error', () => {
    const template = { type: 'root', meta: { name: 'T', description: 'd', icon: 123 } };
    const res = validateSchema(template);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path.includes('meta'))).toBe(true);
  });

  it('validateNode reports array children item errors', () => {
    const node = { type: 'div', children: [123] };
    const res = validateNode(node);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('validateSchema reports multiple nested errors', () => {
    const template = {
      type: 'root',
      meta: { name: 123, description: [], icon: null },
      routes: [{ path: 123 }],
    };
    const res = validateSchema(template);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});
