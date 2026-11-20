/**
 * The guest mark of a tab. A reload of a guest tab has to stay a guest, a new tab has to start
 * clean, and a browser whose storage throws holds nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgetGuestHost, rememberGuestHost, storedGuestHost } from './storedSession';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the guest mark of a tab', () => {
  it('holds nothing until a guest connects', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    expect(storedGuestHost()).toBeNull();
  });

  it('keeps the host a guest connected to, until the guest disconnects', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    rememberGuestHost('https://node.example.org');
    expect(storedGuestHost()).toBe('https://node.example.org');
    forgetGuestHost();
    expect(storedGuestHost()).toBeNull();
  });

  it('is kept in the tab, never in localStorage, and carries no token', () => {
    const tab = memoryStorage();
    const local = memoryStorage();
    vi.stubGlobal('sessionStorage', tab);
    vi.stubGlobal('localStorage', local);
    rememberGuestHost('https://node.example.org');
    expect(local.length).toBe(0);
    expect(tab.length).toBe(1);
    expect(tab.getItem(tab.key(0)!)).toBe('https://node.example.org');
  });

  it('holds nothing where the storage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => rememberGuestHost('https://node.example.org')).not.toThrow();
    expect(storedGuestHost()).toBeNull();
    expect(() => forgetGuestHost()).not.toThrow();
  });
});
