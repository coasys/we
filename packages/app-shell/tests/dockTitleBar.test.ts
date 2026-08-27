/**
 * Which of a panel's controls mean anything in full screen.
 *
 * Three of them do not, and each does nothing in a way that is worse than inert: fit-to-content
 * writes a width the maximised box ignores, the displace toggle writes a flag it ignores, and the
 * position menu ticks a snap that decides only where the panel lands *later* — so using it changes
 * something invisible now and surprising on the way back out.
 *
 * Asserted against the schema rather than a render, for the same reason the layering test is: the
 * titlebar's composition is a static decision, and what this is protecting is the *condition* each
 * control is gated on rather than anything about how it draws.
 */
import { describe, expect, it } from 'vitest';

import type { DockEntry } from '../src/shared/registries/dockRegistry';
import { dockFrame } from '../src/shared/registries/dockRegistry';

const entry = { id: 'call:0', moduleId: 'call', edge: 'bottom', aspect: 'dockAspect', close: 'closeStage' };

/** Every `$if` in the tree, with the store path its condition negates — the gate, if it is one. */
function gates(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) gates(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  const condition = props?.condition as { $not?: { $store?: string } } | undefined;
  if (record.type === '$if' && condition?.$not?.$store) found.push(condition.$not.$store);
  for (const value of Object.values(record)) if (value && typeof value === 'object') gates(value, found);
  return found;
}

/** Whether a control naming itself this way exists anywhere in the tree, gated or not. */
function names(node: unknown, text: string): boolean {
  if (Array.isArray(node)) return node.some((item) => names(item, text));
  if (!node || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  // A tooltip carries `title`; `we-move-handle` names itself with `label`.
  if (props?.title === text || props?.label === text) return true;
  return Object.values(record).some((value) => value && typeof value === 'object' && names(value, text));
}

/**
 * Whether a node naming itself this way sits inside the *maximised* gate.
 *
 * Specifically that gate, not any `$if`: the whole frame is already wrapped in one on `edge`,
 * because a panel with no edge is closed rather than hidden.
 */
function hiddenInFullScreen(node: unknown, text: string, inside = false): boolean {
  if (Array.isArray(node)) return node.some((item) => hiddenInFullScreen(item, text, inside));
  if (!node || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  if (inside && (props?.title === text || props?.label === text)) return true;
  const condition = props?.condition as { $not?: { $store?: string } } | undefined;
  const within = inside || (record.type === '$if' && Boolean(condition?.$not?.$store?.endsWith('.maximised')));
  return Object.values(record).some(
    (value) => value && typeof value === 'object' && hiddenInFullScreen(value, text, within),
  );
}

describe('a panel’s titlebar in full screen', () => {
  const frame = dockFrame(entry as unknown as DockEntry, { type: 'Column' } as never);

  it('hides the three controls that would do nothing', () => {
    // One gate per inert control, each on that panel's own maximised flag. Hidden rather than
    // disabled, which is the choice `fitButton` already makes for a module publishing no aspect:
    // a control that does nothing is worse than one that is not there.
    const maximised = gates(frame).filter((path) => path === `shellStore.dockPlacement.${entry.id}.maximised`);
    expect(maximised).toHaveLength(3);

    // Named, for the one whose tooltip is a plain string — the other two write theirs conditionally,
    // so the count above is what covers them.
    expect(hiddenInFullScreen(frame, 'Fit to content')).toBe(true);
  });

  it('keeps the two ways out, ungated', () => {
    /*
      Dragging a maximised panel pulls it back out, so the grip is one way; the toggle is the other.
      Neither may be gated on the state it exists to leave — a control that disappears in the mode it
      is the exit from is how a panel strands somebody, which is the whole reason full screen used to
      stop short of the window's edges.
    */
    expect(names(frame, 'Move panel')).toBe(true);
    expect(hiddenInFullScreen(frame, 'Move panel')).toBe(false);

    // The maximise toggle names itself by what pressing it does, so it has no one fixed title.
    expect(JSON.stringify(frame)).toContain('Exit full screen');
  });

  it('keeps close reachable, since a full-screen panel is still one you may not want', () => {
    expect(names(frame, 'Close')).toBe(true);
    expect(hiddenInFullScreen(frame, 'Close')).toBe(false);
  });
});

/** Every menu item in the tree, whatever depth the position menu ended up at. */
function menuItems(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) menuItems(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  if (Array.isArray(props?.items)) found.push(...(props.items as Record<string, unknown>[]));
  for (const value of Object.values(record)) if (value && typeof value === 'object') menuItems(value, found);
  return found;
}

describe('the way back to the layout an interface declared', () => {
  const items = menuItems(dockFrame(entry as DockEntry, { type: 'Column' }));
  const reset = items.find((item) => item.label === 'Reset to layout');

  it('is offered on the panel’s own menu', () => {
    // Without it the three-rung chain is one-way: a drag wins for good, and an author improving a
    // layout is overruled forever by one stray drag.
    expect(reset).toBeDefined();
  });

  it('is disabled rather than absent when there is nothing to go back to', () => {
    // The same choice displaceButton makes: a control that vanishes when you move a panel is one you
    // stop looking for, and the disabled state carries the actual rule.
    expect(reset?.disabled).toEqual({ $not: { $store: `shellStore.layoutPinned.${entry.id}` } });
  });

  it('forgets the stored placement rather than writing the declared one', () => {
    // Deleting is what keeps the panel following the layout afterwards, including when the template
    // changes it. Writing the declared placement would pin it to today's version for ever.
    expect(reset?.onAction).toEqual({ $action: 'shellStore.resetDockToLayout', args: [entry.id] });
  });

  it('comes before the eight positions, not among them', () => {
    // It undoes a position rather than choosing one; listed among the eight it would read as a ninth
    // place to put the panel.
    expect(items[0]?.label).toBe('Reset to layout');
  });
});
