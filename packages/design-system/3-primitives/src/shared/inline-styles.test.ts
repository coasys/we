/**
 * The `styles` escape hatch reaches the element it is set on.
 *
 * It is documented as a design-system prop — "inline CSS applied directly to the component's own
 * element" — and it has been broken twice at different ends of the same pipe. First the primitives
 * accepted it, typed it and never read it, which is what `applyInlineStyles` was written to fix.
 * That fix landed, and still nothing happened: `getInstanceProps` filters by the layer key sets, and
 * `styles` is added to `designSystemKeys` *outside* them, so it was dropped a step earlier than the
 * place anyone was looking.
 *
 * Neither failure had a symptom worth the name. A caller sets `--we-resize-handle-line` to suppress a
 * divider and the divider stays; a corner grip asks for a resize cursor and keeps the hand. Nothing
 * errors, so the tell is always some third thing looking slightly wrong.
 *
 * Hence a test at the mixin rather than on one component: what is under test is that the prop
 * survives the filter at all, for a layout-only primitive as much as for a full one.
 */
import '../primitives/move-handle';
import '../primitives/text';

import { describe, expect, it } from 'vitest';

type StyledEl = HTMLElement & { styles?: Record<string, string>; updateComplete: Promise<unknown> };

async function mount(tag: string, styles: Record<string, string>): Promise<StyledEl> {
  const el = document.createElement(tag) as StyledEl;
  el.styles = styles;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('the styles prop', () => {
  it('applies to a layout-only primitive', async () => {
    // `we-move-handle` opts into the layout layer alone, which is the case that was broken: its
    // corner grips set a diagonal resize cursor and rendered the hand its own stylesheet gives it.
    const el = await mount('we-move-handle', { cursor: 'nwse-resize' });

    expect(el.style.getPropertyValue('cursor')).toBe('nwse-resize');
  });

  it('applies to a primitive with every layer', async () => {
    const el = await mount('we-text', { 'mix-blend-mode': 'multiply' });

    expect(el.style.getPropertyValue('mix-blend-mode')).toBe('multiply');
  });

  it('carries custom properties, which is most of what it is for', async () => {
    // The documented use is CSS a DS prop does not cover — and for a primitive that is usually one of
    // its own custom properties, the seam it publishes for exactly this.
    const el = await mount('we-move-handle', { '--we-move-handle-color': 'red' });

    expect(el.style.getPropertyValue('--we-move-handle-color')).toBe('red');
  });

  it('removes a declaration it stops setting', async () => {
    const el = await mount('we-move-handle', { cursor: 'nwse-resize' });
    el.styles = {};
    await el.updateComplete;

    expect(el.style.getPropertyValue('cursor')).toBe('');
  });
});
