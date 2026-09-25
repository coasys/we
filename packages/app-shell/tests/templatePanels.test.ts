/**
 * What a template declares about panels, before the host has decided anything about it.
 *
 * The registry is deliberately dumb — it holds a list and says when it changed — so the tests are
 * about the two rules that are not obvious: replacing rather than merging, and staying quiet when
 * nothing actually changed.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  onTemplatePanelsChanged,
  setTemplatePanels,
  templatePanelDockId,
  templatePanels,
  templatePanelScope,
} from '../src/shared/registries/templatePanels';

describe('what an interface declares', () => {
  it('replaces wholesale rather than merging', () => {
    setTemplatePanels([{ id: 'a' }, { id: 'b' }]);
    setTemplatePanels([{ id: 'a' }]);

    // The declaration *is* the list, so a template dropping a panel has to be able to say so.
    expect(templatePanels().map((panel) => panel.id)).toEqual(['a']);
  });

  it('treats an absent declaration as none', () => {
    setTemplatePanels([{ id: 'a' }]);
    setTemplatePanels(undefined);

    expect(templatePanels()).toEqual([]);
  });

  it('stays quiet when the same declaration arrives again', () => {
    const panels = [{ id: 'a' }];
    setTemplatePanels(panels);

    const listener = vi.fn();
    const stop = onTemplatePanelsChanged(listener);
    setTemplatePanels(panels);
    stop();

    // Every announcement rebuilds dock entries, and a template being edited re-renders on every
    // keystroke — announcing an unchanged declaration would drop a drag in progress.
    expect(listener).not.toHaveBeenCalled();
  });

  it('announces when the declaration really changes', () => {
    setTemplatePanels([{ id: 'a' }]);

    const listener = vi.fn();
    const stop = onTemplatePanelsChanged(listener);
    setTemplatePanels([{ id: 'a' }, { id: 'b' }]);
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('namespaces a template panel’s dock id away from a module’s', () => {
    // A module's docks are `<moduleId>:<index>`; a template naming its panel `call` must not land
    // on top of the call module's.
    expect(templatePanelDockId('call')).not.toBe('call:0');
  });
});

describe('the scope a placement is remembered under', () => {
  it('travels with the declaration', () => {
    setTemplatePanels([{ id: 'a' }], 'workshop');

    expect(templatePanelScope()).toBe('workshop');
  });

  it('announces when only the scope changed', () => {
    const panels = [{ id: 'a' }];
    setTemplatePanels(panels, 'workshop');

    const listener = vi.fn();
    const stop = onTemplatePanelsChanged(listener);
    // The same panels under a different interface are a different layout: a placement stored against
    // one must not be read as the other's.
    setTemplatePanels(panels, 'channels');
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(templatePanelScope()).toBe('channels');
  });

  it('clears when nothing declares any', () => {
    setTemplatePanels([{ id: 'a' }], 'workshop');
    setTemplatePanels([], '');

    // An interface that declares nothing shares the unscoped key, so a panel somebody positioned in
    // an ordinary space stays where they put it.
    expect(templatePanelScope()).toBe('');
  });
});

/**
 * What happens to a template's own panels when the template goes.
 *
 * They are registered as docks by the shell, and the declaration they render from is looked up by
 * id — so a dock that outlived its declaration would be a frame on screen with nothing in it. That
 * is the shape of the report: switching away from an interface left its panels open and empty.
 */
describe('withdrawing an interface’s panels', () => {
  it('announces the change when the interface goes, so the docks can be withdrawn', () => {
    const seen: number[] = [];
    const off = onTemplatePanelsChanged(() => seen.push(templatePanels().length));

    setTemplatePanels([{ id: 'inspector', node: { type: 'Column' } }], 'workshop');
    setTemplatePanels([], 'default');

    // The empty list is a real announcement, not a no-op: an interface that declares nothing has to
    // be distinguishable from one that has not spoken, or the last one's panels stay on screen.
    expect(seen).toEqual([1, 0]);
    expect(templatePanels()).toEqual([]);
    off();
  });

  it('re-announces an identical list from a different interface', () => {
    /*
      The guard against re-announcing exists so a template re-rendering mid-drag does not rebuild its
      dock entries. It compares the scope as well as the list, and it has to: two interfaces can
      declare panels that are equal by identity — the same imported node — and the placements are
      scoped per interface, so treating that as "no change" would leave the previous one's scope in
      force.
    */
    const panel = { id: 'notes', node: { type: 'Column' } };
    const seen: string[] = [];
    const off = onTemplatePanelsChanged(() => seen.push(templatePanelScope()));

    setTemplatePanels([panel], 'workshop');
    setTemplatePanels([panel], 'default');

    expect(seen).toEqual(['workshop', 'default']);
    off();
  });
});
