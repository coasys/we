/**
 * Every control in the executor's config rows says what it sets.
 *
 * The key beside each control is text, not a label, so a screen reader announced a bare "combobox"
 * or "edit text" with nothing to say which key it changes. `we-select` and `we-input` render their
 * `label` as `aria-label` on the control itself.
 */
import { executorSettings } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

/** Every node in a tree that satisfies `test`, wherever it sits. */
function findAll(node: unknown, test: (record: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((item) => findAll(item, test));
  if (!node || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  return [...(test(record) ? [record] : []), ...Object.values(record).flatMap((value) => findAll(value, test))];
}

describe('the executor config rows', () => {
  const controls = findAll(
    executorSettings,
    (r) =>
      (r.type === 'we-select' || r.type === 'we-input') &&
      JSON.stringify(r.props ?? null).includes('runtimeStore.setExecutorConfigValue'),
  );

  it('name each control by the key it sets', () => {
    expect(controls.map((control) => control.type).sort()).toEqual(['we-input', 'we-select']);
    for (const control of controls) {
      expect((control.props as { label?: unknown }).label).toEqual({ $: 'row.key' });
    }
  });
});
