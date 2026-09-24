/**
 * Where this module puts its chrome, which is a decision about somebody else's bar.
 *
 * Two regions, and the difference between them is the whole subject. A *control* is part of the bar a
 * user gets and belongs among the others. A *harness* is absent from a shipped build entirely, and
 * wants to sit with the other harness after everything real, so that what a developer is looking at
 * differs from what everybody else gets by one trailing group and nothing else.
 *
 * Asserted here because nothing else can. The call module's own suite sees the region and the triple it
 * leads; it cannot see what this module contributes into it, and this module cannot import it.
 */
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { liveModule } from './index';

const props = (node: SchemaNode | undefined): Record<string, unknown> => (node?.props ?? {}) as Record<string, unknown>;

function walk(node: unknown, out: SchemaNode[] = []): SchemaNode[] {
  if (Array.isArray(node)) {
    for (const entry of node) walk(entry, out);
    return out;
  }
  if (typeof node !== 'object' || node === null) return out;
  const candidate = node as SchemaNode;
  if (typeof candidate.type === 'string') out.push(candidate);
  for (const value of Object.values(node as Record<string, unknown>)) walk(value, out);
  return out;
}

/** The ancestors of `target` within `node`, outermost first — for asking what wraps something. */
function lineage(node: unknown, target: SchemaNode, trail: SchemaNode[] = []): SchemaNode[] | undefined {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = lineage(entry, target, trail);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) return undefined;
  const candidate = node as SchemaNode;
  if (candidate === target) return trail;
  const next = typeof candidate.type === 'string' ? [...trail, candidate] : trail;
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = lineage(value, target, next);
    if (found) return found;
  }
  return undefined;
}

const slots = () => liveModule.contributes?.slots ?? [];
const into = (anchor: string) => slots().filter((slot) => slot.anchor === anchor);

describe('what this module puts in the call bar', () => {
  it('puts the pointer switch and the wheel among the controls', () => {
    // Real controls, in the region for real controls, at every width — the bar keeps contributed
    // chrome in the row rather than folding meanings it cannot read.
    expect(into('call-controls')).toHaveLength(2);
  });

  it('puts the synthetic cursors in the development region instead', () => {
    /*
      Not a high `order` among the controls, which could not achieve it: contributions from one module
      land at a single point, so the call module's own harness triple can never be threaded in between
      this module's controls. Being in the same region is the only way to be next to it.

      Vitest is a development build, so it is here to be found. In a production one neither this
      contribution nor the region exists.
    */
    const dev = into('call-dev');
    expect(dev).toHaveLength(1);
    expect(walk(dev[0].node).some((node) => props(node).name === 'cursor-click')).toBe(true);
  });

  it('draws no rule of its own, because the region draws them', () => {
    /*
      A rule inside a contributed fragment is either missing or doubled depending on what else is
      installed, and it sits against the fragment's own tight internal gap rather than the bar's, which
      reads as the glyph being jammed up against it. The region separates its members itself.
    */
    const dev = into('call-dev')[0];
    expect(walk(dev.node).filter((node) => node.type === 'we-divider')).toEqual([]);
  });

  it('hangs the counter’s tooltip on the glyph rather than on the number', () => {
    /*
      The icon is the only part that says which of the two triples this is, so it is what a pointer
      looking for an explanation lands on. The number is the part somebody is reading, and a tooltip over
      it covers the value it is explaining.
    */
    const node = into('call-dev')[0].node;
    const glyph = walk(node).find((child) => props(child).name === 'cursor-click') as SchemaNode;
    expect(props(lineage(node, glyph)?.find((step) => step.type === 'we-tooltip')).content).toBe(
      'Synthetic cursors — development only',
    );

    const number = walk(node).find((child) => child.type === 'we-number') as SchemaNode;
    expect(lineage(node, number)?.some((step) => step.type === 'we-tooltip')).toBe(false);
  });

  it('names the counter with the same glyph as its launcher', () => {
    /*
      The identical `−  N  +` next to it is what makes this necessary, and matching the rail button is
      what makes the two readable as the same feature rather than as two unrelated dev toys.
    */
    const launcher = (liveModule.contributes?.launchers ?? []).find((entry) => entry.key === 'cursors');
    const glyph = walk(into('call-dev')[0].node).find(
      (node) => node.type === 'we-icon' && props(node).name !== 'minus' && props(node).name !== 'plus',
    );
    expect(props(glyph).name).toBe(launcher?.icon);
  });
});
