/**
 * WE's sidebar on a phone opens from a menu button, and closes behind the row that was pressed.
 *
 * A tap reports the pointer arriving and nothing reports it leaving, so the rail that opened on
 * hover opened under the first tap and stayed open over the page that tap led to. Below the `sm`
 * breakpoint (`shellStore.narrowWindow`) it now opens only from the button in its top square, and
 * every row that goes somewhere closes it on the way. A desktop window keeps the hover rail and
 * WE's mark: every one of these is gated on `narrowWindow`, so nothing here reaches a desktop.
 */
import { sidebar } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

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

const nodes = walk(sidebar);
const props = (n: Node) => (n.props ?? {}) as Node;
const narrow = { $: 'shellStore.narrowWindow' };
const closeOnPhone = { $if: { condition: narrow, then: { $setLocal: 'expanded', value: false } } };

/** What a press does, as a list, whether a node says it as one handler or several. */
const handlers = (value: unknown): unknown[] => (Array.isArray(value) ? value : value ? [value] : []);

/** Whether a handler list takes the person somewhere: a shell view, a route, a space or an app. */
function goesSomewhere(list: unknown[]): boolean {
  return list.some((h) => {
    const invoke = (h as { $invoke?: string }).$invoke ?? '';
    return /openShellView|navigate|activateApp|selectSpace|joinSpace|createSpace/.test(invoke);
  });
}

describe('the sidebar at phone width', () => {
  it('swaps the mark for a menu button that opens and closes the rail', () => {
    const header = nodes.find(
      (n) => n.type === '$if' && JSON.stringify(props(n).condition) === JSON.stringify(narrow) && props(n).else,
    );
    expect(header).toBeDefined();
    const menu = walk(props(header!).then).find((n) => n.type === 'we-button');
    expect(props(menu!).onClick).toEqual({ $toggleLocal: 'expanded' });
    expect(props(menu!).label).toEqual({ $: "local.expanded ? 'Close menu' : 'Open menu'" });
    // The desktop branch is WE's mark, opening About, as it always was.
    expect(JSON.stringify(props(header!).else)).toContain('landing-page');
  });

  it('does not open the rail under the pointer', () => {
    const shell = nodes.find((n) => props(n).onMouseEnter !== undefined);
    expect(props(shell!).onMouseEnter).toEqual({
      $if: { condition: { $: '!shellStore.narrowWindow' }, then: { $setLocal: 'expanded', value: true } },
    });
  });

  it('closes the rail behind every row that goes somewhere', () => {
    const rows = nodes.filter((n) => goesSomewhere(handlers(props(n).onClick)) && n.type !== 'Column');
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(handlers(props(row).onClick)).toContainEqual(closeOnPhone);
  });
});
