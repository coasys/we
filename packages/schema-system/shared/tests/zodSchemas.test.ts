import { describe, expect, it } from 'vitest';

import { zSchemaNode, zTemplateSchema } from '../src/shared/zodSchemas';

describe('zodSchemas', () => {
  it('parses a minimal schema node', () => {
    const node = { type: 'div' };
    expect(() => zSchemaNode.parse(node)).not.toThrow();
  });

  it('rejects unknown properties (strict)', () => {
    const node = { type: 'div', unknown: 1 };
    expect(() => zSchemaNode.parse(node)).toThrow();
  });

  it('parses a template schema with meta', () => {
    const template = {
      meta: { name: 'T', description: 'd', icon: 'i' },
      type: 'root',
    };
    expect(() => zTemplateSchema.parse(template)).not.toThrow();
  });
});
