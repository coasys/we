/**
 * A theme's typefaces: what is accepted, and that a face lives exactly as long as a theme on screen
 * carries it. The FontFace API is stubbed — jsdom has none — so these pin the bookkeeping, which is
 * the part that can leak a face or withdraw one still in use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyFontFaces, fontFaceProblem } from './fontFaces';
import { VT323 } from './retro/vt323';

describe('a face', () => {
  it('is a named font file in a data: URL', () => {
    expect(fontFaceProblem({ family: 'Bricolage', src: 'data:font/woff2;base64,AAAA' })).toBeNull();
    expect(fontFaceProblem(VT323)).toBeNull();
  });

  it('is refused when it would fetch or inject', () => {
    expect(fontFaceProblem({ family: 'X', src: 'https://fonts.example/x.woff2' })).not.toBeNull();
    expect(fontFaceProblem({ family: 'X', src: 'data:font/woff2;base64,AA) ; color: red' })).not.toBeNull();
    expect(fontFaceProblem({ family: "X'; }", src: 'data:font/woff2;base64,AAAA' })).not.toBeNull();
  });
});

describe('registering faces', () => {
  const added = new Set<unknown>();
  beforeEach(() => {
    added.clear();
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(public family: string) {}
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (f: unknown) => added.add(f), delete: (f: unknown) => added.delete(f) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a face while any theme on screen carries it, and withdraws it after', () => {
    const face = { family: 'Shared', src: 'data:font/woff2;base64,AAAA' };
    const a = document.createElement('div');
    const b = document.createElement('div');
    applyFontFaces(a, { fontFaces: [face] });
    applyFontFaces(b, { fontFaces: [face] });
    expect(added.size).toBe(1);

    applyFontFaces(a, {});
    expect(added.size).toBe(1);
    applyFontFaces(b, {});
    expect(added.size).toBe(0);
  });

  it('never registers a face it refuses', () => {
    applyFontFaces(document.createElement('div'), { fontFaces: [{ family: 'X', src: 'https://e.example/x' }] });
    expect(added.size).toBe(0);
  });
});
