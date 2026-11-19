import type { ResolvedView, RouteSchema, TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { pageOfPart } from '../src/shared/partPage';
import { seedBundles } from '../src/shared/registries/seedBundles.generated';

/**
 * The page of a space that draws a module's part — where a module asking to show that part is sent.
 *
 * Pinned because a wrong answer is silent both ways: no page found opens the module's window over a
 * space that already has the thing as a page, and a wrong page found navigates somewhere that does not
 * draw it.
 */
const FEED = 'feed.feedView';
const feedPart = { type: '$part', props: { id: FEED } };

const template = (routes: RouteSchema[], extra: Partial<TemplateSchema> = {}): TemplateSchema => ({
  meta: { name: 't', description: '', icon: 'x' },
  type: 'Column',
  routes,
  ...extra,
});

const view = (id: string, segment: string, children: unknown[] = []): ResolvedView => ({
  id,
  segment,
  schema: { meta: { name: id, description: '', icon: 'x', role: 'view' }, type: 'Column', children } as TemplateSchema,
});

describe('the page that draws a part', () => {
  it('is the space itself when the template draws the part at its index', () => {
    expect(pageOfPart(template([{ path: '/', type: 'Column', children: [feedPart] }]), [], FEED)).toBe('');
  });

  it('is the route that draws it, below the space', () => {
    const routes: RouteSchema[] = [
      { path: '/', type: 'Column', children: ['home'] },
      { path: '/talk', type: 'Column', children: [{ type: 'Row', children: [feedPart] }] },
    ];
    expect(pageOfPart(template(routes), [], FEED)).toBe('talk');
  });

  it('finds a part behind a condition, as the page draws it there', () => {
    const routes: RouteSchema[] = [
      { path: '/', type: '$if', props: { condition: { $: 'x' }, then: feedPart, else: { type: 'Column' } } },
    ];
    expect(pageOfPart(template(routes), [], FEED)).toBe('');
  });

  it('follows a shape the template says once', () => {
    const routes: RouteSchema[] = [{ path: '/feed', type: '$ref', props: { def: 'd1' } }];
    expect(pageOfPart(template(routes, { $defs: { d1: { type: 'Column', children: [feedPart] } } }), [], FEED)).toBe(
      'feed',
    );
  });

  it('joins the paths of nested routes', () => {
    const routes: RouteSchema[] = [
      { path: '/talk', type: 'Column', routes: [{ path: '/live', type: 'Column', children: [feedPart] }] },
    ];
    expect(pageOfPart(template(routes), [], FEED)).toBe('talk/live');
  });

  it('is the section that draws it, in a template whose sections the space chooses', () => {
    const routes: RouteSchema[] = [{ path: '/space/:spaceId', type: 'Column', routes: [{ path: '$views' }] }];
    const views = [view('cards', 'cards'), view('chat', 'chat', [feedPart])];
    expect(pageOfPart(template(routes), views, FEED)).toBe('chat');
  });

  it('is no section the space does not have', () => {
    const routes: RouteSchema[] = [{ path: '/space/:spaceId', type: 'Column', routes: [{ path: '$views' }] }];
    expect(pageOfPart(template(routes), [view('cards', 'cards')], FEED)).toBeNull();
  });

  it('is no page where nothing draws the part, so the module shows it its own way', () => {
    expect(pageOfPart(template([{ path: '/', type: 'Column', children: ['home'] }]), [], FEED)).toBeNull();
    expect(pageOfPart(undefined, [], FEED)).toBeNull();
  });

  it('is no page that cannot be reached without a value nobody gave it', () => {
    // A parameter or a catch-all names no one address; a redirect draws nothing.
    const routes: RouteSchema[] = [
      { path: '/channel/:id', type: 'Column', children: [feedPart] },
      { path: '*', type: 'Column', children: [feedPart] },
      { path: '/old', redirect: './', type: 'Column', children: [feedPart] },
    ];
    expect(pageOfPart(template(routes), [], FEED)).toBeNull();
  });

  it('is not another part of the same module', () => {
    const routes: RouteSchema[] = [
      { path: '/', type: 'Column', children: [{ type: '$part', props: { id: 'feed.callFeed' } }] },
    ];
    expect(pageOfPart(template(routes), [], FEED)).toBeNull();
  });

  it('is the Coasys space’s own Feed — its root channel, at the space itself', () => {
    // The template the bug was seen in: its Feed is the root channel, drawn at the space's index.
    const coasys = seedBundles.find((bundle) => bundle.id === 'coasys');
    const space = coasys?.templates?.find((t) => t.id === 'space') as TemplateSchema | undefined;
    expect(space).toBeDefined();
    expect(pageOfPart(space, [], FEED)).toBe('');
  });
});
