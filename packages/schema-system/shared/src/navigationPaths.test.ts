/**
 * The rule every relative path a template writes is resolved by. See `navigationPaths.ts`.
 *
 * The address throughout is a board page of a space template: `/space/abc` is the template's root
 * (two segments), and the board route spans three.
 */
import { describe, expect, it } from 'vitest';

import { isRelativePath, resolvePath } from './navigationPaths';

const ON_BOARD = '/space/abc/board?id=ad4m://obj/x';
const IN_ROUTE = { depth: 3, root: 2 };
const IN_CHROME = { depth: 2, root: 2 };

describe('a path relative to the route the node is in', () => {
  it('is the route itself for . and for nothing', () => {
    expect(resolvePath('.', ON_BOARD, IN_ROUTE)).toBe('/space/abc/board');
    expect(resolvePath('', ON_BOARD, IN_ROUTE)).toBe('/space/abc/board');
  });

  it('goes up with .., and below with ./', () => {
    expect(resolvePath('..', ON_BOARD, IN_ROUTE)).toBe('/space/abc');
    expect(resolvePath('../wall', ON_BOARD, IN_ROUTE)).toBe('/space/abc/wall');
    expect(resolvePath('./cards', ON_BOARD, IN_ROUTE)).toBe('/space/abc/board/cards');
    expect(resolvePath('cards', ON_BOARD, IN_ROUTE)).toBe('/space/abc/board/cards');
  });

  it('never climbs above the template’s root', () => {
    expect(resolvePath('../../..', ON_BOARD, IN_ROUTE)).toBe('/space/abc');
    expect(resolvePath('../../../settings', ON_BOARD, IN_ROUTE)).toBe('/space/abc/settings');
  });

  it('counts chrome as the template’s root', () => {
    expect(resolvePath('./board', ON_BOARD, IN_CHROME)).toBe('/space/abc/board');
    expect(resolvePath('.', ON_BOARD, IN_CHROME)).toBe('/space/abc');
  });
});

describe('a path from the template’s root', () => {
  it('means the same thing in a route and in chrome', () => {
    for (const base of [IN_ROUTE, IN_CHROME]) {
      expect(resolvePath('~/', ON_BOARD, base)).toBe('/space/abc');
      expect(resolvePath('~', ON_BOARD, base)).toBe('/space/abc');
      expect(resolvePath('~/wall', ON_BOARD, base)).toBe('/space/abc/wall');
    }
  });
});

describe('what comes after the path', () => {
  it('keeps a query and a fragment', () => {
    expect(resolvePath('~/board?id=ad4m://obj/y#top', ON_BOARD, IN_ROUTE)).toBe('/space/abc/board?id=ad4m://obj/y#top');
  });

  it('puts a query alone on the page on screen', () => {
    expect(resolvePath('?sort=new', ON_BOARD, IN_ROUTE)).toBe('/space/abc/board?sort=new');
  });
});

describe('a path that is not relative', () => {
  it('is left as written', () => {
    expect(resolvePath('/settings/ai', ON_BOARD, IN_ROUTE)).toBe('/settings/ai');
    expect(resolvePath('https://example.org/x', ON_BOARD, IN_ROUTE)).toBe('https://example.org/x');
    expect(resolvePath('mailto:a@example.org', ON_BOARD, IN_ROUTE)).toBe('mailto:a@example.org');
    expect(isRelativePath('#top')).toBe(false);
    expect(isRelativePath('~/x')).toBe(true);
  });
});

describe('a base the address does not reach', () => {
  it('is clamped to the address, so an outer page still resolves', () => {
    expect(resolvePath('./x', '/space/abc', IN_ROUTE)).toBe('/space/abc/x');
    expect(resolvePath('./x', '/', { depth: 0, root: 0 })).toBe('/x');
  });
});
