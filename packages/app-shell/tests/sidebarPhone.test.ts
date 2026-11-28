/**
 * An app's rail on a phone is a bar across the top, and its mark switches between the rail and the page.
 *
 * A tap reports the pointer arriving and nothing reports it leaving, so the rail that opened on
 * hover opened under the first tap and stayed open over the page that tap led to. And a 72px column
 * down the side of a 390px window left the page a strip beside it. Below the `sm` breakpoint
 * (`shellStore.narrowWindow`) the rail and the page take turns instead: shut, the rail is a bar
 * holding the mark, which is a button called "Menu"; open, it covers the window; every row that goes
 * somewhere shuts it on the way, so the place chosen is what shows. The app's narrow frame moves the
 * page below the bar.
 *
 * A desktop window keeps the hover rail and the mark as it was: every one of these is gated on
 * `narrowWindow`, so nothing here reaches a desktop. Checked for both apps that draw a rail — WE's
 * own sidebar and the Coasys app.
 */
import type { SchemaNode } from '@we/schema-shared';
import { evaluateExpression, parseExpression } from '@we/schema-shared';
import { sidebar, weApp } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

import { coasysApp } from '../../templates/cartridges/src/coasys/app';

type Node = Record<string, unknown>;

/** Every node in the tree, including the branches an `$if` carries in its props. */
function walk(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Node;
  out.push(record);
  for (const key of ['children', 'routes', 'then', 'else']) walk(record[key], out);
  const props = record.props as Node | undefined;
  if (props) {
    walk(props.then, out);
    walk(props.else, out);
    walk(props.header, out);
    walk(props.footer, out);
  }
  return out;
}

const props = (n: Node) => (n.props ?? {}) as Node;
const narrow = { $: 'shellStore.narrowWindow' };
const closeOnPhone = { $if: { condition: narrow, then: { $setLocal: 'expanded', value: false } } };

/** What a press does, as a list, whether a node says it as one handler or several. */
const handlers = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : []);

/** Whether a handler list takes the person somewhere: a shell view, a route, a space, an app, a chat. */
function goesSomewhere(list: unknown[]): boolean {
  return list.some((h) => {
    const invoke = (h as { $invoke?: string }).$invoke ?? '';
    return /openShellView|navigate|activateApp|selectSpace|joinSpace|createSpace|openChat/i.test(invoke);
  });
}

/** An expression's value with the window and the rail as given. */
function value(prop: unknown, window: { narrow: boolean; expanded: boolean }): unknown {
  if (!prop || typeof prop !== 'object' || !('$' in prop)) return prop;
  const roots: Record<string, unknown> = {
    shellStore: { narrowWindow: window.narrow },
    local: { expanded: window.expanded },
  };
  const env = { root: (name: string) => ({ bound: name in roots, value: roots[name] }), call: () => undefined };
  return evaluateExpression(parseExpression((prop as { $: string }).$), env);
}

const apps: { name: string; tree: SchemaNode; frame: unknown }[] = [
  { name: 'WE’s sidebar', tree: sidebar, frame: weApp.meta?.frame },
  { name: 'the Coasys app', tree: coasysApp, frame: coasysApp.meta?.frame },
];

describe.each(apps)('$name at phone width', ({ tree, frame }) => {
  const nodes = walk(tree);
  const rail = nodes.find((n) => props(n).onMouseEnter !== undefined)!;
  // The top of the rail: the menu button on a phone, the mark on a desktop.
  const header = nodes.find(
    (n) => n.type === '$if' && JSON.stringify(props(n).condition) === JSON.stringify(narrow) && props(n).else,
  );
  /** Only drawn on a desktop, where the pointer leaving closes the rail. */
  const desktopOnly = new Set(walk(header && props(header).else));

  it('puts a menu button in the bar that opens and closes the rail', () => {
    expect(header).toBeDefined();
    const menu = walk(props(header!).then).find((n) => n.type === 'we-button')!;
    expect(props(menu).onClick).toEqual({ $toggleLocal: 'expanded' });
    // Named for what it does, and saying whether what it opens is open.
    expect(props(menu).label).toBe('Menu');
    expect(props(menu).expanded).toEqual({ $: 'local.expanded' });
    // The mark is the button, as it is the top of the rail on a desktop.
    expect(JSON.stringify(menu)).toMatch(/brand\.mark|we-brand|svg/i);
    // The desktop branch is the mark opening About, as it always was.
    expect(JSON.stringify(props(header!).else)).toContain('landing-page');
  });

  it('is a bar across the top while shut, the whole window while open, and the rail on a desktop', () => {
    expect(value(rail.props && props(rail).width, { narrow: true, expanded: false })).toBe('100%');
    expect(value(props(rail).height, { narrow: true, expanded: false })).toBe('56px');
    expect(value(props(rail).height, { narrow: true, expanded: true })).toBe('100%');
    expect(value(props(rail).height, { narrow: false, expanded: false })).toBe('100%');
    expect(value(props(rail).width, { narrow: false, expanded: false })).not.toBe('100%');
  });

  it('moves the page below the bar on a phone', () => {
    expect((frame as { narrow?: { top?: number; left?: number } }).narrow).toMatchObject({ top: 56 });
    expect((frame as { narrow: { left?: number } }).narrow.left ?? 0).toBe(0);
  });

  it('does not open the rail under the pointer', () => {
    expect(props(rail).onMouseEnter).toEqual({
      $if: { condition: { $: '!shellStore.narrowWindow' }, then: { $setLocal: 'expanded', value: true } },
    });
  });

  it('closes the rail behind every row that goes somewhere', () => {
    const rows = nodes.filter((n) => goesSomewhere(handlers(props(n).onClick)) && !desktopOnly.has(n));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(handlers(props(row).onClick)).toContainEqual(closeOnPhone);
  });
});

describe('the Coasys app’s person menu at phone width', () => {
  const menu = walk(coasysApp).find((n) => n.type === 'DropdownMenu' && JSON.stringify(n).includes("'profile'"))!;

  it('opens above the person rather than off the right of the window', () => {
    expect(value(props(menu).placement, { narrow: true, expanded: true })).toBe('top-start');
    expect(value(props(menu).placement, { narrow: false, expanded: true })).toBe('right-end');
  });

  it('closes the rail behind the pages it opens, and leaves it open to ask a guest about logging out', () => {
    const branches = handlers(props(menu).onSelect).map(
      (h) => (h as { $if: { condition: unknown; then: unknown } }).$if,
    );
    const goes = branches.filter((b) => goesSomewhere(handlers(b.then)));
    expect(goes.length).toBe(2);
    for (const branch of goes) expect(handlers(branch.then)).toContainEqual(closeOnPhone);
    // The guest's confirmation is drawn in the rail's foot, which a shut rail does not show.
    const logout = branches.find((b) => JSON.stringify(b.condition).includes('logout'))!;
    expect(JSON.stringify(logout.then)).not.toContain(JSON.stringify(closeOnPhone));
  });
});
