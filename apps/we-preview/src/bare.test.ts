import { describe, expect, it } from 'vitest';

import { bareNode, type ExternalTemplate } from './bare';

const template: ExternalTemplate = {
  id: 'mock',
  schemaVersion: 1,
  meta: { name: 'Mock' },
  type: 'Column',
  props: { bg: 'page' },
  routes: [
    { path: '/', type: 'we-text', children: ['Home'] },
    { path: '/settings', type: 'we-text', children: ['Settings'] },
  ],
  children: [
    { type: 'Row', children: [{ type: 'we-text', children: ['Header'] }] },
    { type: 'Column', children: [{ type: 'we-tabs' }, { type: '$routes' }] },
  ],
};

const outlet = (node: unknown) => ((node as ExternalTemplate).children![1] as ExternalTemplate).children![1];

describe('a template rendered alone', () => {
  it('puts the route asked for where the outlet was, however deep', () => {
    const { node, path } = bareNode(template, '/settings');
    expect(path).toBe('/settings');
    expect(outlet(node)).toEqual({ path: '/settings', type: 'we-text', children: ['Settings'] });
  });

  it('renders / when no route is asked for', () => {
    expect(bareNode(template, null).path).toBe('/');
  });

  it('falls back to the first route, and says so, when the one asked for does not exist', () => {
    const { node, path } = bareNode(template, '/missing');
    expect(path).toBe('/');
    expect(outlet(node)).toMatchObject({ path: '/' });
  });

  it('drops what only the shell reads, and keeps the root itself', () => {
    const { node } = bareNode(template, null);
    expect(node).not.toHaveProperty('routes');
    expect(node).not.toHaveProperty('meta');
    expect(node).not.toHaveProperty('id');
    expect(node).toMatchObject({ type: 'Column', props: { bg: 'page' } });
  });

  it('renders a template with no routes as it is', () => {
    const { node, path } = bareNode({ type: 'Column', children: ['Hi'] }, null);
    expect(node).toEqual({ type: 'Column', children: ['Hi'] });
    expect(path).toBeUndefined();
  });
});
