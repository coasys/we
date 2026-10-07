import { describe, expect, it } from 'vitest';

import { freeNames } from '../src/freeNames';

describe('freeNames', () => {
  it('reports a name nothing inside binds', () => {
    expect(freeNames({ type: 'we-text', children: [{ $: 'tile.name' }] })).toEqual({ names: ['tile'], locals: [] });
  });

  it('does not report what an $each inside binds, with its index and prev', () => {
    const tree = {
      type: '$each',
      props: { items: { $: 'spaceStore.members' }, as: 'person' },
      children: [{ type: 'we-text', children: [{ $: '`${index} ${person.name} ${prev.name}`' }] }],
    };
    expect(freeNames(tree)).toEqual({ names: [], locals: [] });
  });

  it('reports a name read by what an $each is fed, which is outside its rows', () => {
    const tree = { type: '$each', props: { items: { $: 'block.options' }, as: 'block' }, children: [] };
    expect(freeNames(tree).names).toEqual(['block']);
  });

  it('never reports stores, modules or what the host binds everywhere', () => {
    const tree = { type: 'we-text', children: [{ $: 'spaceStore.x + modules.call.active + me.did + surface.tier' }] };
    expect(freeNames(tree)).toEqual({ names: [], locals: [] });
  });

  it('reports a local read or written that nothing inside declares', () => {
    const tree = {
      type: 'we-button',
      props: { disabled: { $: 'local.busy' }, onClick: { $setLocal: 'open', value: true } },
    };
    expect(freeNames(tree).locals).toEqual(['busy', 'open']);
  });

  it('does not report locals declared inside, queries and their Loaded flag included', () => {
    const tree = {
      type: 'Column',
      $localState: { open: { type: 'boolean', initial: false } },
      $queries: { rows: { entity: 'Poll' } },
      children: [{ type: 'we-text', children: [{ $: 'local.open && local.rowsLoaded && count(local.rows)' }] }],
    };
    expect(freeNames(tree)).toEqual({ names: [], locals: [] });
  });

  it('finds a read in a where-clause a structural walk would step over', () => {
    const tree = { type: 'Column', $queries: { votes: { entity: 'Vote', where: { pollId: { $: 'block.id' } } } } };
    expect(freeNames(tree).names).toEqual(['block']);
  });
});
