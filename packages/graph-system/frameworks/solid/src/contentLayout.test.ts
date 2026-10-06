/**
 * A card's content through a change of shape.
 *
 * Text reflowed around a moving outline can only jump: a word hops between lines whenever the room at the
 * end of one crosses its width. It was reported as text sliding left as a circle became a rectangle, then
 * snapping back to the centre and jittering. So the content fades through the change instead of reflowing
 * through it, which is the convention for content that has to re-wrap inside a morphing container.
 */
import { describe, expect, it } from 'vitest';

import { contentLayout } from './GraphView.solid';

const morph = (at: number) => ({ cardShape: 'note', morph: { from: 'round', at } });

describe('contentLayout', () => {
  it('lays a resting card out as its own shape, fully visible', () => {
    expect(contentLayout({ cardShape: 'round' })).toEqual({ cardShape: 'round', opacity: 1 });
  });

  it('keeps the shape it is leaving for the first half and takes the one it is becoming for the second', () => {
    expect(contentLayout(morph(0)).cardShape).toBe('round');
    expect(contentLayout(morph(0.49)).cardShape).toBe('round');
    expect(contentLayout(morph(0.5)).cardShape).toBe('note');
    expect(contentLayout(morph(0.99)).cardShape).toBe('note');
  });

  it('is invisible where the layout switches, and fully visible at both ends', () => {
    // Each end is that shape's own resting layout at full opacity, so nothing jumps where the morph begins
    // or where it hands back to the resting card.
    expect(contentLayout(morph(0)).opacity).toBe(1);
    expect(contentLayout(morph(0.5)).opacity).toBe(0);
    expect(contentLayout(morph(1)).opacity).toBe(1);
  });

  it('fades out towards the switch and back in after it, without a step', () => {
    const opacities = Array.from({ length: 101 }, (_, i) => contentLayout(morph(i / 100)).opacity);
    opacities.slice(1).forEach((value, i) => {
      expect(Math.abs(value - opacities[i])).toBeLessThanOrEqual(0.04 + 1e-9);
      if (i + 1 <= 50) expect(value).toBeLessThanOrEqual(opacities[i]);
      else expect(value).toBeGreaterThanOrEqual(opacities[i]);
    });
  });
});
