import { describe, expect, it } from 'vitest';

import { parseRecordViewKey, recordRouteBody, recordViewCandidates } from '../src/recordViews';
import type { TemplateSchema } from '../src/types';
import type { ResolvedView } from '../src/viewRoutes';

const view = (id: string, draws?: { entity: string; kind?: string }): ResolvedView => ({
  id,
  segment: id,
  schema: {
    id,
    type: 'Column',
    meta: { name: id, description: '', icon: 'x', role: 'view', ...(draws ? { draws } : {}) },
    children: [id],
  } as TemplateSchema,
});

const generic = { type: 'Column', children: ['generic'] };

describe('the key a template names a type by', () => {
  it('is an entity, or an entity and a kind', () => {
    expect(parseRecordViewKey('TaskBlock')).toEqual({ entity: 'TaskBlock' });
    expect(parseRecordViewKey('CollectionBlock:call')).toEqual({ entity: 'CollectionBlock', kind: 'call' });
    expect(parseRecordViewKey('taskBlock')).toBeNull();
    expect(parseRecordViewKey('A:b:c')).toBeNull();
  });
});

describe('which views can draw a record', () => {
  const views = [
    view('task-page', { entity: 'TaskBlock' }),
    view('call-page', { entity: 'CollectionBlock', kind: 'call' }),
    view('cards'),
  ];

  it('asks the template first, then the views that say what they draw, and each type once', () => {
    const template = {
      meta: {
        name: 't',
        description: '',
        icon: 'x',
        recordViews: { TaskBlock: { type: 'Row', children: ['mine'] }, Proposal: 'task-page', Missing: 'nowhere' },
      },
    };
    const found = recordViewCandidates(template, views);
    expect(found.map((c) => [c.entity, c.kind ?? '', (c.node.children as string[])[0]])).toEqual([
      ['CollectionBlock', 'call', 'call-page'],
      ['TaskBlock', '', 'mine'],
      ['Proposal', '', 'task-page'],
    ]);
  });

  it('takes a view as the body of a route, without the template’s bookkeeping', () => {
    const [first] = recordViewCandidates(undefined, views);
    expect(first.node).not.toHaveProperty('meta');
    expect(first.node).not.toHaveProperty('id');
  });
});

describe('the record page', () => {
  it('is the generic page when nothing else can draw a record', () => {
    expect(recordRouteBody(generic, [])).toBe(generic);
  });

  it('chooses by the entity in the path, and the kind in the address, before falling back', () => {
    const body = recordRouteBody(generic, [
      { entity: 'CollectionBlock', kind: 'call', node: { type: 'Column', children: ['call'] } },
      { entity: 'TaskBlock', node: { type: 'Column', children: ['task'] } },
    ]);
    expect(body).toMatchObject({
      type: '$if',
      props: {
        condition: { $: "last(routeStore.segments) == 'CollectionBlock' && routeStore.params.kind == 'call'" },
        then: { children: ['call'] },
        else: {
          type: '$if',
          props: {
            condition: { $: "last(routeStore.segments) == 'TaskBlock'" },
            then: { children: ['task'] },
            else: generic,
          },
        },
      },
    });
  });
});
