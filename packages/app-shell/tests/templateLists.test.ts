/**
 * Reading the agent's library must not drop the space's templates.
 *
 * On a reload into a space the space's templates were read first and the library second, and the
 * library replaced the whole list: a space whose sections were copies lost every one of them, and
 * showed the built-in it had replaced, switched off.
 */
import { withLibrary, withLibraryListed } from '@shared/templateLists';
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const template = (id: string, fromSpace = false): TemplateSchema =>
  ({
    id,
    type: 'Column',
    meta: { name: id, description: '', icon: '' },
    ...(fromSpace ? { _fromSpace: true } : {}),
  }) as TemplateSchema;

describe('reading the library beside a space', () => {
  it('keeps the space’s templates that were already loaded', () => {
    const before = [template('default'), template('about-copy', true), template('space-shell', true)];
    const after = withLibrary(before, [template('default'), template('mine')]);
    expect(after.map((t) => t.id)).toEqual(['default', 'mine', 'about-copy', 'space-shell']);
  });

  it('replaces the library itself, so a template removed from it goes', () => {
    const after = withLibrary([template('old-mine'), template('default')], [template('default')]);
    expect(after.map((t) => t.id)).toEqual(['default']);
  });

  it('keeps an agent’s template and a space’s sharing an id apart', () => {
    const after = withLibrary([template('shared-id', true)], [template('shared-id')]);
    expect(after.map((t) => [t.id, !!t._fromSpace])).toEqual([
      ['shared-id', false],
      ['shared-id', true],
    ]);
  });
});

describe('which library templates are listed', () => {
  const library: [string, string][] = [
    ['mine', 'record-mine'],
    ['from-an-agent', 'record-agent'],
    ['put-away', 'record-away'],
  ];
  const hidden = (recordId: string) => recordId === 'record-away';

  it('lists every library template the agent has not hidden, however it was written', () => {
    const listed = withLibraryListed(new Set(), library, hidden, () => false);
    expect([...listed]).toEqual(['mine', 'from-an-agent']);
  });

  it('takes a template out once it is hidden, and leaves the space’s templates alone', () => {
    const listed = withLibraryListed(new Set(['put-away', 'space-shell']), library, hidden, () => false);
    expect([...listed].sort()).toEqual(['from-an-agent', 'mine', 'space-shell']);
  });

  it('keeps a space template that shares its id with a hidden library one', () => {
    const listed = withLibraryListed(new Set(['put-away']), library, hidden, (id) => id === 'put-away');
    expect(listed.has('put-away')).toBe(true);
  });
});
