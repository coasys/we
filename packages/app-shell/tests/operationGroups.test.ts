import { describe, expect, it } from 'vitest';

import { CATEGORY_GROUPS, ENTITY_GROUPS, operationSurface } from '../src/shared/registries/operationGroups';
import { CAPABILITY_GROUPS } from '../src/shared/registries/templateSurface';

const effects = (entities: Record<string, string[]>, destructive = false, categories: Record<string, string[]> = {}) =>
  ({ entities, categories, bulk: false, destructive }) as Parameters<typeof operationSurface>[0];

describe('the capability group an operation needs', () => {
  it('is content for content, and for an entity nobody listed', () => {
    expect(operationSurface(effects({ CollectionBlock: ['create'], Sighting: ['create'] }))).toEqual({
      group: 'content',
      destructive: false,
    });
  });

  it('is the widest group its writes reach', () => {
    expect(operationSurface(effects({ CollectionBlock: ['create'], Signal: ['create'] })).group).toBe('signals');
    expect(operationSurface(effects({ Signal: ['create'], Space: ['edit'] })).group).toBe('space-settings');
    expect(operationSurface(effects({ Space: ['edit'], Theme: ['delete'] }, true))).toEqual({
      group: 'library',
      destructive: true,
    });
  });

  it('is content for any block type, and a category never narrows a wider write', () => {
    expect(operationSurface(effects({}, false, { blockable: ['create'] })).group).toBe('content');
    expect(operationSurface(effects({ Space: ['edit'] }, false, { blockable: ['create'] })).group).toBe(
      'space-settings',
    );
  });

  it('is the widest group a space template holds for any record type, and never a chrome group', () => {
    expect(operationSurface(effects({}, true, { any: ['delete'] }))).toEqual({
      group: 'space-settings',
      destructive: true,
    });
    expect(operationSurface(effects({ Template: ['edit'] }, false, { any: ['edit'] })).group).toBe('library');
  });

  it('is content for an operation that writes nothing', () => {
    expect(operationSurface(effects({})).group).toBe('content');
  });

  it('maps only to groups that exist', () => {
    for (const group of [...Object.values(ENTITY_GROUPS), ...Object.values(CATEGORY_GROUPS)])
      expect(CAPABILITY_GROUPS).toHaveProperty(group);
  });
});
