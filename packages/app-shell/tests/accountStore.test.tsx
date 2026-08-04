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
  localStorage.clear();
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

describe('the cache — what the screen can draw before IPC answers', () => {
  const cached = () => JSON.parse(localStorage.getItem('we:accounts') ?? '[]');

  it('seeds the list synchronously, so the whole screen paints on the first frame', () => {
    // The corner switcher reads `accounts` and the badge reads `activeAccount`. Both were empty
    // until the host answered, several frames after first paint — which is why the corner
    // disappeared and came back on every switch.
    localStorage.setItem('we:accounts', JSON.stringify(TWO));
    const { host } = stubHost(TWO);
    accountHost = host;

    const store = mount();

    expect(store.accounts()).toHaveLength(2);
    expect(store.activeAccount()?.name).toBe('Main');
    expect(store.hasOtherAccounts()).toBe(true);
  });

  it('starts empty with no cache, rather than throwing', () => {
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    expect(store.activeAccount()).toBeUndefined();
  });

  it('ignores a corrupt cache', () => {
    localStorage.setItem('we:accounts', 'not json');
    const { host } = stubHost(TWO);
    accountHost = host;
    expect(mount().accounts()).toEqual([]);
  });

  it('moves the active flag on the click, not on the landing', async () => {
    // The screen is a function of this list — centre badge is whoever is active, corner is
    // everyone else — so a target that is still inactive appears in both places at once.
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    const during: Array<string | undefined> = [];
    host.select = async () => {
      during.push(store.activeAccount()?.name);
      during.push(store.accounts().find((a) => !a.active)?.name);
    };

    await store.switchAccount('/cfg/agents/test-net');

    // Active is the target; the only inactive one left is the account being departed.
    expect(during).toEqual(['Test Net', 'Main']);
  });

  it('puts the truth back when the switch fails', async () => {
    const { host } = stubHost(TWO, {
      async select() {
        throw new Error('No such account');
      },
    });
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    await store.switchAccount('/cfg/agents/test-net');

    // The flag was moved on the assumption it would land; a refresh restores the host's view.
    expect(store.activeAccount()?.name).toBe('Main');
    expect(store.switchingTo()).toBeNull();
  });

  it('caches the moved flag as well as applying it', async () => {
    // The restart happens before any refresh could run. Caching the list as-is would have the
    // next document draw the account just left as current, and the target as one of the others.
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    await store.switchAccount('/cfg/agents/test-net');

    expect(cached().find((a: { active: boolean }) => a.active).name).toBe('Test Net');
  });

  it('makes a created account the active one in the cache', async () => {
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    await store.createAccount();

    const active = cached().filter((a: { active: boolean }) => a.active);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('New account');
  });

  it('stays current as the profile changes it', async () => {
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    host.list = async () => [{ ...TWO[0], name: 'Renamed' }, TWO[1]];
    await store.refresh();

    expect(cached().find((a: { active: boolean }) => a.active).name).toBe('Renamed');
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
  it('names the target account from the click, so the screen can show it immediately', async () => {
    // The switch tears the renderer down and rebuilds it. Without this the boot screen would show
    // the account being left behind, then blank, then the new one — three states for one act.
    const { host } = stubHost(TWO, {
      async select() {
        // Still mid-switch at this point.
        expect(store.switchingTo()?.name).toBe('Test Net');
      },
    });
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    expect(store.switchingTo()).toBeNull();
    await store.switchAccount('/cfg/agents/test-net');
  });

  it('holds the target even when the account list empties underneath it', async () => {
    // The target is stored, not derived from `accounts()`. Derived, it evaporated whenever the
    // list was empty or reloading — which is precisely what happens mid-switch — and the boot
    // screen fell through to the branch that means "a create is in progress".
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    const held: unknown[] = [];
    host.select = async () => {
      host.list = async () => [];
      await store.refresh();
      held.push(store.switchingTo()?.name, store.creating());
    };

    await store.switchAccount('/cfg/agents/test-net');

    expect(held).toEqual(['Test Net', false]);
  });

  it('distinguishes creating from switching, rather than inferring it from a missing target', async () => {
    const { host } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    const seen: unknown[] = [];
    host.create = async () => {
      seen.push(store.creating(), store.switchingTo());
      return { id: '/cfg/agents/new-account', name: 'New account', active: true };
    };

    await store.createAccount();

    expect(seen).toEqual([true, null]);
  });

  it('clears the target when the switch fails, so the screen returns to the form', async () => {
    const { host } = stubHost(TWO, {
      async select() {
        throw new Error('No such account');
      },
    });
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    await store.switchAccount('/cfg/agents/test-net');

    expect(store.switchingTo()).toBeNull();
    expect(store.error()).toBe('No such account');
  });

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

    // A listed account whose select rejects — the store now refuses an *unlisted* id before the
    // host sees it, so an unknown id would no longer exercise this path at all.
    await store.switchAccount('/cfg/agents/test-net');

    // The override replaces the recording `select`, so the point is what did NOT happen.
    expect(calls).not.toContain('apply');
    expect(store.error()).toBe('No such account');
    expect(store.switchingTo()).toBeNull();
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

describe('creating goes straight through', () => {
  it('does not wait on a confirmation step', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    // `creating` is observed mid-flight: in the app the process is gone by the time this
    // resolves, so the stub reaching the end is an artefact of the harness, not the flow.
    const seen: boolean[] = [];
    host.create = async () => {
      seen.push(store.creating());
      return { id: '/cfg/agents/new-account', name: 'New account', active: true };
    };

    await store.createAccount();

    expect(seen).toEqual([true]);
    expect(calls).toEqual(['apply']);
  });
});

describe('removal confirmation', () => {
  it('holds the account awaiting confirmation, and deletes it on confirm', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    store.requestRemoval('/cfg/agents/test-net');
    expect(store.pendingRemoval()?.name).toBe('Test Net');

    await store.confirmRemoval();

    expect(calls).toEqual(['remove:/cfg/agents/test-net', 'list']);
    expect(store.pendingRemoval()).toBeNull();
  });

  it('cancelling deletes nothing', async () => {
    const { host, calls } = stubHost(TWO);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));
    calls.length = 0;

    store.requestRemoval('/cfg/agents/test-net');
    store.cancelRemoval();

    expect(store.pendingRemoval()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('closes when the account disappears underneath it', async () => {
    // Derived from the list rather than stored, so a request cannot outlive what it names —
    // removed in another window, say.
    const { host } = stubHost([...TWO]);
    accountHost = host;
    const store = mount();
    await vi.waitFor(() => expect(store.accounts()).toHaveLength(2));

    store.requestRemoval('/cfg/agents/test-net');
    expect(store.pendingRemoval()).not.toBeNull();

    host.list = async () => [TWO[0]];
    await store.refresh();

    expect(store.pendingRemoval()).toBeNull();
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
