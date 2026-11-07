/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `$each` over a store's list keeps a row while it is the same record.
 *
 * A store that derives a list (`createMemo(() => rows.map(...))`) builds new objects every time
 * anything in it changes. `<For>` keys by reference, so every row was destroyed and built again:
 * the DOM under it, its `$localState`, and the scroll position of a page made of such rows. Pressing
 * one switch on a settings screen threw the page. Query results never had this, because the query
 * branch keeps its rows in a store reconciled by `id`; this is the same for a store's list.
 *
 * These are about identity, which no look at a render will tell you: the replacement looks the same.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const registry: ComponentRegistry = {
  Box: (props: any) => <div data-testid={props.testid}>{props.children}</div>,
  Press: (props: any) => <button data-testid={props.testid} onClick={() => props.onClick?.()} />,
};

interface Row {
  id: string;
  label: string;
  on: boolean;
}

/** A store whose list is rebuilt as new objects on every change, as a memo over records is. */
function listStore(initial: Row[]) {
  const [rows, setRows] = createSignal(initial);
  return {
    // A getter, as a store reaches a template: the host reads its accessors through getters.
    store: {
      get rows() {
        return rows().map((row) => ({ ...row }));
      },
    },
    set: (id: string, patch: Partial<Row>) =>
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row))),
    replace: (next: Row[]) => setRows(next),
  };
}

/** One row: its label, its state, and a local field only the row's own mount holds. */
const rowNode: SchemaNode = {
  type: 'Box',
  props: { testid: { $: '`row-${row.id}`' } },
  $localState: { touched: { type: 'boolean', initial: false } },
  children: [
    { $: 'row.label' },
    ':',
    { $: "row.on ? 'on' : 'off'" },
    ':',
    { $: "local.touched ? 'touched' : 'fresh'" },
    { type: 'Press', props: { testid: { $: '`touch-${row.id}`' }, onClick: { $setLocal: 'touched', value: true } } },
  ],
};

function mount(rows: Row[]) {
  const list = listStore(rows);
  const view = render(() => (
    <RenderSchema
      node={{
        type: 'Box',
        children: [{ type: '$each', props: { items: { $: 'listStore.rows' }, as: 'row' }, children: [rowNode] }],
      }}
      stores={{ listStore: list.store } as any}
      registry={registry}
    />
  ));
  const row = (id: string) => view.container.querySelector(`[data-testid="row-${id}"]`) as HTMLElement | null;
  return { ...view, ...list, row };
}

const ROWS: Row[] = [
  { id: 'a', label: 'Alpha', on: true },
  { id: 'b', label: 'Beta', on: false },
  { id: 'c', label: 'Gamma', on: true },
];

describe('a store list with ids', () => {
  it('keeps every row’s DOM when one row changes, and shows the change', () => {
    const view = mount(ROWS);
    const [a, b, c] = ['a', 'b', 'c'].map(view.row);

    view.set('b', { on: true });

    expect(view.row('b')?.textContent).toBe('Beta:on:fresh');
    expect(view.row('a')).toBe(a);
    expect(view.row('b')).toBe(b);
    expect(view.row('c')).toBe(c);
  });

  it('keeps a row’s local state when the row changes', () => {
    const view = mount(ROWS);
    // Set the row's local field through its own mount: the press a person would make.
    (view.container.querySelector('[data-testid="touch-b"]') as HTMLButtonElement).click();
    expect(view.row('b')?.textContent).toBe('Beta:off:touched');
    view.set('b', { label: 'Beta 2' });
    expect(view.row('b')?.textContent).toBe('Beta 2:off:touched');
  });

  it('draws a moved row again, so the row before it is the right one', () => {
    const view = mount(ROWS);
    const c = view.row('c');
    // Gamma moves to the top: every row's place changed, so each is drawn again with a fresh `prev`.
    view.replace([ROWS[2], ROWS[0], ROWS[1]]);
    expect(view.container.textContent).toBe('Gamma:on:freshAlpha:on:freshBeta:off:fresh');
    expect(view.row('c')).not.toBe(c);
  });

  it('keeps the rows that did not move when one is removed from the end', () => {
    const view = mount(ROWS);
    const [a, b] = ['a', 'b'].map(view.row);
    view.replace([ROWS[0], ROWS[1]]);
    expect(view.row('c')).toBeNull();
    expect(view.row('a')).toBe(a);
    expect(view.row('b')).toBe(b);
  });

  it('never writes into the store’s own objects', () => {
    const ada = { name: 'Ada' };
    const bo = { name: 'Bo' };
    const [rows, setRows] = createSignal([{ id: 'm1', author: ada }]);
    const view = render(() => (
      <RenderSchema
        node={{
          type: 'Box',
          children: [
            {
              type: '$each',
              props: { items: { $: 'feed.rows' }, as: 'row' },
              children: [{ type: 'Box', children: [{ $: 'row.author.name' }] }],
            },
          ],
        }}
        stores={
          {
            feed: {
              get rows() {
                return rows();
              },
            },
          } as any
        }
        registry={registry}
      />
    ));
    // The line's author changes from one cached profile to another.
    setRows([{ id: 'm1', author: bo }]);
    expect(view.container.textContent).toBe('Bo');
    expect(ada.name).toBe('Ada');
  });
});

describe('a list that is not kept by id', () => {
  const each: SchemaNode = {
    type: 'Box',
    children: [
      {
        type: '$each',
        props: { items: { $: 'list.items' }, as: 'row' },
        children: [{ type: 'Box', children: [{ $: 'row.label ?? row' }] }],
      },
    ],
  };
  const mountList = (initial: unknown[]) => {
    const [items, setItems] = createSignal(initial);
    const view = render(() => (
      <RenderSchema
        node={each}
        stores={
          {
            list: {
              get items() {
                return items();
              },
            },
          } as any
        }
        registry={registry}
      />
    ));
    return { ...view, setItems };
  };

  it('draws rows without ids as before, following each change', () => {
    const view = mountList([{ label: 'one' }, { label: 'two' }]);
    view.setItems([{ label: 'one' }, { label: 'three' }]);
    expect(view.container.textContent).toBe('onethree');
  });

  it('draws rows with a shared id by reference rather than merging them', () => {
    const view = mountList([
      { id: 'x', label: 'first' },
      { id: 'x', label: 'second' },
    ]);
    expect(view.container.textContent).toBe('firstsecond');
  });

  it('leaves a class instance whole, getters and all', () => {
    class Model {
      constructor(private readonly key: string) {}
      get id() {
        return this.key;
      }
      get label() {
        return `model ${this.key}`;
      }
    }
    const view = mountList([new Model('a'), new Model('b')]);
    expect(view.container.textContent).toBe('model amodel b');
  });

  it('draws plain values', () => {
    const view = mountList(['x', 'y']);
    view.setItems(['x', 'z']);
    expect(view.container.textContent).toBe('xz');
  });
});
