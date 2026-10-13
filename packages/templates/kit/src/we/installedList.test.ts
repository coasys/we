/**
 * A section copied into a space is placed among its sections, never applied.
 *
 * The space's template list offered "Apply" on every row, and a section is a template too: applying
 * one made it the whole screen. Its row offers the way to Space settings → Sections instead.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { installedList } from './installedList.ts';

const options = {
  entity: 'Template',
  as: 'template',
  label: 'templates',
  emptyIcon: 'layout',
  avatarIcon: 'layout',
  key: { $: 'template.slug' },
  activeStorePath: 'templateStore.currentTemplate.id',
  applyAction: 'templateStore.switchTemplate',
  defaultField: 'defaultTemplateId',
  refreshAction: 'templateStore.refreshSpaceTemplates',
};

/** Every `$if` whose `then` is a button with these words, and its condition. */
function conditionsFor(tree: unknown, words: string): string[] {
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const node = value as SchemaNode;
    const then = (node.props as { then?: SchemaNode } | undefined)?.then;
    if (node.type === '$if' && then?.children?.includes(words)) {
      out.push(String((node.props?.condition as { $?: string } | undefined)?.$ ?? ''));
    }
    Object.values(value).forEach(walk);
  };
  walk(tree);
  return out;
}

describe('the space’s template list', () => {
  it('offers neither Apply nor Set as default on a section, and the way to Sections instead', () => {
    const tree = installedList({ ...options, sectionWhen: "template.role == 'view'" });
    for (const words of ['Apply', 'Set as default']) {
      const [condition] = conditionsFor(tree, words);
      // Negated, whatever parentheses `expr` adds around what it splices in.
      expect(condition).toMatch(/!\(+template\.role == 'view'\)+/);
    }
    expect(conditionsFor(tree, 'Sections')).toEqual(["template.role == 'view'"]);
  });

  it('is unchanged for a list with no sections in it, such as themes', () => {
    const tree = installedList(options);
    expect(conditionsFor(tree, 'Apply')[0]).not.toContain('!(');
    expect(conditionsFor(tree, 'Sections')).toEqual([]);
  });
});
