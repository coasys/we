/**
 * Which panels are on screen: the shell's, the section's, and the route filter over both.
 *
 * Both decisions here fail invisibly. A section's panel outranking the shell's would rearrange an
 * interface that never asked for it, and a route filter that drops a panel it should have kept
 * *unregisters* the dock — so its scroll position, its subscriptions and wherever it had been
 * dragged are destroyed and rebuilt, which reads as a rendering glitch rather than as a filter
 * being wrong. Neither needs a router to decide, so neither needs one to test.
 */
import { activePanels } from '@shared/panelScope';
import type { TemplatePanel } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const panel = (id: string, route?: string | string[]): TemplatePanel => ({ id, ...(route ? { route } : {}) });
const ids = (panels: readonly TemplatePanel[]) => panels.map((p) => p.id);

describe('the panels on screen', () => {
  it('keeps an unscoped panel on every route', () => {
    // What makes a panel a panel rather than a region of a page: it survives navigation.
    const shell = [panel('transcript'), panel('calls')];

    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'board']))).toEqual(['transcript', 'calls']);
    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'tasks']))).toEqual(['transcript', 'calls']);
  });

  it('drops one scoped to a segment that is not in the path', () => {
    const shell = [panel('inspector', 'board'), panel('calls')];

    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'tasks']))).toEqual(['calls']);
    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'board']))).toEqual(['inspector', 'calls']);
  });

  it('takes a list of segments, for two pages and not the third', () => {
    /*
      The gap a single segment left. What people reached for instead was the same `id` declared
      twice under two routes — which happens to work, since exactly one survives this filter and the
      dock id is stable, but it is one panel written down twice for the copies to disagree later.
    */
    const shell = [panel('inspector', ['board', 'tasks'])];

    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'board']))).toEqual(['inspector']);
    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'tasks']))).toEqual(['inspector']);
    expect(ids(activePanels(shell, undefined, ['space', 'abc', 'events']))).toEqual([]);
  });

  it('lets the shell overrule a section that claims the same id', () => {
    // A section is portable — it renders inside interfaces it knows nothing about — so what it says
    // about the screen is a suggestion, and the interface that owns the screen decides.
    const shell = [panel('inspector')];
    const view = [panel('inspector'), panel('legend')];

    const result = activePanels(shell, view, ['space', 'abc', 'graph']);

    expect(ids(result)).toEqual(['legend', 'inspector']);
    expect(result.filter((p) => p.id === 'inspector')).toHaveLength(1);
  });

  it('applies the route filter to a section’s panels too', () => {
    const view = [panel('legend', 'graph'), panel('stray', 'board')];

    expect(ids(activePanels([], view, ['space', 'abc', 'graph']))).toEqual(['legend']);
  });
});
