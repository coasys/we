/**
 * What a folding section heading owes, beyond looking right.
 *
 * It was written four times in one panel and differently in six other places, and what the copies
 * disagreed about was never the look — it was the hit target, the markup, and whether anything said
 * the section was open. Those are the three things here.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { foldingBody, foldingSectionLabel, isOpen } from './foldingSection.ts';

/** What `walk` hands back: every node loosely, since it descends into props and children alike. */
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

/** Every node in a fragment, depth first. */
const walk = (value: unknown, seen: Node[] = []): Node[] => {
  if (Array.isArray(value)) value.forEach((v) => walk(v, seen));
  else if (value && typeof value === 'object') {
    seen.push(value as Node);
    Object.values(value).forEach((v) => walk(v, seen));
  }
  return seen;
};

const buttons = (node: unknown) => walk(node).filter((n) => n.type === 'we-button');

describe('the heading is one control, not a glyph at the end of a row', () => {
  it('wraps the whole row in a real button', () => {
    /*
      It was the caret alone, which left a hit target the size of a glyph at the far end of a row
      whose obvious target is the word naming the thing. `bare` is the appearance-free clickable —
      a real `<button>`, keeping the keyboard activation and the role a `Row` with an `onClick`
      silently loses.
    */
    const [button] = buttons(
      foldingSectionLabel({ label: 'Logs', count: 'count(local.passes)', open: { field: 'logsOpen' } }),
    );
    expect(button.props?.variant).toBe('bare');
    expect(button.props?.width).toBe('100%');
    expect(button.props?.onClick).toEqual({ $toggleLocal: 'logsOpen' });
  });

  it('says whether it is open', () => {
    // The whole reason `we-button` grew an `expanded` prop: a schema assigns props as DOM
    // properties, so until the primitive declared one, no folding row anywhere could set
    // `aria-expanded` and the caret said it only to people who could see it.
    const [button] = buttons(foldingSectionLabel({ label: 'Logs', open: { field: 'logsOpen' } }));
    expect(button.props?.expanded).toEqual({ $: 'local.logsOpen' });
  });

  it('never puts a button inside a button', () => {
    /*
      Invalid markup, and it would take the press on the way past and toggle the section twice. So
      an `action` splits the heading in two — the name, and the count with its caret — each folding
      the same section, with the action in the gap between them.
    */
    const action: SchemaNode = { type: 'we-button', props: { label: 'Export' } };
    const heading = foldingSectionLabel({ label: 'Logs', count: '3', open: { field: 'logsOpen' }, action });
    const nested = walk(heading).filter((n) => n.type === 'we-button' && buttons(n.children).length > 0);
    expect(nested, 'a button ended up inside another button').toEqual([]);

    const folding = buttons(heading).filter((b) => b.props?.onClick);
    expect(folding).toHaveLength(2);
    expect(
      folding.every((b) => JSON.stringify(b.props?.onClick) === JSON.stringify({ $toggleLocal: 'logsOpen' })),
    ).toBe(true);
  });

  it('names the half that is only a number and a caret', () => {
    // Its contents say nothing read aloud. The other half needs no name: "Logs 3" is what the ARIA
    // disclosure pattern asks a disclosure button to be called, and it is already the contents.
    const heading = foldingSectionLabel({
      label: 'Logs',
      count: '3',
      open: { field: 'logsOpen' },
      action: { type: 'we-button' },
    });
    const named = buttons(heading).filter((b) => typeof b.props?.label === 'string');
    expect(named).toHaveLength(1);
    expect(named[0].props?.label).toBe('Show or hide logs');
  });
});

describe('a count is a chip, and only where there is one', () => {
  it('holds a square at its narrowest so every section has the same shape of chip', () => {
    // A badge is sized by its content, so `3` came out a squat lozenge and `12` a wider one. The
    // floor is the badge's own height, written so a theme's density moves both together.
    const badge = walk(foldingSectionLabel({ label: 'Logs', count: '3', open: { field: 'x' } })).find(
      (n) => n.type === 'we-badge',
    );
    expect(badge?.props?.minWidth).toContain('var(--we-component-height-xs)');
    expect(badge?.props?.variant).toBe('neutral');
  });

  it('draws the caret with no chip when there is no number worth showing', () => {
    const nodes = walk(foldingSectionLabel({ label: 'Connects', open: { field: 'x' } }));
    expect(nodes.find((n) => n.type === 'we-badge')).toBeUndefined();
    expect(nodes.find((n) => n.type === 'we-icon')).toBeTruthy();
  });

  it('keeps the status colours for things that are a verdict', () => {
    const badge = walk(
      foldingSectionLabel({ label: 'Pending', count: '2', tone: 'warning', open: { field: 'x' } }),
    ).find((n) => n.type === 'we-badge');
    expect(badge?.props?.variant).toBe('warning');
  });
});

describe('one field per section, or one field for many sections', () => {
  it('asks a boolean directly', () => {
    expect(isOpen({ field: 'logsOpen' })).toBe('local.logsOpen');
  });

  it('asks a set by membership, for sections that come from data', () => {
    /*
      A `$localState` field name is fixed when the template is written and the rows are not — one
      section per extraction pass, per type on a key, per reaction — so the open ones are held as a
      set of ids. Without this the fragment would serve only the sections somebody named in advance,
      which is half of them.
    */
    expect(isOpen({ field: 'openPasses', value: { $: 'pass.passId' } })).toBe('pass.passId in local.openPasses');
    expect(isOpen({ field: 'openPanes', value: 'prompt' })).toBe("'prompt' in local.openPanes");
  });

  it('folds a set with the toggle that writes a set', () => {
    const [button] = buttons(foldingSectionLabel({ label: 'Prompt', open: { field: 'openPanes', value: 'prompt' } }));
    expect(button.props?.onClick).toEqual({ $toggleLocalIn: 'openPanes', value: 'prompt' });
  });
});

describe('what folds away', () => {
  it('unmounts by default, because the point of folding a list is that it got large', () => {
    const body = foldingBody({ open: { field: 'logsOpen' }, children: [{ type: 'Grid' }] }) as Node;
    expect(body.type).toBe('$if');
    expect(body.props?.condition).toEqual({ $: 'local.logsOpen' });
  });

  it('keeps the content when asked, for a draft that cannot be rebuilt', () => {
    // `$animate` holds the subtree behind a clipped wrapper — right where unmounting would throw
    // away a half-typed reply or a scroll position somebody is coming back to.
    const body = foldingBody({ open: { field: 'x' }, children: [{ type: 'Column' }], keepMounted: true }) as Node;
    expect(body.type).toBe('$animate');
  });

  it('opens on the size axis and closes quicker than it opens', () => {
    // `reveal` alone: a section opening in place pushes what is below it down, and that movement is
    // the announcement — a fade on top reads as the rows arriving twice.
    const body = foldingBody({ open: { field: 'x' }, children: [{ type: 'Column' }] }) as Node;
    expect(body.props?.enterTransition).toEqual({ type: 'reveal', duration: 200 });
    expect(body.props?.exitTransition).toEqual({ type: 'reveal', duration: 160 });
  });
});
