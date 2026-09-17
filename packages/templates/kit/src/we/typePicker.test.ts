import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { typePickerLists } from './typePicker.ts';

/**
 * The picker's sections and search, checked by running the expressions — they are strings, and a
 * filter that answers the wrong list parses just as well as one that answers the right one.
 */
const run = (source: string, roots: Record<string, unknown>) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) => ({ bound: name in roots, value: roots[name] }),
    call: (name: string, args: unknown[]) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, {} as never),
  } as never);

const kinds = [
  { value: 'Sighting', label: 'Sighting', group: 'This space', via: 'form', description: 'A thing somebody saw' },
  { value: 'CollectionBlock', label: 'Collection', group: 'Built in', via: 'composer', description: 'A document' },
  { value: 'ImageBlock', label: 'Image', group: 'Built in', via: 'form', description: 'A picture, uploaded' },
  { value: 'EventBlock', label: 'Event', group: 'Built in', via: 'form', description: 'Something happening' },
  { value: 'TaskBlock', label: 'Task', group: 'Built in', via: 'form', description: 'Something to do' },
];

const lists = typePickerLists({ lead: ['TaskBlock', 'EventBlock'], composedLabel: 'Note (block collection)' });
const values = (source: string, search = '') =>
  (
    run(source, { recordStore: { creatableEntities: kinds }, local: { typeSearch: search } }) as { value: string }[]
  ).map((kind) => kind.value);

describe('typePicker', () => {
  it('puts each kind in its section: the composed one, this space’s, then blocks led as asked', () => {
    expect(values(lists.composed)).toEqual(['CollectionBlock']);
    expect(values(lists.own)).toEqual(['Sighting']);
    expect(values(lists.builtIn)).toEqual(['TaskBlock', 'EventBlock', 'ImageBlock']);
  });

  it('draws them in that order, which is what Enter takes the first of', () => {
    expect(values(lists.drawnOrder)).toEqual(['CollectionBlock', 'Sighting', 'TaskBlock', 'EventBlock', 'ImageBlock']);
  });

  it('searches names and descriptions, ignoring case, and the name a composed kind is shown by', () => {
    expect(values(lists.drawnOrder, 'PICT')).toEqual(['ImageBlock']);
    expect(values(lists.drawnOrder, 'note')).toEqual(['CollectionBlock']);
    expect(values(lists.builtIn, 'something')).toEqual(['TaskBlock', 'EventBlock']);
    expect(values(lists.matches, 'nothing like this')).toEqual([]);
  });
});
