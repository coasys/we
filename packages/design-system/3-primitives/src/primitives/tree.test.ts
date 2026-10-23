/**
 * `we-tree` and `we-tree-item`: one root, rows nesting to any depth, and the keyboard over all of
 * them as one list.
 *
 * Driven in jsdom, as the other primitives' contracts are: what is under test is the decision — which
 * row the tab stop is on, where an arrow key moves it, what a press reports — not how it looks.
 */
import './tree';

import { afterEach, describe, expect, it } from 'vitest';

interface ItemEl extends HTMLElement {
  value: string;
  open: boolean;
  expandable: boolean;
  selected: boolean;
  tabStop: boolean;
  level: number;
  updateComplete: Promise<unknown>;
}
interface TreeEl extends HTMLElement {
  selected: string;
  updateComplete: Promise<unknown>;
}

/** A tree from a nested description: `[value, label, children?, open?]`. */
type Row = [string, string, Row[]?, boolean?];

function item([value, label, children = [], open = false]: Row): ItemEl {
  const el = document.createElement('we-tree-item') as ItemEl;
  el.value = value;
  el.open = open;
  el.append(label);
  for (const child of children) {
    const node = item(child);
    node.slot = 'children';
    el.appendChild(node);
  }
  return el;
}

async function makeTree(rows: Row[], selected = ''): Promise<TreeEl> {
  const tree = document.createElement('we-tree') as TreeEl;
  tree.selected = selected;
  for (const row of rows) tree.appendChild(item(row));
  document.body.appendChild(tree);
  await settle(tree);
  return tree;
}

async function settle(tree: TreeEl) {
  await tree.updateComplete;
  for (const el of tree.querySelectorAll<ItemEl>('we-tree-item')) await el.updateComplete;
  // The tree re-syncs on a mutation, which lands after a microtask.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tree.updateComplete;
  for (const el of tree.querySelectorAll<ItemEl>('we-tree-item')) await el.updateComplete;
}

const byValue = (tree: TreeEl, value: string) => tree.querySelector<ItemEl>(`we-tree-item[value="${value}"]`)!;
const rowOf = (el: ItemEl) => el.shadowRoot!.querySelector<HTMLElement>('[part="row"]')!;
const press = (el: ItemEl, key: string) =>
  rowOf(el).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
const focused = (tree: TreeEl) =>
  [...tree.querySelectorAll<ItemEl>('we-tree-item')].find((el) => el.shadowRoot!.activeElement === rowOf(el))?.value;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a tree', () => {
  const rows: Row[] = [
    [
      'root',
      'Root',
      [
        ['a', 'Alpha', [['a1', 'Alpha one']], true],
        ['b', 'Beta'],
      ],
      true,
    ],
    ['calls', 'Calls', [['c1', 'Call one']]],
    ['people', 'People'],
  ];

  it('gives exactly one row the tab stop: the selected one, else the first', async () => {
    const tree = await makeTree(rows, 'b');
    const stops = [...tree.querySelectorAll<ItemEl>('we-tree-item')].filter((el) => el.tabStop);
    expect(stops.map((el) => el.value)).toEqual(['b']);
    expect(byValue(tree, 'b').selected).toBe(true);

    const fresh = await makeTree(rows);
    expect(
      [...fresh.querySelectorAll<ItemEl>('we-tree-item')].filter((el) => el.tabStop).map((el) => el.value),
    ).toEqual(['root']);
  });

  it('indents a row by its depth and says it to a screen reader', async () => {
    const tree = await makeTree(rows);
    expect(byValue(tree, 'root').level).toBe(0);
    expect(byValue(tree, 'a1').level).toBe(2);
    expect(rowOf(byValue(tree, 'a1')).getAttribute('aria-level')).toBe('3');
    expect(tree.shadowRoot!.querySelector('[role="tree"]')).toBeTruthy();
  });

  it('walks the visible rows as one list, skipping the inside of closed ones', async () => {
    const tree = await makeTree(rows);
    rowOf(byValue(tree, 'a1')).focus();
    press(byValue(tree, 'a1'), 'ArrowDown');
    expect(focused(tree)).toBe('b');
    press(byValue(tree, 'b'), 'ArrowDown');
    expect(focused(tree)).toBe('calls');
    // Calls is closed, so its call is not a row anybody can see.
    press(byValue(tree, 'calls'), 'ArrowDown');
    expect(focused(tree)).toBe('people');
    press(byValue(tree, 'people'), 'Home');
    expect(focused(tree)).toBe('root');
    press(byValue(tree, 'root'), 'End');
    expect(focused(tree)).toBe('people');
  });

  it('asks to open on Right and close on Left, and steps in and out of open rows', async () => {
    const tree = await makeTree(rows);
    const calls = byValue(tree, 'calls');
    const asked: boolean[] = [];
    calls.addEventListener('openchange', (event) =>
      asked.push((event as unknown as CustomEvent<{ open: boolean }>).detail.open),
    );
    rowOf(calls).focus();
    press(calls, 'ArrowRight');
    expect(asked).toEqual([true]);

    // Open, Right steps in; Left from a child steps out to its parent.
    rowOf(byValue(tree, 'a')).focus();
    press(byValue(tree, 'a'), 'ArrowRight');
    expect(focused(tree)).toBe('a1');
    press(byValue(tree, 'a1'), 'ArrowLeft');
    expect(focused(tree)).toBe('a');
    const aAsked: boolean[] = [];
    byValue(tree, 'a').addEventListener('openchange', (event) =>
      aAsked.push((event as unknown as CustomEvent<{ open: boolean }>).detail.open),
    );
    press(byValue(tree, 'a'), 'ArrowLeft');
    expect(aAsked).toEqual([false]);
  });

  it('reports the row chosen by a click or by Enter, and leaves the choosing to the template', async () => {
    const tree = await makeTree(rows);
    const chosen: string[] = [];
    tree.addEventListener('select', (event) => chosen.push((event as CustomEvent<{ value: string }>).detail.value));
    rowOf(byValue(tree, 'people')).click();
    press(byValue(tree, 'b'), 'Enter');
    expect(chosen).toEqual(['people', 'b']);
    // Nothing selected itself: that is the tree's `selected`, which the template sets.
    expect(byValue(tree, 'people').selected).toBe(false);
  });

  it('leaves a press on a control in the row to the control, however deep it lands', async () => {
    const tree = await makeTree(rows);
    const chosen: string[] = [];
    tree.addEventListener('select', (event) => chosen.push((event as CustomEvent<{ value: string }>).detail.value));
    // A + at the end of a row: a button whose glyph sits in its own shadow root, as `we-button`'s does.
    const button = document.createElement('we-button');
    const glyph = document.createElement('span');
    button.attachShadow({ mode: 'open' }).appendChild(glyph);
    byValue(tree, 'people').appendChild(button);
    glyph.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(chosen).toEqual([]);
    // The rest of the row is still the row's.
    rowOf(byValue(tree, 'people')).click();
    expect(chosen).toEqual(['people']);
  });

  it('moves to the next row starting with what is typed', async () => {
    const tree = await makeTree(rows);
    rowOf(byValue(tree, 'root')).focus();
    press(byValue(tree, 'root'), 'p');
    expect(focused(tree)).toBe('people');
  });

  it('shows a caret for a row whose children load when it opens', async () => {
    const tree = await makeTree([['lazy', 'Lazy']]);
    const lazy = byValue(tree, 'lazy');
    expect(rowOf(lazy).hasAttribute('aria-expanded')).toBe(false);
    lazy.expandable = true;
    await lazy.updateComplete;
    expect(rowOf(lazy).getAttribute('aria-expanded')).toBe('false');
  });
});
