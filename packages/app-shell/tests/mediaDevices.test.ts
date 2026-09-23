/**
 * Listing capture devices, through the kernel rather than through `navigator`.
 *
 * A module that enumerates the user's hardware is doing something its manifest should be able to
 * declare, which is the whole argument for `getUserMedia` being on the kernel and applies here
 * unchanged. What this file pins is the part that is easy to get wrong in the other direction: the
 * states where there is nothing to report are ordinary, and a chooser must be able to draw them
 * without being handed an error.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createModuleStoreDeps } from '../src/shared/registries/moduleHostServices';

const deps = () =>
  createModuleStoreDeps({
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => void (value = next)];
    },
    effect: (fn: () => void) => fn(),
  });

const media = () => deps().kernels.media!;

/** Stand in for `navigator.mediaDevices`, which does not exist under Node. */
function withMediaDevices(value: unknown) {
  const host = globalThis as unknown as { navigator?: Record<string, unknown> };
  const had = !!host.navigator && 'mediaDevices' in host.navigator;
  const previous = host.navigator?.mediaDevices;
  if (!host.navigator) host.navigator = { mediaDevices: value };
  else host.navigator.mediaDevices = value;
  return () => {
    if (!host.navigator) return;
    if (had) host.navigator.mediaDevices = previous;
    else delete host.navigator.mediaDevices;
  };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('enumerating capture devices', () => {
  it('answers with nothing, rather than failing, on a host that cannot say', async () => {
    /*
      Three states arrive here and all three are ordinary: a machine with no capture hardware, a
      browser that has not been given permission, and a host with no `navigator` at all. The two
      *acquiring* calls on this kernel reject, and rightly — asking for a device and not getting one
      is a failure. Asking what there is and being told nothing is not, and an error would turn every
      one of those into a fault report on a screen whose honest answer is "no microphones found".
    */
    restore = withMediaDevices(undefined);
    await expect(media().enumerateDevices()).resolves.toEqual([]);

    restore();
    restore = withMediaDevices({
      enumerateDevices: () => Promise.reject(new Error('blocked')),
    });
    await expect(media().enumerateDevices(), 'a refusal is not a fault either').resolves.toEqual([]);
  });

  it('offers inputs only, narrowed to what a chooser reads', async () => {
    /*
      Outputs are dropped because nothing here routes playback — offering them would be a control
      that cannot be wired to anything. And the browser's own `MediaDeviceInfo` carries more than
      these four fields; passing it through would put a wider surface in front of every module than
      the kernel means to offer.
    */
    restore = withMediaDevices({
      enumerateDevices: async () => [
        { deviceId: 'mic-1', kind: 'audioinput', label: 'Headset', groupId: 'g1', toJSON: () => ({}) },
        { deviceId: 'cam-1', kind: 'videoinput', label: 'Webcam', groupId: 'g2', toJSON: () => ({}) },
        { deviceId: 'out-1', kind: 'audiooutput', label: 'Speakers', groupId: 'g1', toJSON: () => ({}) },
      ],
    });

    const found = await media().enumerateDevices();

    expect(found).toEqual([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Headset', groupId: 'g1' },
      { deviceId: 'cam-1', kind: 'videoinput', label: 'Webcam', groupId: 'g2' },
    ]);
  });

  it('keeps an anonymous device rather than hiding it', async () => {
    /*
      A label is empty until permission has been granted at least once — the browser withholds it so
      a page cannot fingerprint a machine by its hardware without asking. Dropping unnamed devices
      would make the list empty in exactly the state a first-run chooser is in; it has to draw them
      and say why they have no names.
    */
    restore = withMediaDevices({
      enumerateDevices: async () => [{ deviceId: 'mic-1', kind: 'audioinput', label: '', groupId: '' }],
    });

    const found = await media().enumerateDevices();

    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('');
  });
});

describe('watching for devices being plugged in', () => {
  it('reports a change, and stops when told to', () => {
    const listeners = new Map<string, () => void>();
    restore = withMediaDevices({
      addEventListener: (event: string, cb: () => void) => listeners.set(event, cb),
      removeEventListener: (event: string) => listeners.delete(event),
    });

    let seen = 0;
    const stop = media().onDevicesChanged(() => (seen += 1));
    listeners.get('devicechange')?.();
    expect(seen).toBe(1);

    stop();
    expect(listeners.has('devicechange'), 'the listener outlived its unsubscribe').toBe(false);
  });

  it('hands back an unsubscribe even where nothing can be watched', () => {
    // So a caller's teardown is the same shape either way and nothing has to test whether it got a
    // real subscription.
    restore = withMediaDevices(undefined);
    expect(() => media().onDevicesChanged(() => {})()).not.toThrow();
  });
});
