import { afterEach, describe, expect, it, vi } from 'vitest';

import { bridge, type GpuiBridge, invoke, listen } from './bridge';

const scope = globalThis as { __WE_GPUI__?: GpuiBridge };

afterEach(() => {
  delete scope.__WE_GPUI__;
});

describe('the GPUI bridge', () => {
  it('says so when the page is not in the shell', () => {
    expect(() => bridge({})).toThrow(/not running in the WE GPUI shell/i);
    expect(() => invoke('get_port')).toThrow(/__WE_GPUI__ is missing/);
  });

  it('passes a command and its arguments through, and the answer back', async () => {
    const calls: unknown[] = [];
    scope.__WE_GPUI__ = {
      invoke: async (cmd, args) => {
        calls.push([cmd, args]);
        return 12001;
      },
      listen: () => () => {},
    };
    await expect(invoke<number>('get_port')).resolves.toBe(12001);
    await invoke('select_account', { id: 'a' });
    expect(calls).toEqual([
      ['get_port', undefined],
      ['select_account', { id: 'a' }],
    ]);
  });

  it('subscribes and unsubscribes through the shell', () => {
    const unlisten = vi.fn();
    const listenSpy = vi.fn(() => unlisten);
    scope.__WE_GPUI__ = { invoke: async () => null, listen: listenSpy };
    const handler = vi.fn();
    const stop = listen('identity-step-done', handler);
    expect(listenSpy).toHaveBeenCalledWith('identity-step-done', handler);
    stop();
    expect(unlisten).toHaveBeenCalled();
  });
});
