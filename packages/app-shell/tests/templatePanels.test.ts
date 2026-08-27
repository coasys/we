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
