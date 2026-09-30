import type { TransitionConfig } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import {
  buildTransitionCSS,
  hiddenOpacity,
  revealEffect,
  revealTrackProperty,
  transitionSpan,
} from '../src/transitionUtils';

describe('reveal effect', () => {
  it('animates grid-template-rows on the block axis', () => {
    expect(buildTransitionCSS({ type: 'reveal', duration: 300 })).toBe('grid-template-rows 300ms ease');
  });

  it('animates grid-template-columns on the inline axis', () => {
    expect(buildTransitionCSS({ type: 'reveal', duration: 200, axis: 'inline' })).toBe(
      'grid-template-columns 200ms ease',
    );
  });

  it('composes with fade, each property keeping its own timing', () => {
    const config: TransitionConfig = [
      { type: 'reveal', duration: 300 },
      { type: 'fade', duration: 180, easing: 'ease-out' },
    ];
    expect(buildTransitionCSS(config)).toBe('grid-template-rows 300ms ease, opacity 180ms ease-out');
  });

  it('does not imply a fade — a reveal alone leaves opacity at 1', () => {
    expect(hiddenOpacity({ type: 'reveal' })).toBe(1);
    expect(hiddenOpacity([{ type: 'reveal' }, { type: 'fade' }])).toBe(0);
  });

  it('finds the reveal wherever it sits in the array', () => {
    expect(revealEffect([{ type: 'fade' }, { type: 'reveal', axis: 'inline' }])?.axis).toBe('inline');
    expect(revealEffect({ type: 'fade' })).toBeUndefined();
  });

  it('takes the first reveal when there are several, rather than silently honouring the last', () => {
    const config: TransitionConfig = [
      { type: 'reveal', axis: 'block' },
      { type: 'reveal', axis: 'inline' },
    ];
    expect(revealEffect(config)?.axis).toBe('block');
  });

  it('defaults to the block axis', () => {
    expect(revealTrackProperty({ type: 'reveal' })).toBe('grid-template-rows');
  });
});

describe('transitionSpan', () => {
  it('reports the longest effect, not the first', () => {
    expect(
      transitionSpan([
        { type: 'fade', duration: 200 },
        { type: 'slide', duration: 700 },
      ]),
    ).toBe(700);
  });

  it('defaults an effect with no duration to 300ms', () => {
    expect(transitionSpan({ type: 'fade' })).toBe(300);
    expect(transitionSpan([{ type: 'fade' }, { type: 'slide', duration: 120 }])).toBe(300);
  });

  it('accepts a single effect as well as an array', () => {
    expect(transitionSpan({ type: 'reveal', duration: 450 })).toBe(450);
  });
});
