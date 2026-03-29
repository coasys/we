import type { TemplateSchema } from '@we/schema-shared';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';

import { updateSchema } from '../src/schemaUpdater';

const baseMeta = { name: 'Test', description: '', icon: '' };

function makeTemplate(overrides: Partial<TemplateSchema> = {}): TemplateSchema {
  return { meta: baseMeta, type: 'div', children: [], ...overrides };
}

describe('updateSchema', () => {
  it('applies prop change to Solid store', () => {
    createRoot((dispose) => {
      const initial = makeTemplate({ props: { label: 'old' } });
      const [store, setStore] = createStore<TemplateSchema>(initial);
      const updated = makeTemplate({ props: { label: 'new' } });
      updateSchema(store, updated, setStore);
      expect(store.props?.label).toBe('new');
      dispose();
    });
  });

  it('adds a child node', () => {
    createRoot((dispose) => {
      const initial = makeTemplate({ children: [] });
      const [store, setStore] = createStore<TemplateSchema>(initial);
      const updated = makeTemplate({ children: [{ type: 'span' }] });
      updateSchema(store, updated, setStore);
      expect(store.children?.length).toBe(1);
      expect((store.children![0] as any).type).toBe('span');
      dispose();
    });
  });

  it('removes a child node', () => {
    createRoot((dispose) => {
      const initial = makeTemplate({ children: [{ type: 'span' }, { type: 'div' }] });
      const [store, setStore] = createStore<TemplateSchema>(initial);
      const updated = makeTemplate({ children: [{ type: 'div' }] });
      updateSchema(store, updated, setStore);
      // After update, first child should now be div
      expect((store.children![0] as any).type).toBe('div');
      dispose();
    });
  });

  it('rejects invalid schema with console.error', () => {
    createRoot((dispose) => {
      const initial = makeTemplate();
      const [store, setStore] = createStore<TemplateSchema>(initial);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Missing meta — invalid schema
      const invalid = { type: 'div', children: [] } as unknown as TemplateSchema;
      updateSchema(store, invalid, setStore);
      expect(errorSpy).toHaveBeenCalledWith('Invalid schema node:', expect.anything());
      errorSpy.mockRestore();
      dispose();
    });
  });

  it('does nothing when schemas are identical', () => {
    createRoot((dispose) => {
      const initial = makeTemplate({ props: { label: 'same' } });
      const [store, setStore] = createStore<TemplateSchema>(initial);
      // Note: updateSchema uses the real setStore, so this tests by verifying store is unchanged
      updateSchema(store, makeTemplate({ props: { label: 'same' } }), setStore);
      // Store should be unchanged
      expect(store.props?.label).toBe('same');
      dispose();
    });
  });

  it('handles large mutation batches via produce', () => {
    createRoot((dispose) => {
      const initial = makeTemplate({
        props: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6', g: '7', h: '8', i: '9', j: '10', k: '11' },
      });
      const [store, setStore] = createStore<TemplateSchema>(initial);
      const updated = makeTemplate({
        props: { a: 'x', b: 'x', c: 'x', d: 'x', e: 'x', f: 'x', g: 'x', h: 'x', i: 'x', j: 'x', k: 'x' },
      });
      updateSchema(store, updated, setStore);
      expect(store.props?.a).toBe('x');
      expect(store.props?.k).toBe('x');
      dispose();
    });
  });
});
