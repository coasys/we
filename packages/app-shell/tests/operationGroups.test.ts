import { describe, expect, it } from 'vitest';

import { admitsChosen, ENTITY_GROUPS, entityGroup, operationSurface } from '../src/shared/registries/operationGroups';
import { CAPABILITY_GROUPS } from '../src/shared/registries/templateSurface';

const effects = (entities: Record<string, string[]>, destructive = false, categories: Record<string, string[]> = {}) =>
  ({ entities, categories, bulk: false, destructive }) as Parameters<typeof operationSurface>[0];

describe('the capability group an operation needs', () => {
  it('is content for content, and for an entity nobody listed', () => {
    expect(operationSurface(effects({ CollectionBlock: ['create'], Sighting: ['create'] }))).toEqual({
      group: 'content',
      chosen: [],
      destructive: false,
    });
  });

  it('is the widest group its writes reach', () => {
    expect(operationSurface(effects({ CollectionBlock: ['create'], Signal: ['create'] })).group).toBe('signals');
    expect(operationSurface(effects({ Signal: ['create'], Space: ['edit'] })).group).toBe('space-settings');
    expect(operationSurface(effects({ Space: ['edit'], Theme: ['delete'] }, true))).toEqual({
      group: 'library',
      chosen: [],
      destructive: true,
    });
  });

  it('leaves an entity chosen at call time out of the group, and lists its category for the call to judge', () => {
    expect(operationSurface(effects({}, true, { any: ['delete'] }))).toEqual({
      group: 'content',
      chosen: ['any'],
      destructive: true,
    });
    expect(operationSurface(effects({ Space: ['edit'] }, false, { blockable: ['create'], any: ['edit'] }))).toEqual({
      group: 'space-settings',
      chosen: ['any', 'blockable'],
      destructive: false,
    });
  });

  it('judges a chosen entity by the same table, against the grants', () => {
    expect(entityGroup('TaskBlock')).toBe('content');
    expect(entityGroup('TaskState')).toBe('space-settings');
    expect(admitsChosen(new Set(['content']), 'TaskBlock')).toBe(true);
    expect(admitsChosen(new Set(['content']), 'TaskState')).toBe(false);
    expect(admitsChosen(new Set(['content', 'space-settings']), 'AgentSettings')).toBe(false);
  });

  it('is content for an operation that writes nothing', () => {
    expect(operationSurface(effects({})).group).toBe('content');
  });

  it('maps only to groups that exist', () => {
    for (const group of Object.values(ENTITY_GROUPS)) expect(CAPABILITY_GROUPS).toHaveProperty(group);
  });
});
