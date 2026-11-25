/**
 * The dock layout's recorded vectors — what a second host implements the layout against — replayed
 * against the kernel, so a change that alters an answer fails here until the vectors are recorded
 * again (`pnpm --filter @we/app-shell record:kernels`) and the diff is reviewed as the behaviour change
 * it is. And the list itself: every function the kernel names has vectors, and every vector names a
 * function the kernel still has.
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { type AppFrame, DEFAULT_APP_FRAME, setGeometryFrame } from '../src/shared/dockGeometry';
import * as dockLayout from '../src/shared/kernels/dockLayout';

interface Vector {
  name: string;
  fn: string;
  args: unknown[];
  frame?: AppFrame;
  absent?: number[];
  output: unknown;
}

const vectors = JSON.parse(
  readFileSync(new URL('../src/shared/kernels/vectors/dockLayout.json', import.meta.url), 'utf8'),
) as Vector[];
const kernel = dockLayout as unknown as Record<string, (...args: unknown[]) => unknown>;

afterEach(() => setGeometryFrame(DEFAULT_APP_FRAME));

describe('the dock layout kernel', () => {
  it('has vectors for every function it names, and names every function a vector asks', () => {
    const named = Object.keys(kernel).sort();
    const asked = [...new Set(vectors.map((vector) => vector.fn))].sort();
    expect(asked).toEqual(named);
  });

  it('has no two vectors of the same name', () => {
    const names = vectors.map((vector) => vector.name);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });
});

describe('the recorded vectors', () => {
  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    setGeometryFrame(vector.frame ?? DEFAULT_APP_FRAME);
    const args = vector.args.map((arg, index) => (vector.absent?.includes(index) ? undefined : arg));
    const answer = kernel[vector.fn](...args);
    expect(answer === undefined ? null : JSON.parse(JSON.stringify(answer))).toEqual(vector.output);
  });
});
