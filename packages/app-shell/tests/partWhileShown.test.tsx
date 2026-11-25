/**
 * A part's `whileShown`, as the frame drawing it calls it.
 *
 * A part fed by its module's store tells that store it is on screen. A part with a subject is told
 * which record the drawing is of — a call's page shows one call's Feed, and the module cannot read
 * the page's address — so the frame passes the placement's subject, follows it, and pairs every
 * `show` with a `hide` for the same record.
 */
import { createModuleStoreDeps } from '@shared/registries/moduleHostServices';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { PresentPart } from '@solid/components/PartFrame';
import { render } from '@solidjs/testing-library';
import { markAction, type ModuleDefinition } from '@we/module-shared';
import { solidReactivity } from '@we/reactivity-solid';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const host = { backend: 'ad4m', framework: 'solid' };
const storeDeps = createModuleStoreDeps({ signal: solidReactivity.signal, effect: (fn: () => void) => fn() });

function withWatcher() {
  const calls: unknown[][] = [];
  const definition: ModuleDefinition = {
    manifest: { id: 'watcher', name: 'Watcher' },
    contributes: {
      parts: {
        about: {
          node: { type: 'we-text' },
          subject: 'modules.watcher.current',
          whileShown: { show: 'watch', hide: 'unwatch' },
        },
        plain: { node: { type: 'we-text' }, whileShown: { show: 'watch', hide: 'unwatch' } },
      },
    },
    createStore: () => ({
      watch: markAction((...args: unknown[]) => void calls.push(['show', ...args]), 'show', { ambient: true }),
      unwatch: markAction((...args: unknown[]) => void calls.push(['hide', ...args]), 'hide', { ambient: true }),
    }),
  };
  moduleRegistry.register(definition, host, storeDeps);
  return calls;
}

afterEach(() => {
  moduleRegistry.unregister('watcher');
  vi.restoreAllMocks();
});

describe('a part told what it is shown for', () => {
  it('passes the placement’s subject to show and hide, and follows it when it changes', () => {
    const calls = withWatcher();
    const [subject, setSubject] = createSignal<unknown>('call-1');
    const { unmount } = render(() => <PresentPart part="watcher.about" subject={subject()} editing={false} />);
    expect(calls).toEqual([['show', 'call-1']]);

    setSubject('call-2');
    expect(calls).toEqual([
      ['show', 'call-1'],
      ['hide', 'call-1'],
      ['show', 'call-2'],
    ]);

    unmount();
    expect(calls.at(-1)).toEqual(['hide', 'call-2']);
    expect(calls.filter(([kind]) => kind === 'show')).toHaveLength(calls.filter(([kind]) => kind === 'hide').length);
  });

  it('calls a part with no subject with nothing, once each way, as before', () => {
    const calls = withWatcher();
    const { unmount } = render(() => <PresentPart part="watcher.plain" editing={false} />);
    expect(calls).toEqual([['show']]);
    unmount();
    expect(calls).toEqual([['show'], ['hide']]);
  });
});
