/**
 * What follows a settled pass, asked for by several callers at once.
 *
 * The transcriber asks when a pass settles, when it adopts a collection and when an extraction
 * finishes — on opening a call, at the same moment. Each ask reconciles the collection, which on
 * AD4M is a link query, a `has_child` check and full reads of every extracted type. Three asks were
 * two or three of all of that, running at once, for one answer.
 */
import {
  createModuleStoreDeps,
  provideModuleHostServices,
  resetModuleHostServices,
} from '@shared/registries/moduleHostServices';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => resetModuleHostServices());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function host() {
  const finish: (() => void)[] = [];
  const started: string[] = [];
  provideModuleHostServices({
    reconcileCollection: async (collectionId: string) => {
      started.push(collectionId);
      await new Promise<void>((resolve) => finish.push(resolve));
      return 0;
    },
  });
  const deps = createModuleStoreDeps({ signal: createSignal, effect: () => undefined });
  const passSettled = (collection: string) => deps.kernels.interpretation!.passSettled!(collection);
  return { finish, started, passSettled };
}

describe('passSettled', () => {
  it('reconciles once, and once more for everything asked while that ran', async () => {
    const h = host();

    const first = h.passSettled('call-1');
    const second = h.passSettled('call-1');
    const third = h.passSettled('call-1');
    await flush();
    expect(h.started).toEqual(['call-1']);

    let secondDone = false;
    void second.then(() => (secondDone = true));
    h.finish[0]();
    await first;
    await flush();
    // Asked while the first ran, so the first cannot answer it: one more starts after it.
    expect(secondDone).toBe(false);
    expect(h.started).toEqual(['call-1', 'call-1']);

    h.finish[1]();
    await Promise.all([second, third]);
    expect(h.started).toHaveLength(2);
  });

  it('settles two collections side by side', async () => {
    const h = host();

    void h.passSettled('call-1');
    void h.passSettled('call-2');
    await flush();

    expect(h.started).toEqual(['call-1', 'call-2']);
    h.finish.forEach((resolve) => resolve());
  });

  it('runs again for a call made after the last pass finished', async () => {
    const h = host();

    const first = h.passSettled('call-1');
    await flush();
    h.finish[0]();
    await first;

    const again = h.passSettled('call-1');
    await flush();
    expect(h.started).toEqual(['call-1', 'call-1']);
    h.finish[1]();
    await again;
  });
});
