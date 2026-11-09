/**
 * The check that stands between a guest link and somebody's real identity.
 *
 * Every case here was previously answered `false`, because the probe named the keys without the
 * version prefix ad4m-connect has written since April 2023. That is the reason the tests are
 * written against *prefixed* keys throughout, with the unprefixed spelling covered only as the
 * legacy case: a test built on the shape the bug assumed would have passed while the bug was live.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { hasStoredSession, rememberedSessionBase, storedGuestHost } from './storedSession';

const V = '0.13.0-test-interpretation-2/';
const HOST = 'https://node.example.org';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

function useStorage(store: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  useStorage(storage);
});

describe('hasStoredSession', () => {
  it('is false with nothing stored', () => {
    expect(hasStoredSession()).toBe(false);
  });

  it('finds a real session written under the version prefix', () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    storage.setItem(`${V}ad4m-url`, HOST);
    expect(hasStoredSession()).toBe(true);
  });

  it('finds a real session written without a prefix, as older builds wrote it', () => {
    storage.setItem('ad4m-token', 'tok');
    storage.setItem('ad4m-url', HOST);
    expect(hasStoredSession()).toBe(true);
  });

  it('does not count a guest session this flow created', () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    storage.setItem(`${V}ad4m-url`, HOST);
    storage.setItem(`${V}ad4m-guest-email-${HOST}`, 'guest-abc@flux.demo');
    expect(hasStoredSession()).toBe(false);
  });

  it('normalises the host the same way ad4m-connect does when it writes the marker', () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    storage.setItem(`${V}ad4m-url`, `${HOST.toUpperCase()}///`);
    storage.setItem(`${V}ad4m-guest-email-${HOST}`, 'guest-abc@flux.demo');
    expect(hasStoredSession()).toBe(false);
  });

  it('counts a token with no url at all — nothing says it is a guest', () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    expect(hasStoredSession()).toBe(true);
  });

  it('ignores an empty token', () => {
    storage.setItem(`${V}ad4m-token`, '');
    storage.setItem(`${V}ad4m-url`, HOST);
    expect(hasStoredSession()).toBe(false);
  });

  it('does not let a guest marker under one version excuse a session under another', () => {
    storage.setItem('0.12.0/ad4m-token', 'real');
    storage.setItem('0.12.0/ad4m-url', HOST);
    storage.setItem(`${V}ad4m-guest-email-${HOST}`, 'guest-abc@flux.demo');
    expect(hasStoredSession()).toBe(true);
  });

  it('is false when localStorage throws, as it does in some privacy configurations', () => {
    useStorage(
      new Proxy(
        {},
        {
          get() {
            throw new Error('access denied');
          },
        },
      ),
    );
    expect(hasStoredSession()).toBe(false);
  });
});

describe('storedGuestHost', () => {
  /*
    The inverse question, and the one a *reload* has to ask. `BackendInitResult.guest` lives as long
    as the tab, and `BootController` rewrites the URL — so every load after the first comes through
    the ordinary connector, which knew nothing about guests and treated one as a local user.
  */
  it('is null with nothing stored', () => {
    expect(storedGuestHost()).toBeNull();
  });

  it('names the host when the live session is a guest one', () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    storage.setItem(`${V}ad4m-url`, HOST);
    storage.setItem(`${V}ad4m-guest-email-${HOST}`, 'guest-abc@flux.demo');
    expect(storedGuestHost()).toBe(HOST);
  });

  it('is null for a real session, which is exactly when hasStoredSession is true', () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    storage.setItem(`${V}ad4m-url`, HOST);
    expect(storedGuestHost()).toBeNull();
    expect(hasStoredSession()).toBe(true);
  });

  it('never answers yes to both, whichever prefix the credentials are under', () => {
    // The two are built from the same parts precisely so they cannot disagree about what a guest
    // session looks like.
    storage.setItem('ad4m-token', 'tok');
    storage.setItem('ad4m-url', HOST);
    storage.setItem(`ad4m-guest-email-${HOST}`, 'guest-abc@flux.demo');
    expect(storedGuestHost()).toBe(HOST);
    expect(hasStoredSession()).toBe(false);
  });
});

/*
  Where a relaunch will go. ad4m-connect opens the executor it signed in to last, and when that one
  does not answer it draws its own connect screen: the base app asks this first, so a place that
  cannot be reached is its offline state instead.
*/
describe('rememberedSessionBase', () => {
  it('is null with nothing stored, and for a url with no token beside it', () => {
    expect(rememberedSessionBase()).toBeNull();
    storage.setItem(`${V}ad4m-url`, HOST);
    expect(rememberedSessionBase()).toBeNull();
  });

  it("is the executor a stored session is against, as ad4m-connect's http base", () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    storage.setItem(`${V}ad4m-url`, 'ws://10.0.2.2:12000');
    expect(rememberedSessionBase()).toBe('http://10.0.2.2:12000');
    storage.setItem(`${V}ad4m-url`, 'wss://node.example.org/');
    expect(rememberedSessionBase()).toBe('https://node.example.org');
    storage.setItem(`${V}ad4m-url`, HOST);
    expect(rememberedSessionBase()).toBe(HOST);
  });

  it("is ad4m-connect's default address for a token stored with no url", () => {
    storage.setItem(`${V}ad4m-token`, 'tok');
    expect(rememberedSessionBase()).toBe('http://localhost:12000');
    storage.setItem(`${V}ad4m-port`, '12100');
    expect(rememberedSessionBase()).toBe('http://localhost:12100');
  });

  it("reads the newest version's session where several versions left one", () => {
    storage.setItem('0.9.0/ad4m-token', 'old');
    storage.setItem('0.9.0/ad4m-url', 'https://old.example.org');
    storage.setItem('0.13.1-staging.6/ad4m-token', 'tok');
    storage.setItem('0.13.1-staging.6/ad4m-url', HOST);
    storage.setItem('0.10.2/ad4m-token', 'mid');
    storage.setItem('0.10.2/ad4m-url', 'https://mid.example.org');
    expect(rememberedSessionBase()).toBe(HOST);
  });

  it('is null where localStorage cannot be read', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('denied');
      },
      configurable: true,
    });
    expect(rememberedSessionBase()).toBeNull();
  });
});
