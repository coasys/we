/**
 * A space's settings panel on a phone is a list of its sections, then a section under Back — and on
 * a desktop the tabs, as they were.
 *
 * On a phone the panel covers the window (`PanelLane`'s `foldEmpty`), and its five tabs across the
 * top scrolled sideways: "Features" was cut at the edge and Vocabulary off the screen, and a person
 * had to know to swipe for them. Below `sm` (`shellStore.narrowWindow`, the window rather than the
 * panel's own box, which is as narrow as a phone's on a desktop) the two take turns the way app
 * Settings does on a phone: the list, then the section chosen, with Back to the list.
 *
 * Driven through the template's own expressions and handlers, as `settingsPhone.test.ts` drives
 * Settings: what is drawn is worked out by evaluating each `display` and `$if` with the state a press
 * leaves behind.
 */
import { evaluateExpression, parseExpression } from '@we/schema-shared';
import { spaceSettingsPanel } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown>;
type State = { narrow: boolean; tab: string; tabPage: boolean; tabFrom: string; openedOn: string };

const props = (n: Node) => (n.props ?? {}) as Node;
const handlers = (value: unknown): Node[] => (Array.isArray(value) ? value : value ? [value] : []) as Node[];

function value(prop: unknown, state: State): unknown {
  if (!prop || typeof prop !== 'object' || !('$' in prop)) return prop;
  const roots: Record<string, unknown> = {
    shellStore: { narrowWindow: state.narrow, spaceSettingsTab: state.openedOn },
    local: { tab: state.tab, tabPage: state.tabPage, tabFrom: state.tabFrom },
    datasetStore: { currentDataset: { id: 'space-1' } },
    space: { uuid: 'space-1', isWeSpace: true, canAdminister: true },
  };
  const env = { root: (name: string) => ({ bound: name in roots, value: roots[name] }), call: () => undefined };
  try {
    return evaluateExpression(parseExpression((prop as { $: string }).$), env);
  } catch {
    // A store this test does not stand up: whatever reads it is not what is under test.
    return undefined;
  }
}

/** The local state a node's `$localState` starts with, as the renderer would work it out. */
function initialState(state: Omit<State, 'tab' | 'tabPage' | 'tabFrom'>): State {
  const declared = (spaceSettingsPanel.children as Node[])
    .map((n) => props(n).then as Node)
    .find((n) => n?.$localState) as { $localState: Record<string, { initial: unknown }> };
  const start = { ...state, tab: '', tabPage: false, tabFrom: '' };
  const read = (key: string) => value(declared.$localState[key]?.initial, start);
  return {
    ...start,
    tab: String(read('tab')),
    tabPage: Boolean(read('tabPage')),
    tabFrom: String(read('tabFrom') ?? ''),
  };
}

/** The words a node draws, joined. */
function words(node: unknown, state: State): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((n) => words(n, state)).join(' ');
  if (!node || typeof node !== 'object') return '';
  if ('$' in node) return String(value(node, state) ?? '');
  const n = node as Node;
  return [words(props(n).label, state), words(n.children, state)].join(' ');
}

const setsPage = (n: Node, to: boolean) =>
  handlers(props(n).onClick).some((h) => h.$setLocal === 'tabPage' && h.value === to);

/** What is drawn in a state: the tab strip, the list's entries, Back, and the open section. */
function drawn(state: State) {
  const texts: string[] = [];
  const entries: Node[] = [];
  const backs: Node[] = [];
  let tabStrips = 0;
  let sections = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node === 'string') return void texts.push(node);
    if (!node || typeof node !== 'object') return;
    if ('$' in node) return void texts.push(String(value(node, state) ?? ''));
    const n = node as Node;
    if (value(props(n).display, state) === 'none') return;
    if (n.type === '$if') return visit(value(props(n).condition, state) ? props(n).then : props(n).else);
    if (n.type === 'we-tabs') tabStrips += 1;
    // The panel's sections scroll inside it: one scroll area is one open section.
    if (n.type === 'we-scroll-area') sections += 1;
    if (n.type === 'we-button' && setsPage(n, true)) entries.push(n);
    if (n.type === 'we-button' && setsPage(n, false)) backs.push(n);
    visit(n.children);
  };
  visit(spaceSettingsPanel);
  return {
    texts,
    entries,
    backs,
    tabStrips,
    sections,
    entry: (label: string) => entries.find((e) => words(e, state).trim() === label),
  };
}

/** What pressing a button leaves behind. */
function press(button: Node, state: State): State {
  const next = { ...state };
  for (const h of handlers(props(button).onClick)) {
    const to = value(h.value, state);
    if (h.$setLocal === 'tab') next.tab = String(to);
    if (h.$setLocal === 'tabPage') next.tabPage = Boolean(to);
    if (h.$setLocal === 'tabFrom') next.tabFrom = String(to);
  }
  return next;
}

const LABELS = ['About', 'People', 'Appearance', 'Features', 'Vocabulary'];

describe("a space's settings on a phone", () => {
  it('opens on the list of its sections, with no tab strip and no section yet', () => {
    const shown = drawn(initialState({ narrow: true, openedOn: 'about' }));
    expect(shown.tabStrips).toBe(0);
    expect(shown.sections).toBe(0);
    expect(shown.backs).toHaveLength(0);
    expect(shown.entries.map((e) => words(e, initialState({ narrow: true, openedOn: 'about' })).trim())).toEqual(
      LABELS,
    );
  });

  it('opens every section as its page, under Back and its own name, and Back returns to the list', () => {
    const list = initialState({ narrow: true, openedOn: 'about' });
    for (const label of LABELS) {
      const opened = press(drawn(list).entry(label)!, list);
      const shown = drawn(opened);
      expect(shown.sections, label).toBe(1);
      expect(shown.entries, label).toHaveLength(0);
      expect(shown.tabStrips, label).toBe(0);
      expect(shown.backs, label).toHaveLength(1);
      expect(shown.texts, label).toContain(label);

      const back = press(shown.backs[0], opened);
      const again = drawn(back);
      expect(again.sections, label).toBe(0);
      expect(again.entries, label).toHaveLength(LABELS.length);
      // Focus goes back to the entry that opened the section: the list is put away, not unmounted.
      expect(value(props(again.entry(label)!).autofocus, back), label).toBe(true);
    }
  });

  it('makes Back a real button that takes focus as the section arrives', () => {
    const list = initialState({ narrow: true, openedOn: 'about' });
    const back = drawn(press(drawn(list).entry('People')!, list)).backs[0];
    expect(back.type).toBe('we-button');
    expect(props(back).autofocus).toBe(true);
  });

  it('opens straight on the section a control elsewhere pointed at', () => {
    const shown = drawn(initialState({ narrow: true, openedOn: 'vocabulary' }));
    expect(shown.sections).toBe(1);
    expect(shown.backs).toHaveLength(1);
    expect(shown.texts).toContain('Vocabulary');
  });
});

describe("a space's settings in a wider window", () => {
  it('keeps the tabs and the open tab, with no list and no Back, however the panel was opened', () => {
    for (const openedOn of ['about', 'vocabulary']) {
      const shown = drawn(initialState({ narrow: false, openedOn }));
      expect(shown.tabStrips, openedOn).toBe(1);
      expect(shown.sections, openedOn).toBe(1);
      expect(shown.entries, openedOn).toHaveLength(0);
      expect(shown.backs, openedOn).toHaveLength(0);
    }
  });
});
