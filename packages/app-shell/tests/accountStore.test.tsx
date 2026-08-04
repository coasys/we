/**
 * AccountStore: degradation on web, and the restart contract.
 *
 * The property that matters most is that every successful mutation ends in `applySelection()`.
 * Switching without it would leave the UI claiming one account while the executor holds another's
 * data open — the kind of divergence that looks like data loss to the person it happens to.
 */
import type { Account, AccountHost } from '@shared/platform/types';
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let accountHost: AccountHost | undefined;

vi.mock('../src/frameworks/solid/providers/PlatformProvider', () => ({
  usePlatform: () => ({ isDesktop: true, isDevelopment: true, accounts: accountHost }),
}));

import { type AccountStore, AccountStoreProvider, useAccountStore } from '../src/frameworks/solid/stores/AccountStore';

function mount(): AccountStore {
  let store!: AccountStore;
  function Capture() {
    store = useAccountStore();
    return null;
  }
  render(() => (
    <AccountStoreProvider>
      <Capture />
    </AccountStoreProvider>
  ));
  return store;
}

/** A host that records the order of what it was asked to do. */
function stubHost(accounts: Account[], overrides: Partial<AccountHost> = {}) {
  const calls: string[] = [];
  const host: AccountHost = {
    async list() {
      calls.push('list');
      return accounts;
    },
    async create() {
      calls.push('create');
      return { id: '/cfg/agents/new-account', name: 'New account', active: true };
    },
    async setDisplay(id, display) {
      calls.push(`display:${id}:${display.name ?? ''}:${display.avatar ?? ''}`);
    },
    async select(id) {
      calls.push(`select:${id}`);
    },
    async remove(id) {
      calls.push(`remove:${id}`);
    },
    async applySelection() {
      calls.push('apply');
    },
    ...overrides,
  };
  return { host, calls };
}

const TWO: Account[] = [
  { id: '/home/x/.ad4m', name: 'Main', active: true },
  { id: '/cfg/agents/test-net', name: 'Test Net', active: false },
];

beforeEach(() => {
  accountHost = undefined;
});

describe('when the host cannot manage accounts (web)', () => {
  it('reports the capability false and lists nothing', async () => {
    const store = mount();
    expect(store.canManageAccounts()).toBe(false);
    expect(store.accounts()).toEqual([]);
    expect(store.activeAccount()).toBeUndefined();
    expect(store.hasOtherAccounts()).toBe(false);
  });

  it('mutations no-op rather than throwing, so a mis-gated boot screen cannot crash', async () => {
    const store = mount();
    await store.createAccount();
    await store.switchAccount('/somewhere');
    await store.removeAccount('/somewhere');
    expect(store.error()).toBe('');
  });
});

describe('listing', () => {
  it('loads on mount and derives the active account', async () => {
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();

    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    expect(store.activeAccount()?.name).toBe('Main');
    expect(store.hasOtherAccounts()).toBe(true);
  });

  it('does not claim other accounts exist when there is only one', async () => {
    const { host } = stubHost([TWO[0]]);
    accountHost = host;
    const store = mount();

    await vi.waitFor(() => expect(store.accounts()).toHaveLength(1));
    expect(store.hasOtherAccounts()).toBe(false);
  });
});

describe('switching and creating always end in applySelection', () => {
  it('selects, then applies — in that order', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.switchAccount('/cfg/agents/test-net');

    expect(calls).toEqual(['select:/cfg/agents/test-net', 'apply']);
  });

  it('creates, then restarts — the name and identity are collected after the relaunch', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.createAccount();

    // No name is passed: the setup screen asks for it after the restart, so that first run and
    // adding an account reach the same page.
    expect(calls).toEqual(['create', 'apply']);
  });

  it('does not apply when switching to the account already running', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.switchAccount('/home/x/.ad4m');

    expect(calls).toEqual([]);
  });

  it('does not apply when the mutation failed', async () => {
    const { host, calls } = stubHost(TWO, {
      async select() {
        throw new Error('No such account');
      },
    });
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.switchAccount('/gone');

    expect(calls).toEqual([]);
    expect(store.error()).toBe('No such account');
    // Cleared on failure so the button returns to idle — on success the JS context is going away.
    expect(store.busy()).toBe(false);
  });
});

describe('syncDisplay — mirroring the profile onto the account', () => {
  it('writes the changed fields and reloads', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.syncDisplay({ name: 'Personal', avatar: 'data:image/png;base64,AAA' });

    expect(calls).toEqual(['display:/home/x/.ad4m:Personal:data:image/png;base64,AAA', 'list']);
  });

  it('sends only what changed, so editing one field cannot clear the other', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.syncDisplay({ name: 'Personal' });

    expect(calls).toEqual(['display:/home/x/.ad4m:Personal:', 'list']);
  });

  it('no-ops when nothing changed, or there is no host', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.syncDisplay({ name: 'Main' }); // already the active account's name
    await store.syncDisplay({}); // nothing at all
    expect(calls).toEqual([]);

    accountHost = undefined;
    const webStore = mount();
    await expect(webStore.syncDisplay({ name: 'Anything' })).resolves.toBeUndefined();
  });

  it('swallows a failure rather than failing the profile write that triggered it', async () => {
    // This runs as a side effect of publishing a profile. A stale label on the sign-in screen is
    // cosmetic; taking down the profile edit over it would trade a real thing for a label.
    const { host } = stubHost(TWO, {
      async setDisplay() {
        throw new Error('No such account');
      },
    });
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    await expect(store.syncDisplay({ name: 'Personal' })).resolves.toBeUndefined();
    expect(store.error()).toBe('');
  });
});

describe('removing', () => {
  it('removes and reloads the list, without applying', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.removeAccount('/cfg/agents/test-net');

    // No apply: the account removed is by definition not the one running.
    expect(calls).toEqual(['remove:/cfg/agents/test-net', 'list']);
  });

  it("surfaces the host's refusal to remove the active account", async () => {
    const { host } = stubHost(TWO, {
      async remove() {
        throw new Error('Cannot remove the account you are signed in to');
      },
    });
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    await store.removeAccount('/home/x/.ad4m');

    expect(store.error()).toBe('Cannot remove the account you are signed in to');
    expect(store.busy()).toBe(false);
  });
});
