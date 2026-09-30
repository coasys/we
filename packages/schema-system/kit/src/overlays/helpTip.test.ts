/**
 * An explanation behind a glyph, and the three ways the obvious version of it silently fails.
 *
 * Each of these was found by looking at a rendered tooltip rather than at its schema: a paragraph
 * drawn as one line the width of the panel, a paragraph drawn permanently beside the trigger, and a
 * glyph a keyboard could never reach. None of them errors, so the recipe is what is asserted.
 */
import { describe, expect, it } from 'vitest';

import { helpTip } from './helpTip.ts';

type Node = { type: string; slot?: string; props?: Record<string, unknown>; children?: Node[] };

const tip = helpTip({ text: 'A model reads the transcript and writes what it finds.' }) as Node;
const [content, trigger] = tip.children as [Node, Node];

describe('a help tip', () => {
  it('puts the text in the content slot, carried by a native element', () => {
    // `slot` is spread onto whatever a node renders. A `Column` is a Solid function and drops it,
    // so the text lands in the *default* slot and renders as chrome beside the glyph.
    expect(content.type).toBe('div');
    expect(content.slot).toBe('content');
  });

  it('wraps, because the bubble itself does not', () => {
    // The tooltip is `white-space: nowrap` and that inherits into slotted content: a paragraph
    // without this is one line the width of the paragraph.
    const box = content.children?.[0] as Node;

    expect(box.props?.whiteSpace).toBe('normal');
    expect(box.props?.maxWidth).toBeDefined();
    expect(box.props?.textAlign).toBe('left');
  });

  it('is triggered by a button with a name, so it can be reached and read without a pointer', () => {
    // The tooltip opens on focus and points `aria-describedby` at the focusable thing inside it. A
    // bare icon is neither focusable nor named.
    expect(trigger.type).toBe('we-button');
    expect(trigger.props?.variant).toBe('bare');
    expect(typeof trigger.props?.label).toBe('string');
    expect((trigger.children?.[0] as Node).props?.name).toBe('info');
  });

  it('takes an expression, for a tip that depends on what is being shown', () => {
    const text = { $: "local.live ? 'Reads as you speak.' : 'Reads what was said.'" };
    const rich = helpTip({ text }) as Node;
    const paragraph = ((rich.children?.[0] as Node).children?.[0] as Node).children?.[0] as Node;

    expect(paragraph.children).toEqual([text]);
  });
});
