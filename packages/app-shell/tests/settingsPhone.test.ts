/**
 * Settings on a phone is a list, then a page with Back — and on a desktop the nav beside the page.
 *
 * Settings' 200px nav beside its page left a phone's page a column a few letters wide; a strip of
 * tabs across the top that scrolled sideways replaced it, which hid most of the entries and grouped
 * none. On the overlay's `base` tier the two now take turns: the grouped list until an entry is
 * chosen, then that page under a header with Back and the page's name. From `sm` up the nav sits
 * beside the page as it always did.
 *
 * Driven through the template's own expressions and handlers: what is drawn is worked out by
 * evaluating each `display` and `$if` with the state a press leaves behind, so the test follows the
 * schema rather than restating it. The browser case `shellSettings` measures the same at 412px.
 */
import { evaluateExpression, parseExpression } from '@we/schema-shared';
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown>;
type State = { tier: string; settingsPage: boolean; path: string };

const props = (n: Node) => (n.props ?? {}) as Node;
const handlers = (value: unknown): Node[] => (Array.isArray(value) ? value : value ? [value] : []) as Node[];

function value(prop: unknown, state: State): unknown {
  if (!prop || typeof prop !== 'object' || !('$' in prop)) return prop;
  const roots: Record<string, unknown> = {
    surface: { tier: state.tier },
    local: { settingsPage: state.settingsPage },
    routeStore: { currentPath: state.path, segments: state.path.split('/').filter(Boolean) },
    // Every entry offered, so every one is checked.
    runtimeStore: { canManageAi: true, canManageApps: true },
    sessionStore: { devFeatures: true },
    modules: { call: true },
  };
  const env = { root: (name: string) => ({ bound: name in roots, value: roots[name] }), call: () => undefined };
  return evaluateExpression(parseExpression((prop as { $: string }).$), env);
}

/** Whether a button takes the person to a settings page. */
const navigates = (n: Node) => handlers(props(n).onClick).some((h) => h.$invoke === 'routeStore.navigate');

/** The words a node draws, joined. */
function words(node: unknown, state: State): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((n) => words(n, state)).join(' ');
  if (!node || typeof node !== 'object') return '';
  if ('$' in node) return String(value(node, state) ?? '');
  return words((node as Node).children, state);
}

/** What is drawn in a state: its words, its nav entries, and whether the page outlet is. */
function drawn(state: State) {
  const texts: string[] = [];
  const entries: Node[] = [];
  const backs: Node[] = [];
  let page = false;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node === 'string') return void texts.push(node);
    if (!node || typeof node !== 'object') return;
    if ('$' in node) return void texts.push(String(value(node, state) ?? ''));
    const n = node as Node;
    if (value(props(n).display, state) === 'none') return;
    if (n.type === '$routes') page = true;
    if (n.type === '$if') return visit(value(props(n).condition, state) ? props(n).then : props(n).else);
    if (n.type === 'we-button' && navigates(n)) {
      if (words(n, state).trim() === 'Back') backs.push(n);
      else entries.push(n);
    }
    visit(n.children);
  };
  visit(settingsTemplate);
  return {
    texts,
    entries,
    backs,
    page,
    entry: (label: string) => entries.find((e) => words(e, state).trim() === label),
  };
}

/** What pressing a button leaves behind. */
function press(button: Node, state: State): State {
  const next = { ...state };
  for (const h of handlers(props(button).onClick)) {
    if (h.$setLocal === 'settingsPage') next.settingsPage = h.value as boolean;
    if (h.$invoke === 'routeStore.navigate') next.path = (h.args as string[])[0];
  }
  return next;
}

const phone = (path: string): State => ({ tier: 'base', settingsPage: false, path });

describe('Settings on a phone', () => {
  it('opened on a page shows that page under Back, without the list', () => {
    const shown = drawn(phone('/devices'));
    expect(shown.page).toBe(true);
    expect(shown.backs).toHaveLength(1);
    expect(shown.entries).toHaveLength(0);
    // The list's own heading is put away with it; the page's own heading says where you are.
    expect(shown.texts).not.toContain('Settings');
  });

  it('goes back to the grouped list, with the page put away and nothing lit', () => {
    const at = phone('/devices');
    const back = press(drawn(at).backs[0], at);
    expect(back).toMatchObject({ path: '/', settingsPage: false });
    const shown = drawn(back);
    expect(shown.page).toBe(false);
    expect(shown.backs).toHaveLength(0);
    for (const heading of ['Settings', 'Account', 'Devices and access', 'This app'])
      expect(shown.texts).toContain(heading);
    // Back goes to `/`, which is Profile's path too: a lit Profile would be lit every time.
    for (const entry of shown.entries) expect(value(props(entry).variant, back)).toBe('ghost');
  });

  it('opens every entry in the list as its page, under a header that holds only Back', () => {
    const list = phone('/');
    const labels = drawn(list).entries.map((e) => words(e, list).trim());
    expect(labels).toEqual(expect.arrayContaining(['Profile', 'Security', 'Devices', 'AI models', 'Developer']));
    for (const label of labels) {
      const opened = press(drawn(list).entry(label)!, list);
      const shown = drawn(opened);
      expect(shown.page, label).toBe(true);
      expect(shown.entries, label).toHaveLength(0);
      // The page's own heading names it, so the header does not say it again.
      const header = settingsTemplate
        .children!.flatMap((n) => (n as Node).children as Node[])
        .find((n) => n.type === '$if' && JSON.stringify(props(n).then).includes('"Back"'));
      expect(words(props(header!).then, opened).trim(), label).toBe('Back');
    }
  });

  it('makes Back a real button that takes focus as the page arrives', () => {
    const back = drawn(phone('/devices')).backs[0];
    expect(back.type).toBe('we-button');
    expect(props(back).autofocus).toBe(true);
  });
});

describe('Settings from sm up', () => {
  it('keeps the nav beside the page, with no Back, whatever is open', () => {
    for (const path of ['/', '/devices']) {
      const shown = drawn({ tier: 'md', settingsPage: false, path });
      expect(shown.page, path).toBe(true);
      expect(shown.backs, path).toHaveLength(0);
      expect(shown.texts, path).toContain('Settings');
      expect(shown.entry('Devices'), path).toBeDefined();
    }
    // The open page is lit, as it was.
    const at = { tier: 'md', settingsPage: false, path: '/devices' };
    expect(value(props(drawn(at).entry('Devices')!).variant, at)).toBe('soft');
  });
});
