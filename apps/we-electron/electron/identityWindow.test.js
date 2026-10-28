/**
 * The identity window's life in the Electron app, as the Tauri app's `identity_open` runs it: one
 * window at a time, the step the main window asked for and no other, and a window closed mid-step
 * cancels it.
 */
import { describe, expect, it, vi } from 'vitest';

import { createIdentity, IDENTITY_PAGE, identityFile, isIdentityPage } from './identityWindow.js';

const READY = { screen: { screen: 'identity-ready', did: 'did:scid:coasys:1:Qm', keyId: 'd1' }, outcome: 'done' };
const WORDS = { screen: { screen: 'show-words', words: ['w1'] }, outcome: null };

function setup(answers = {}) {
  const calls = [];
  const custody = {
    call: vi.fn(async (method, params) => {
      calls.push([method, params]);
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(params) : answer;
    }),
  };
  const windows = [];
  const openWindow = ({ onClosed }) => {
    let destroyed = false;
    const win = {
      focus: vi.fn(),
      isDestroyed: () => destroyed,
      close: () => {
        if (destroyed) return;
        destroyed = true;
        onClosed();
      },
    };
    windows.push(win);
    return win;
  };
  const identity = createIdentity({ custody: () => custody, openWindow });
  return { identity, calls, windows };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** An answer custody holds back until the test lets it go. */
function held() {
  let release;
  const answer = new Promise((r) => (release = r));
  return { answer, release };
}

/** Answers the first call with `first` and every later one with `then`. */
function firstThen(first, then) {
  let calls = 0;
  return () => (calls++ === 0 ? first : then);
}

describe('the identity window', () => {
  it('runs the step the main window asked for, and resolves with how it ended once it closes', async () => {
    const { identity, calls, windows } = setup({ start: WORDS, step: READY });
    const outcome = identity.open({ kind: 'create' });
    expect(windows).toHaveLength(1);
    expect(identity.window()).toBe(windows[0]);

    // The window receives screens only; the outcome stays here.
    expect(await identity.start()).toEqual(WORDS.screen);
    expect(await identity.step({ kind: 'words-written' })).toEqual(READY.screen);
    await identity.finish();

    await expect(outcome).resolves.toBe('done');
    expect(calls).toEqual([
      ['start', { step: { kind: 'create' } }],
      ['step', { input: { kind: 'words-written' } }],
    ]);
    expect(identity.window()).toBeNull();
  });

  it('opens one window at a time: a second ask focuses it and starts nothing', async () => {
    const { identity, windows } = setup({ start: WORDS, cancel: null });
    const first = identity.open({ kind: 'create' });
    await expect(identity.open({ kind: 'add-device' })).resolves.toBe('cancelled');
    expect(windows).toHaveLength(1);
    expect(windows[0].focus).toHaveBeenCalled();
    // The step in the window is still the first one.
    await identity.start();
    windows[0].close();
    await expect(first).resolves.toBe('cancelled');
  });

  it('cancels the step in custody when the window closes before it ends', async () => {
    const { identity, calls, windows } = setup({ start: WORDS, cancel: null });
    const outcome = identity.open({ kind: 'create' });
    await identity.start();
    windows[0].close();
    await expect(outcome).resolves.toBe('cancelled');
    await flush();
    expect(calls.at(-1)).toEqual(['cancel', undefined]);
  });

  it('cancel ends the step and closes the window', async () => {
    const { identity, calls } = setup({ start: WORDS, cancel: null });
    const outcome = identity.open({ kind: 'create' });
    await identity.start();
    await identity.cancel();
    await expect(outcome).resolves.toBe('cancelled');
    expect(calls.map(([m]) => m)).toContain('cancel');
    expect(identity.window()).toBeNull();
  });

  it('a cancel answered after its window closed closes no window opened since', async () => {
    const cancel = held();
    const { identity, calls, windows } = setup({ start: WORDS, cancel: firstThen(cancel.answer, null) });
    const first = identity.open({ kind: 'create' });
    await identity.start();
    const cancelling = identity.cancel();
    windows[0].close();
    await expect(first).resolves.toBe('cancelled');

    const second = identity.open({ kind: 'add-device' });
    const started = identity.start();
    await flush();
    // Nor does its step start before that cancel is answered.
    expect(calls.filter(([m]) => m === 'start')).toHaveLength(1);
    cancel.release(null);
    await cancelling;
    await started;

    expect(windows).toHaveLength(2);
    expect(windows[1].isDestroyed()).toBe(false);
    expect(identity.window()).toBe(windows[1]);
    windows[1].close();
    await expect(second).resolves.toBe('cancelled');
  });

  it('an outcome answered after its window closed is not the next step’s', async () => {
    const failed = { screen: { screen: 'failed', message: 'no' }, outcome: 'failed' };
    const start = held();
    const { identity, calls, windows } = setup({ start: firstThen(start.answer, WORDS), cancel: null });
    const first = identity.open({ kind: 'create' });
    const startedFirst = identity.start();
    windows[0].close();
    await expect(first).resolves.toBe('cancelled');
    await flush();

    const second = identity.open({ kind: 'add-device' });
    expect(await identity.start()).toEqual(WORDS.screen);
    start.release(failed);
    await startedFirst;

    // The second step is unfinished, so closing its window still cancels it.
    windows[1].close();
    await expect(second).resolves.toBe('cancelled');
    await flush();
    expect(calls.filter(([m]) => m === 'cancel')).toHaveLength(2);
    expect(calls.at(-1)).toEqual(['cancel', undefined]);
  });

  it('the next step asks custody nothing until the closed one’s cancel is answered', async () => {
    const cancel = held();
    const { identity, calls, windows } = setup({ start: WORDS, cancel: firstThen(cancel.answer, null) });
    const first = identity.open({ kind: 'create' });
    await identity.start();
    windows[0].close();
    await expect(first).resolves.toBe('cancelled');

    identity.open({ kind: 'add-device' });
    const started = identity.start();
    await flush();
    // A cancel custody answers after the next start would end that step instead.
    expect(calls.map(([m]) => m)).toEqual(['start', 'cancel']);

    cancel.release(null);
    expect(await started).toEqual(WORDS.screen);
    expect(calls.map(([m]) => m)).toEqual(['start', 'cancel', 'start']);
    expect(calls.at(-1)).toEqual(['start', { step: { kind: 'add-device' } }]);
  });

  it('a step waiting on that cancel is never started once its own window closed', async () => {
    const cancel = held();
    const { identity, calls, windows } = setup({ start: WORDS, cancel: firstThen(cancel.answer, null) });
    identity.open({ kind: 'create' });
    await identity.start();
    windows[0].close();

    const second = identity.open({ kind: 'add-device' });
    const started = identity.start();
    windows[1].close();
    await expect(second).resolves.toBe('cancelled');
    cancel.release(null);

    await expect(started).rejects.toThrow('the identity window was closed');
    expect(calls.map(([m]) => m)).toEqual(['start', 'cancel', 'cancel']);
  });

  it('reports a failed step as failed', async () => {
    const failed = { screen: { screen: 'failed', message: 'no' }, outcome: 'failed' };
    const { identity } = setup({ start: failed });
    const outcome = identity.open({ kind: 'revoke', keyId: 'd2' });
    expect(await identity.start()).toEqual(failed.screen);
    await identity.finish();
    await expect(outcome).resolves.toBe('failed');
  });

  it('refuses a step it does not know, before any window opens', async () => {
    const { identity, windows } = setup();
    for (const step of [undefined, { kind: 'export-key' }, { kind: 'revoke' }, { kind: 'revoke', keyId: 2 }]) {
      await expect(identity.open(step)).rejects.toThrow('not an identity step');
    }
    expect(windows).toHaveLength(0);
  });

  it('starts nothing when no step was asked for', async () => {
    const { identity } = setup({ start: WORDS });
    await expect(identity.start()).rejects.toThrow('no step was asked for');
  });

  it('says so when the custody service is not running', async () => {
    const identity = createIdentity({ custody: () => null, openWindow: () => ({}) });
    await expect(identity.publicState()).rejects.toThrow('the custody service is not running');
    await expect(identity.open({ kind: 'create' })).rejects.toThrow('the custody service is not running');
  });
});

describe('where the identity window may go', () => {
  it('shows its own page and nothing else', () => {
    expect(isIdentityPage(IDENTITY_PAGE)).toBe(true);
    expect(isIdentityPage('we-identity://window/index.html#top')).toBe(true);
    for (const url of [
      'we-identity://window/other.html',
      'we-identity://elsewhere/index.html',
      'we-identity://window/index.html?step=export',
      'http://localhost:9080/identity/index.html',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isIdentityPage(url), url).toBe(false);
    }
  });

  it('serves files of its bundle folder only', () => {
    const dir = '/app/dist/identity';
    expect(identityFile('we-identity://window/index.html', dir)).toBe('/app/dist/identity/index.html');
    expect(identityFile('we-identity://window/assets/index-a1.js', dir)).toBe('/app/dist/identity/assets/index-a1.js');
    // A URL's own `..` is resolved before it is read, and stays inside.
    expect(identityFile('we-identity://window/../index.html', dir)).toBe('/app/dist/identity/index.html');
    expect(identityFile('we-identity://window/%2e%2e/%2e%2e/secret', dir)).toBe('/app/dist/identity/secret');
    for (const url of [
      // An escaped slash is not resolved by the URL, so it is the one that could climb out.
      'we-identity://window/assets/..%2f..%2f..%2fsecret',
      'we-identity://window/..%2fdist%2fsecret',
      'we-identity://other/index.html',
      'we-identity://window/',
      'we-identity://window/%zz',
      'http://window/index.html',
    ]) {
      expect(identityFile(url, dir), url).toBeNull();
    }
  });
});
