/**
 * An app of one's own can be deleted, and WE's cannot.
 *
 * Apps are left out of the template list in Settings, which is the only other place a template is
 * deleted from — so before this, a fork of the app could be made and never removed.
 */
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

/** Every node in a tree that satisfies `test`, wherever it sits. */
function findAll(node: unknown, test: (record: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((item) => findAll(item, test));
  if (!node || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  return [...(test(record) ? [record] : []), ...Object.values(record).flatMap((value) => findAll(value, test))];
}

describe('deleting an app in Settings', () => {
  const deletes = findAll(
    settingsTemplate,
    (r) => r.type === 'we-button' && JSON.stringify(r.props ?? null).includes('templateStore.deleteTemplate'),
  );
  const appDelete = deletes.find((button) => JSON.stringify(button.props).includes('app.value'));

  it('offers a delete for an app, aimed at that app', () => {
    expect(appDelete).toBeDefined();
    expect((appDelete!.props as { onClick: unknown }).onClick).toEqual({
      $invoke: 'templateStore.deleteTemplate',
      args: [{ $: 'app.value' }],
    });
  });

  it('lists only the apps that are yours, never WE’s own', () => {
    const lists = findAll(
      settingsTemplate,
      (r) => r.type === '$each' && JSON.stringify(r.props).includes('templateStore.appTemplateOptions'),
    );
    expect(lists).toHaveLength(1);
    expect((lists[0].props as { items: unknown }).items).toEqual({
      $: 'templateStore.appTemplateOptions.filter(app, app.editable)',
    });
  });
});
