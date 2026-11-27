/**
 * What `timeInput` leaves in the page. The page is faked in Node: `evaluate` runs the function against
 * a window that has the parts the probe uses, so the cleanup that matters (nothing of an attempt keeps
 * running after it) is checked without a browser.
 */
import { describe, expect, it, vi } from 'vitest';

import { readMark, timeInput, watchPage } from './probe.mjs';

/** A page whose `evaluate` and `waitForFunction` run in this process, against a window of fakes. */
function fakePage() {
  const observers = [];
  const listeners = [];
  const window = {
    addEventListener: (type, fn, { signal }) => {
      const entry = { type, fn, aborted: false };
      signal.addEventListener('abort', () => (entry.aborted = true));
      listeners.push(entry);
    },
  };
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }
    observe() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  const globals = {
    window,
    document: { body: {} },
    MutationObserver: FakeObserver,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
  };
  const run = (fn, arg) => {
    for (const [k, v] of Object.entries(globals)) vi.stubGlobal(k, v);
    try {
      return fn(arg);
    } finally {
      vi.unstubAllGlobals();
    }
  };
  return {
    window,
    observers,
    listeners,
    // Runs `fn` with the page's globals in place: what a callback of the page does after `evaluate` has returned.
    scoped: (fn) => run(fn),
    evaluate: async (fn, arg) => run(fn, arg),
    waitForFunction: async (fn, arg, { timeout }) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (run(fn, arg)) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('timeout');
    },
  };
}

const CHANGE = { selector: '.node', attribute: 'style' };
const hit = { target: { matches: () => true, classList: { contains: () => true } } };

describe('an input timed in the page', () => {
  it('leaves nothing running in the page when nothing changed', async () => {
    const page = fakePage();
    const t = await timeInput(page, { input: 'pointermove', change: CHANGE }, async () => {}, 30);
    expect(t).toBe(null);
    expect(page.observers.every((o) => !o.connected)).toBe(true);
    expect(page.listeners.every((l) => l.aborted)).toBe(true);
    expect(page.window.__spacesProbe.cleanups).toEqual({});
    expect(page.window.__spacesProbe.inputs).toEqual({});
  });

  it('leaves nothing running in the page when the input throws, and says so', async () => {
    const page = fakePage();
    await expect(
      timeInput(
        page,
        { input: 'pointermove', change: CHANGE },
        async () => {
          throw new Error('mouse gone');
        },
        30,
      ),
    ).rejects.toThrow('mouse gone');
    expect(page.observers.every((o) => !o.connected)).toBe(true);
    expect(page.listeners.every((l) => l.aborted)).toBe(true);
    expect(page.window.__spacesProbe.cleanups).toEqual({});
  });

  it('is not written to by a round that timed out, once the next round starts', async () => {
    // The result is read in a callback of the page, after `evaluate` has returned: the clock is fixed.
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const page = fakePage();
    // Round 1: the input is taken, the change never comes, and the wait times out.
    const first = timeInput(
      page,
      { input: 'pointermove', change: CHANGE },
      async () => page.listeners[0].fn({ timeStamp: 100 }),
      30,
    );
    expect(await first).toBe(null);
    // Round 2, the same kind of input: only its own observer may write its result.
    const second = timeInput(
      page,
      { input: 'pointermove', change: CHANGE },
      async () => {
        page.listeners[1].fn({ timeStamp: 900 });
        // The first round's observer sees the change too: it is disconnected, and what it does is lost.
        page.scoped(() => {
          page.observers[0].callback([hit]);
          page.observers[1].callback([hit]);
        });
      },
      500,
    );
    // The clock reads 1000: 1000 - 900, never 1000 - 100.
    const t = await second;
    now.mockRestore();
    expect(t).toBe(100);
  });

  it('gives an input a token of its own each time', async () => {
    const page = fakePage();
    await timeInput(page, { input: 'wheel', change: CHANGE }, async () => {}, 10);
    await timeInput(page, { input: 'wheel', change: CHANGE }, async () => {}, 10);
    expect(page.observers).toHaveLength(2);
  });
});

describe('a watch of the page', () => {
  // The page's own document stands in for the browser's. jsdom has no `checkVisibility`, so it gets
  // the part of it the probe asks: false for an element, or one under it, with `display: none`.
  // Chrome also answers false for a `display: contents` wrapper, so the stand-in does too.
  const page = { evaluate: async (fn, arg) => fn(arg) };
  const frames = () => new Promise((resolve) => setTimeout(resolve, 80));
  const hidden = (el) => el.style.display === 'none' || (el.parentElement ? hidden(el.parentElement) : false);
  Element.prototype.checkVisibility = function () {
    return this.style.display !== 'contents' && !hidden(this);
  };

  it('marks the frame a match is shown, not the frame it is mounted under display: none', async () => {
    document.body.innerHTML = '<div id="box" style="display:none"><span class="tag">Live</span></div>';
    await watchPage(page, 'shown', { selector: '.tag', texts: ['Live'], within: 5_000 });
    await frames();
    expect(await readMark(page, 'shown')).toBe(null);
    document.getElementById('box').style.display = 'block';
    await frames();
    expect(typeof (await readMark(page, 'shown'))).toBe('number');
  });

  it('marks gone when the last match is hidden but still mounted', async () => {
    document.body.innerHTML = '<div id="box"><span class="tag">Live</span></div>';
    await watchPage(page, 'away', { selector: '.tag', texts: ['Live'], gone: true, within: 5_000 });
    await frames();
    expect(await readMark(page, 'away')).toBe(null);
    document.getElementById('box').style.display = 'none';
    await frames();
    expect(typeof (await readMark(page, 'away'))).toBe('number');
  });

  it('counts text under a display: contents wrapper as shown', async () => {
    document.body.innerHTML = '<div style="display:contents"><span class="tag">Live</span></div>';
    await watchPage(page, 'wrapped', { texts: ['Live'], within: 5_000 });
    await frames();
    expect(typeof (await readMark(page, 'wrapped'))).toBe('number');
  });
});
