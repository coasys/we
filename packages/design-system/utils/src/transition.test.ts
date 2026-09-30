/**
 * `transition` resolves duration tokens.
 *
 * It was the last DS prop that bypassed the token system — a raw passthrough, so `transition: '300'`
 * emitted an unitless value the browser drops. Exactly the failure the offsets had, and invisible
 * for the same reason: the prop is typed `string` and '300' is a string, so neither typecheck nor
 * schema validation has anything to object to.
 *
 * What makes it worth resolving rather than just documenting: `--we-transition-*` is what a theme's
 * `animationSpeed` preset overrides, and 'instant' sets every one of them to 0ms. A duration written
 * as a token honours somebody's reduced-motion choice; one written as '300ms' quietly ignores it.
 */
import { describe, expect, it } from 'vitest';

import { buildLayoutStyles, parseTransition } from './index';

describe('parseTransition', () => {
  it('resolves a bare duration token', () => {
    expect(parseTransition('300')).toBe('var(--we-transition-300)');
  });

  it('resolves a token in the duration slot of a shorthand', () => {
    expect(parseTransition('width 300 ease-in-out')).toBe('width var(--we-transition-300) ease-in-out');
  });

  it('resolves both duration and delay', () => {
    expect(parseTransition('opacity 200 ease 100')).toBe(
      'opacity var(--we-transition-200) ease var(--we-transition-100)',
    );
  });

  it('handles each half of a comma-separated shorthand independently', () => {
    expect(parseTransition('width 300 ease, opacity 150ms linear')).toBe(
      'width var(--we-transition-300) ease, opacity 150ms linear',
    );
  });

  it('leaves real CSS durations alone', () => {
    expect(parseTransition('width 300ms ease-in-out')).toBe('width 300ms ease-in-out');
    expect(parseTransition('all 0.2s')).toBe('all 0.2s');
  });

  it('leaves anything that is not a token name alone', () => {
    // '250' is a real duration somebody might mean literally, but it is not a token, so it is
    // not ours to reinterpret — it stays wrong-and-visible rather than becoming silently right.
    expect(parseTransition('width 250 ease')).toBe('width 250 ease');
    expect(parseTransition('grid-template-rows 300 ease')).toBe('grid-template-rows var(--we-transition-300) ease');
  });

  it('normalises stray whitespace without changing meaning', () => {
    expect(parseTransition('  width   300   ease  ,  opacity 100 ')).toBe(
      'width var(--we-transition-300) ease, opacity var(--we-transition-100)',
    );
  });

  it('returns undefined for an absent value', () => {
    expect(parseTransition(undefined)).toBeUndefined();
    expect(parseTransition('')).toBeUndefined();
  });
});

describe('the transition DS prop', () => {
  it('goes through the parser', () => {
    expect(buildLayoutStyles({ transition: 'width 300 ease' } as never, 'column')).toMatchObject({
      transition: 'width var(--we-transition-300) ease',
    });
  });
});
