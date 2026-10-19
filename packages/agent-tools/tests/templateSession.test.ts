/**
 * The rules for what a model's edit may do to a template, one batch at a time.
 *
 * `runEditSession` and the toolset both run on this, so each way a batch can be refused is pinned
 * here once: input that is not a list of patches, a patch that cannot apply, a tree that is not a
 * template, and a tree that names things that do not exist. Whatever refuses it, a refused batch
 * leaves the template as it was.
 */
import type { SchemaNode } from '@we/schema-shared';
import { buildValidationContext, contextData } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { createTemplateSession, type PatchCall } from '../src/templates/templateSession';

const validationContext = buildValidationContext(contextData);

const starter = (): SchemaNode =>
  ({
    type: 'Column',
    meta: { name: 'Test', description: '', icon: 'cube' },
    props: { bg: 'page' },
    children: [{ type: 'we-text', children: ['Hello'] }],
  }) as unknown as SchemaNode;

const call = (id: string, patches: unknown): PatchCall => ({ id, arguments: { patches } });
const insert = (node: unknown) => ({ targetId: '', insert: { children: { node } } });
const words = (schema: SchemaNode) => (schema.children as SchemaNode[]).map((c) => c.children?.[0]);

describe('a template session', () => {
  it('keeps a batch that validates only once it is committed', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    const batch = session.apply([call('c1', [insert({ type: 'we-text', children: ['World'] })])]);

    expect(batch.refused).toBeUndefined();
    expect(batch.candidate && words(batch.candidate)).toEqual(['Hello', 'World']);
    expect(words(session.current())).toEqual(['Hello']);

    batch.commit();
    expect(words(session.current())).toEqual(['Hello', 'World']);
  });

  it('tells the model what became of the template ahead of what its patches did', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    const batch = session.apply([call('c1', [insert({ type: 'we-text', children: ['World'] })])]);
    batch.commit();
    batch.acknowledge('Kept.');

    expect(batch.results).toEqual([{ callId: 'c1', content: 'Kept.', note: '' }]);
  });

  it('refuses input that is not a list of patches, without judging the rest', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    const batch = session.apply([{ id: 'c1', arguments: {} }]);

    expect(batch.refused).toBe('apply');
    expect(batch.results[0]).toMatchObject({ isError: true, failed: 'input' });
    expect(() => batch.commit()).toThrow();
  });

  it('refuses a patch that names a node the template does not have', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    const batch = session.apply([call('c1', [{ targetId: 'nowhere', node: { props: { gap: '300' } } }])]);

    expect(batch.refused).toBe('apply');
    expect(batch.results[0]).toMatchObject({ isError: true, failed: 'apply' });
    expect(batch.results[0].content).toMatch(/^Patching failed/);
  });

  it('refuses a tree that is not a template', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    const batch = session.apply([call('c1', [insert({ type: 'we-text', children: [null] })])]);

    expect(batch.refused).toBe('structure');
    expect(batch.results[0].content).toMatch(/^Structural validation failed/);
  });

  it('refuses a tree naming a component that does not exist, and counts only what the batch introduced', () => {
    const imperfect = starter();
    (imperfect.children as SchemaNode[]).push({ type: 'we-already-broken' } as SchemaNode);
    const session = createTemplateSession({ schema: imperfect, validationContext });

    const fine = session.apply([call('c1', [insert({ type: 'we-text', children: ['World'] })])]);
    expect(fine.refused).toBeUndefined();

    const broken = session.apply([call('c2', [insert({ type: 'we-nonexistent' })])]);
    expect(broken.refused).toBe('semantic');
    expect(broken.results[0].content).toMatch(/^Semantic validation failed \(1 issues\)/);
    expect(broken.results[0].content).toContain('we-nonexistent');
  });

  it('refuses a batch whole when one call in it fails, leaving the template as it was', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    const batch = session.apply([
      call('c1', [insert({ type: 'we-text', children: ['World'] })]),
      call('c2', [{ targetId: 'nowhere', node: {} }]),
    ]);

    expect(batch.refused).toBe('apply');
    expect(batch.candidate).toBeUndefined();
    expect(words(session.current())).toEqual(['Hello']);
  });

  it('patches the committed template, not the one it started from', () => {
    const session = createTemplateSession({ schema: starter(), validationContext });
    session.apply([call('c1', [insert({ type: 'we-text', children: ['One'] })])]).commit();
    session.apply([call('c2', [insert({ type: 'we-text', children: ['Two'] })])]).commit();

    expect(words(session.current())).toEqual(['Hello', 'One', 'Two']);
  });
});
