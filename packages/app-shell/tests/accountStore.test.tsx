/**
 * AccountStore: degradation on web, and the restart contract.
 *
 * The property that matters most is that every successful mutation ends in `restart()`. Switching
 * without relaunching would leave the UI claiming one account while the executor holds another's
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
    async create(name) {
      calls.push(`create:${name}`);
      return { id: `/cfg/agents/${name}`, name, active: true };
    },
    async select(id) {
      calls.push(`select:${id}`);
    },
    async remove(id) {
      calls.push(`remove:${id}`);
    },
    async restart() {
      calls.push('restart');
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
    await store.createAccount('Anything');
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

describe('switching and creating always end in a restart', () => {
  it('selects, then restarts — in that order', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.switchAccount('/cfg/agents/test-net');

    expect(calls).toEqual(['select:/cfg/agents/test-net', 'restart']);
  });

  it('creates, then restarts — the agent inside it is made after the relaunch', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.createAccount('Work');

    expect(calls).toEqual(['create:Work', 'restart']);
  });

  it('does not restart when switching to the account already running', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.switchAccount('/home/x/.ad4m');

    expect(calls).toEqual([]);
  });

  it('does not restart when the mutation failed', async () => {
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
    // Cleared on failure so the button returns to idle — on success the process is going away.
    expect(store.busy()).toBe(false);
  });

  it('rejects a blank name without calling the host', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.createAccount('   ');

    expect(calls).toEqual([]);
    expect(store.error()).toBe('An account name is required');
  });
});

describe('removing', () => {
  it('removes and reloads the list, without restarting', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    await store.removeAccount('/cfg/agents/test-net');

    // No restart: the account removed is by definition not the one running.
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
