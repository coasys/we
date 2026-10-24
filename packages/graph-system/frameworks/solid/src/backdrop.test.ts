/**
 * The canvas backdrop: that it is drawn in the canvas's coordinates, and that it gets out of the way
 * when the zoom packs it too tight to mean anything.
 */
import { describe, expect, it } from 'vitest';

import { backdropStyle } from './GraphView.solid';

describe('the canvas backdrop', () => {
  it('draws nothing unless asked', () => {
    expect(backdropStyle(undefined, { x: 0, y: 0, zoom: 1 })).toEqual({});
    expect(backdropStyle({ pattern: 'none' }, { x: 0, y: 0, zoom: 1 })).toEqual({});
  });

  it('moves with a pan and spreads with a zoom', () => {
    const style = backdropStyle({ gap: 20 }, { x: 13, y: -7, zoom: 2 });
    expect(style['background-size']).toBe('40px 40px');
    expect(style['background-position']).toBe('13px -7px');
  });

  it('is coloured from a role', () => {
    expect(backdropStyle({}, { x: 0, y: 0, zoom: 1 })['background-image']).toContain('var(--we-role-border)');
    expect(backdropStyle({ color: 'accent-soft' }, { x: 0, y: 0, zoom: 1 })['background-image']).toContain(
      'var(--we-role-accent-soft)',
    );
  });

  it('draws ruled lines on both axes', () => {
    const image = backdropStyle({ pattern: 'lines' }, { x: 0, y: 0, zoom: 1 })['background-image'];
    expect(image).toContain('to right');
    expect(image).toContain('to bottom');
  });

  it('fades out as the marks crowd together, and is gone before they wash the ground grey', () => {
    const at = (zoom: number) => backdropStyle({ gap: 24 }, { x: 0, y: 0, zoom })['background-image'] ?? '';
    expect(at(1)).toContain(' 100%, transparent');
    expect(at(0.5)).toMatch(/ \d{1,2}%, transparent/);
    expect(at(0.2)).toBe('');
  });
});
