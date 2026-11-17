/**
 * The first screen: work the opening screen does not need waits until it has drawn.
 */
import { createFirstScreen, firstScreenDrawn } from '@shared/firstScreen';
import {
  createModuleStoreDeps,
  provideModuleHostServices,
  resetModuleHostServices,
} from '@shared/registries/moduleHostServices';
import { describe, expect, it, vi } from 'vitest';

/** A plain cell in a signal's shape — the gate's own logic, without a framework. */
function cell<T>(initial: T): [() => T, (next: T) => void] {
  let value = initial;
  return [() => value, (next) => void (value = next)];
}

function gate(ceilingMs = 10_000) {
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const seen: unknown[] = [];
  const signal = <T>(initial: T) => {
    seen.push(initial);
    return cell(initial);
  };
  const screen = createFirstScreen({
    signal,
    ceilingMs,
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => void ((timer as { cleared: boolean }).cleared = true),
  });
  return { screen, timers, seen };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the first screen', () => {
  it('is open when nothing held it, so a host or a test that never boots waits on nothing', async () => {
    const { screen, timers } = gate();
    expect(screen.open()).toBe(true);
    await expect(screen.whenOpen()).resolves.toBeUndefined();
    expect(timers).toHaveLength(0);
  });

  it('holds from cold boot until the Feed’s first page is drawn', async () => {
    const { screen } = gate();
    screen.hold();
    const later = vi.fn();
    void screen.whenOpen().then(later);

    screen.waiting();
    screen.drawn();
    await settled();
    // Drawn, but the Feed on it is still reading: the work waits for the Feed rather than the frame.
    expect(screen.open()).toBe(false);
    expect(later).not.toHaveBeenCalled();

    screen.answered();
    await settled();
    expect(screen.open()).toBe(true);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('opens once the screen is drawn with nothing on it waiting, so a space without the Feed waits for nothing', async () => {
    const { screen } = gate();
    screen.hold();
    screen.drawn();
    expect(screen.open()).toBe(false);
    await settled();
    expect(screen.open()).toBe(true);
  });

  it('waits for the Feed that says it is reading in the same turn the screen is drawn', async () => {
    const { screen } = gate();
    screen.hold();
    screen.drawn();
    // The part mounts in the same pass the route does, after the host's call.
    screen.waiting();
    await settled();
    expect(screen.open()).toBe(false);
    screen.answered();
    expect(screen.open()).toBe(true);
  });

  it('opens at the ceiling when nothing ever answers, and clears the ceiling when something did', async () => {
    const stuck = gate(5000);
    stuck.screen.hold();
    stuck.screen.waiting();
    expect(stuck.timers).toHaveLength(1);
    expect(stuck.timers[0].ms).toBe(5000);
    stuck.timers[0].run();
    expect(stuck.screen.open()).toBe(true);

    const prompt = gate();
    prompt.screen.hold();
    prompt.screen.waiting();
    prompt.screen.answered();
    expect(prompt.timers[0].cleared).toBe(true);
  });

  it('holds once: a later space switch, or a second hold, does not close it again', async () => {
    const { screen } = gate();
    screen.hold();
    screen.waiting();
    screen.answered();
    screen.hold();
    screen.waiting();
    expect(screen.open()).toBe(true);
  });

  it('reads its state through the signal it was given, so an effect gated on it re-runs when it opens', () => {
    const { seen } = gate();
    expect(seen).toEqual([true]);
  });
});

describe('a module, while the first screen is coming up', () => {
  it('reads a call’s policy once the first screen is up, and hands the Feed the gate’s two calls', async () => {
    resetModuleHostServices();
    const { screen } = gate();
    const deps = createModuleStoreDeps({ signal: cell, effect: (fn) => fn(), firstScreen: screen });
    const config = vi.fn(async () => ({ servers: [] }));
    const stop = provideModuleHostServices({ call: { config } as never });

    screen.hold();
    deps.firstScreen?.waiting();
    const read = deps.kernels.call?.config();
    await settled();
    expect(config).not.toHaveBeenCalled();

    deps.firstScreen?.answered();
    await expect(read).resolves.toEqual({ servers: [] });
    expect(config).toHaveBeenCalledTimes(1);
    stop();
    resetModuleHostServices();
  });
});

describe('when the first screen is drawn', () => {
  const onScreen = (id: string) => (segment: string) => segment === id;

  it('is not the boot screen: before a space is chosen its collection is “known”, and that is not the space the address names', () => {
    // Recorded: the gate opened on this at 1.4 s, a second before the Feed asked for its first page.
    const boot = { templateId: 'home', rootLoaded: true, segments: ['space', 'b2888e14'] };
    expect(firstScreenDrawn({ ...boot, addresses: () => false })).toBe(false);
  });

  it('is the space the address names, once its collection is known', () => {
    const space = { templateId: 'coasys', segments: ['space', 'b2888e14', 'chat'], addresses: onScreen('b2888e14') };
    expect(firstScreenDrawn({ ...space, rootLoaded: false })).toBe(false);
    expect(firstScreenDrawn({ ...space, rootLoaded: true })).toBe(true);
    // The space before, still on screen while the switch to the addressed one lands.
    expect(firstScreenDrawn({ ...space, rootLoaded: true, addresses: onScreen('another') })).toBe(false);
  });

  it('is any template on an address that names no space, and nothing without a template', () => {
    const home = { rootLoaded: true, segments: [], addresses: () => false };
    expect(firstScreenDrawn({ ...home, templateId: 'home' })).toBe(true);
    expect(firstScreenDrawn({ ...home, templateId: undefined })).toBe(false);
  });
});
