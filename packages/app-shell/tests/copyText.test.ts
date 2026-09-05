/**
 * Copying, in the contexts the app actually runs in.
 *
 * `navigator.clipboard` is secure-context only, so it is simply absent when WE is served over plain
 * HTTP at a LAN address — which is the one setup where a guest link can be generated. Every copy
 * control reported "Could not copy the link" there, and the failure is invisible in development
 * because localhost *is* a secure context. These tests are the only place that difference is
 * expressible.
 */
import { copyText } from '@shared/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');

function setClipboard(value: unknown) {
  Object.defineProperty(globalThis.navigator, 'clipboard', { value, configurable: true, writable: true });
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard);
  else setClipboard(undefined);
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses the async clipboard API where there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    // The legacy path leaves a textarea and moves focus; it must not run when it is not needed.
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back when the page is not a secure context', async () => {
    // What a browser actually gives you on http://192.168.1.20:3000 — the property is not there at
    // all, so the old code threw a TypeError and reported it as a clipboard failure.
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    expect(await copyText('hello')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('falls back when the clipboard API rejects', async () => {
    // A denied permission, or a document that is not focused. Still worth trying the other route.
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;

    expect(await copyText('hello')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('reports failure when neither route works, rather than claiming success', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);

    expect(await copyText('hello')).toBe(false);
  });

  it('leaves no textarea behind and restores focus', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(true);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    await copyText('hello');

    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});
