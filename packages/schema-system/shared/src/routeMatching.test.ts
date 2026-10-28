import { describe, expect, it } from 'vitest';

import { isTemplatePage } from './routeMatching';
import type { RouteSchema } from './types';

const route = (path: string, extra: Partial<RouteSchema> = {}) => ({ path, type: 'Column', ...extra }) as RouteSchema;

const BOARDS = [route('/'), route('/board'), route('*')];
const WORKSHOP = [
  route('/', { redirect: './canvas' }),
  route('/canvas', { routes: [route('/'), route('/:card')] }),
  route('/calendar', { keepAlive: true }),
];

describe('an address the template declares', () => {
  it('is one of its pages', () => {
    expect(isTemplatePage(BOARDS, [])).toBe(true);
    expect(isTemplatePage(BOARDS, ['board'])).toBe(true);
    expect(isTemplatePage(WORKSHOP, ['calendar'])).toBe(true);
  });

  it('counts a redirect, and a parameter, and a page inside a layout route', () => {
    expect(isTemplatePage(WORKSHOP, [])).toBe(true);
    expect(isTemplatePage(WORKSHOP, ['canvas'])).toBe(true);
    expect(isTemplatePage(WORKSHOP, ['canvas', 'abc'])).toBe(true);
  });
});

describe('an address the template does not declare', () => {
  it('is not one of its pages, though a catch-all would render it', () => {
    expect(isTemplatePage(BOARDS, ['channel'])).toBe(false);
    expect(isTemplatePage(BOARDS, ['board', 'extra'])).toBe(false);
    expect(isTemplatePage(WORKSHOP, ['canvas', 'a', 'b'])).toBe(false);
  });
});
