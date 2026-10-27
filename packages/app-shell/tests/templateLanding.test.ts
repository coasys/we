/**
 * Where the address goes when the template on screen changes. See `landsOnRoot` and the effect in
 * `TemplateProvider` that applies it.
 */
import type { RouteSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { landsOnRoot } from '../src/shared/templateLanding';

const route = (path: string) => ({ path, type: 'Column' }) as RouteSchema;
const TRELLO = [route('/'), route('/board'), route('*')];
const SECTIONS = [{ path: '$views', type: 'Column' } as unknown as RouteSchema];
const at = (path: string) => {
  const segments = path.split('/').filter(Boolean);
  return { segments, templateSegments: segments.slice(2) };
};

describe('a template that changes', () => {
  it('lands on its root from an address it does not have', () => {
    expect(landsOnRoot({ previous: 'discord', current: 'trello', routes: TRELLO, ...at('/space/x/channel') })).toBe(
      true,
    );
  });

  it('keeps an address that is one of its pages', () => {
    expect(landsOnRoot({ previous: 'trello', current: 'my-trello', routes: TRELLO, ...at('/space/x/board') })).toBe(
      false,
    );
    expect(landsOnRoot({ previous: 'discord', current: 'trello', routes: TRELLO, ...at('/space/x') })).toBe(false);
  });
});

describe('what is left alone', () => {
  it('an address somebody arrived at, before any change', () => {
    expect(landsOnRoot({ previous: undefined, current: 'trello', routes: TRELLO, ...at('/space/x/channel') })).toBe(
      false,
    );
    expect(landsOnRoot({ previous: 'trello', current: 'trello', routes: TRELLO, ...at('/space/x/channel') })).toBe(
      false,
    );
  });

  it('a template hosting the space’s sections, and anything outside a space', () => {
    expect(landsOnRoot({ previous: 'a', current: 'b', routes: SECTIONS, ...at('/space/x/nowhere') })).toBe(false);
    expect(landsOnRoot({ previous: 'a', current: 'b', routes: TRELLO, ...at('/settings') })).toBe(false);
  });
});
