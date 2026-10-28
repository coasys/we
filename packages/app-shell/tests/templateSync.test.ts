/**
 * Which template records a push says changed, and what a change to the one on screen does.
 *
 * The parts of live template sync that decide something. The watching and applying are in
 * TemplateStore; what a push looks like from each backend is pinned in templateWatch.test.ts.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { remoteUpdateFor, sameTemplateContent, templateChanges } from '../src/shared/templateSync';

const row = (id: string, version: number, updatedAt = version * 10) => ({ id, version, updatedAt });

describe('a push of the templates', () => {
  it('only sets the baseline the first time', () => {
    const { next, changed, removed } = templateChanges(undefined, [row('a', 1), row('b', 2)], new Map());
    expect(next.size).toBe(2);
    expect({ changed, removed }).toEqual({ changed: [], removed: [] });
  });

  it('reports a record whose version or time moved, and nothing that stayed put', () => {
    const { next } = templateChanges(undefined, [row('a', 1), row('b', 2)], new Map());
    const { changed } = templateChanges(next, [row('a', 2), row('b', 2)], new Map());
    expect(changed).toEqual(['a']);
  });

  it('reports a record that arrived, and one that went', () => {
    const { next } = templateChanges(undefined, [row('a', 1)], new Map());
    expect(templateChanges(next, [row('a', 1), row('b', 1)], new Map()).changed).toEqual(['b']);
    expect(templateChanges(next, [], new Map()).removed).toEqual(['a']);
  });

  it('says nothing for a push that only repeats the last one, as a backend may on any write', () => {
    const { next } = templateChanges(undefined, [row('a', 1)], new Map());
    expect(templateChanges(next, [row('a', 1)], new Map()).changed).toEqual([]);
  });

  it("does not report this agent's own save coming back, once, and then reports the next change", () => {
    const own = new Map([['a', '2']]);
    const { next } = templateChanges(undefined, [row('a', 1)], own);
    const echo = templateChanges(next, [row('a', 2)], own);
    expect(echo.changed).toEqual([]);
    expect(own.has('a')).toBe(false);
    expect(templateChanges(echo.next, [row('a', 3)], own).changed).toEqual(['a']);
  });
});

describe('a change to the template on screen', () => {
  const me = 'did:me';

  it('applies this agent’s own change from somewhere else', () => {
    expect(remoteUpdateFor({ author: me, me, editing: false, followOthers: false })).toBe('apply');
  });

  it('offers somebody else’s, unless this agent follows others’ changes', () => {
    expect(remoteUpdateFor({ author: 'did:ana', me, editing: false, followOthers: false })).toBe('offer');
    expect(remoteUpdateFor({ author: 'did:ana', me, editing: false, followOthers: true })).toBe('apply');
  });

  it('applies anything to a template being edited here, whoever saved it', () => {
    expect(remoteUpdateFor({ author: 'did:ana', me, editing: true, followOthers: false })).toBe('apply-editing');
  });

  it('treats a save with no recorded author as somebody else’s', () => {
    expect(remoteUpdateFor({ author: undefined, me, editing: false, followOthers: false })).toBe('offer');
  });
});

describe('whether a save changed the design', () => {
  const template = { type: 'Column', meta: { name: 'Timeline' }, children: ['Hello'] } as unknown as TemplateSchema;
  const stamped = (t: TemplateSchema, more: object) => ({ ...t, ...more }) as TemplateSchema;

  it('sets aside what saving stamps on', () => {
    const saved = stamped(template, { templateVersion: 4, author: 'did:key:me', _fromSpace: true });
    expect(sameTemplateContent(saved, template)).toBe(true);
  });

  it('notices a change to the design itself', () => {
    const edited = stamped(template, { children: ['Hello, world'], templateVersion: 4 });
    expect(sameTemplateContent(edited, template)).toBe(false);
  });
});
