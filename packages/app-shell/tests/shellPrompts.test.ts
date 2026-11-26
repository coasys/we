/**
 * The shell store's prompts part: the host's own screen picker, and the one confirmation every
 * destructive action a template names asks for — answered once, in its final words where the host
 * finds them out in time. Under each reactivity port.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { describeDestructive } from '../src/shared/destructiveWording';
import { createTestPlatform } from '../src/shared/platform/testPlatform';
import type { ScreenSource } from '../src/shared/platform/types';
import type { ShellStoreDeps } from '../src/shared/stores/ShellStore';
import { buildParts, reactivityPorts } from './support/shellPorts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.useRealTimers();
  });
  const build = (platform?: Pick<ShellStoreDeps['platform'], 'screenSources'>) => {
    const parts = buildParts(makePort(), { ...createTestPlatform(), ...platform });
    disposers.push(parts.dispose);
    return parts.prompts.members;
  };

  it('asks which screen to share when the host does, and answers it', () => {
    let ask: (sources: ScreenSource[]) => void = () => {};
    const chosen: string[] = [];
    const prompts = build({
      screenSources: {
        onRequest: (listener) => {
          ask = listener;
          return () => {};
        },
        choose: (id) => chosen.push(id),
      },
    });
    ask([{ id: 'screen:1', name: 'Entire screen', thumbnail: '' }]);
    expect(prompts.pendingScreenSources().map((source) => source.id)).toEqual(['screen:1']);
    prompts.chooseScreenSource('screen:1');
    expect(prompts.pendingScreenSources()).toEqual([]);
    expect(chosen).toEqual(['screen:1']);
  });

  it('resolves with the answer, and clears the question', async () => {
    const prompts = build();
    const answer = prompts.requestDestructive('spaceStore.deleteCollection', ['CollectionBlock', 'c1']);
    expect(prompts.pendingDestructive()).toMatchObject({ path: 'spaceStore.deleteCollection' });
    prompts.confirmDestructive();
    await expect(answer).resolves.toBe(true);
    expect(prompts.pendingDestructive()).toBe(null);
  });

  it('answers no to a question still open when a second is asked', async () => {
    const prompts = build();
    const first = prompts.requestDestructive('spaceStore.deleteCollection', ['CollectionBlock', 'c1']);
    const second = prompts.requestDestructive('spaceStore.deleteCollection', ['CollectionBlock', 'c2']);
    await expect(first).resolves.toBe(false);
    prompts.cancelDestructive();
    await expect(second).resolves.toBe(false);
  });

  it('waits for what a delete takes with it, and rewords a question asked without it only for news', async () => {
    const path = 'spaceStore.deleteCollection';
    const args = ['CollectionBlock', 'c1'];
    const prompts = build();
    void prompts.requestDestructive(path, args, Promise.resolve({ responses: 3 }));
    expect(prompts.pendingDestructive()).toBe(null);
    await flush();
    expect(prompts.pendingDestructive()?.body).toBe(describeDestructive(path, args, { responses: 3 }).body);
    prompts.cancelDestructive();

    vi.useFakeTimers();
    let late!: (facts: { responses?: number }) => void;
    void prompts.requestDestructive(path, args, new Promise((resolve) => (late = resolve)));
    vi.advanceTimersByTime(600);
    const asked = prompts.pendingDestructive();
    expect(asked?.body).toBe(describeDestructive(path, args).body);
    late({});
    await vi.advanceTimersByTimeAsync(0);
    expect(prompts.pendingDestructive()).toBe(asked);
  });
});
