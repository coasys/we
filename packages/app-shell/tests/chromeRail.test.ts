import { chromeRail } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

/**
 * The rail renders exactly when it has something in it.
 *
 * Its two sections are gated independently — the launchers and the gear on a current dataset, the
 * design pickers on a template being on screen — and the container was gated on neither. So with no
 * space open *and* an overlay covering the template, both were hidden and the rail painted a
 * bordered, shadowed 56px strip holding nothing. The landing page and Settings are both such
 * overlays, which is how it was reachable on a first run.
 *
 * A schema cannot ask a node whether it rendered, so the container has to restate its children's
 * conditions and the two can drift. These assert they have not: the rail's own gate is the
 * disjunction of its sections' gates, and each divider names something on both sides of it.
 */

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const condition = (node: unknown): string => {
  const value = (node as Node)?.props?.condition as { $?: string } | undefined;
  return value?.$ ?? '';
};

/** Every `$if` condition in the tree, so a section's gate can be found wherever it sits. */
function conditions(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as Node;
  if (n.type === '$if') out.push(condition(n));
  for (const child of n.children ?? []) conditions(child, out);
  for (const key of ['then', 'else']) conditions((n.props as Record<string, unknown>)?.[key], out);
  return out;
}

const IN_SPACE = 'datasetStore.currentDataset';
const TEMPLATE_ON_SCREEN = '!appStore.activeAppId && !shellStore.activeShellView';

describe('the rail is gated on having contents', () => {
  it('waits for boot, as it always did', () => {
    // The half that was already here: nothing means anything before the app is up, and the boot
    // screen owns the whole window.
    expect(condition(chromeRail)).toContain("sessionStore.bootState == 'ready'");
  });

  it('and appears only when a section will', () => {
    // The disjunction of the two section gates. If a third section is added, this has to grow —
    // which is the point of asserting it rather than trusting it.
    expect(condition(chromeRail)).toContain(IN_SPACE);
    expect(condition(chromeRail)).toContain(TEMPLATE_ON_SCREEN);
    expect(condition(chromeRail)).toMatch(/\|\|/);
  });

  it('gates both of its sections on exactly those questions', () => {
    // The other half of the pair: the container's disjunction is only correct while these are what
    // the sections actually ask.
    const all = conditions(chromeRail);
    expect(all).toContain(IN_SPACE);
    expect(all).toContain(TEMPLATE_ON_SCREEN);
  });
});

describe('no divider is stray', () => {
  /*
    A divider separates, so one with nothing above or nothing below is a line for its own sake. Both
    were previously implied by the sections' gates, which held while the gear sat inside the space
    section and stopped holding when it moved to the foot.

    The file records the first time this went wrong — "an empty rail with a stray horizontal line in
    it", from gating the launchers and their divider apart.
  */
  const dividerGates = conditions(chromeRail).filter((_, i, all) => all[i]);

  it('the one under the launchers waits for launchers', () => {
    expect(dividerGates.some((c) => c.includes('count(spaceStore.moduleLaunchers)'))).toBe(true);
  });

  it('the one above the gear waits for both sides', () => {
    // The pickers above it and the gear below — so it names both questions, not one.
    const both = dividerGates.find((c) => c.includes(IN_SPACE) && c.includes('activeShellView'));
    expect(both, 'no divider gate names both the space and the template').toBeTruthy();
  });
});
