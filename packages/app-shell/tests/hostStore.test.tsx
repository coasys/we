/**
 * hostStore: a person's own place on a host (usage, leave, export, import, the held state) and the host
 * this computer runs (sign-ups, invites, people), over a fake host port. The store holds no token: the
 * port opens the session, and a fake tenant stands for it.
 */
import { render } from '@solidjs/testing-library';
import type { HostPort, TenantHostPort, TenantUsageView } from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const [ports, setPorts] = createSignal<{ hosts?: HostPort } | null>(null);
const [cloudUrl] = createSignal<string | null>('https://cloud.example.org');
const [did, setDid] = createSignal<string | null>('did:scid:coasys:1:QmScid');

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({ backendPorts: ports }),
}));
vi.mock('../src/frameworks/solid/stores/IdentityStore', () => ({
  useIdentityStore: () => ({ did, custody: () => ({ cloudUrl: cloudUrl() }) }),
}));

const saved: { name: string; type: string; bytes: number[] }[] = [];
let saveOutcome: 'saved' | 'cancelled' = 'saved';
vi.mock('@we/design-utils', () => ({
  saveFile: async (options: { name: string; type: string; content: () => Promise<Blob> }) => {
    if (saveOutcome === 'cancelled') return 'cancelled';
    const blob = await options.content();
    saved.push({ name: options.name, type: options.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] });
    return 'saved';
  },
}));

let picked: File | null = null;
vi.mock('../src/shared/pickFile', () => ({ pickFile: async () => picked }));

import { type HostStore, HostStoreProvider, useHostStore } from '../src/frameworks/solid/stores/HostStore';

const flush = () => new Promise((r) => setTimeout(r, 0));

const usage = (state: string): TenantUsageView => ({
  tenantId: 't1',
  didScid: 'did:scid:coasys:1:QmScid',
  state,
  activatedAt: 1,
  host: { name: 'Coasys cloud', runByCoasys: true, operatorDid: 'did:key:z6MkOp' },
  spaces: [
    { perspectiveUuid: 'p1', name: 'Garden', neighbourhoodUrl: 'neighbourhood://x', sharedWithOtherTenants: true },
  ],
  privatePerspectives: 2,
  storage: { usedBytes: 1_500_000, measuredAt: '2026-11-20T00:00:00Z' },
  aiRuns: { day: '2026-11-20', count: 1 },
  spend: { freeAccess: true, credits: null, rates: null, chargedSoFar: 0 },
});

const refuse = () => {
  throw new Error('RPC error 403: not-admitted: this tenant is held');
};

/** A host port that records what it was asked, with a tenant the test steers. */
function fakeHosts(options: { held?: boolean; multiUser?: boolean } = {}) {
  const calls: string[] = [];
  const dialled: string[] = [];
  const closed: string[] = [];
  const policy = {
    signup: 'no_one' as const,
    maxTenants: null,
    display: { name: 'My host', run_by_coasys: false },
    choiceNeeded: true,
  };
  const tenant = (url: string): TenantHostPort => {
    dialled.push(url);
    return {
      usage: async () => usage(options.held ? 'held' : 'active'),
      leave: async (keep) => {
        calls.push(`leave:${keep}`);
        return { kept: keep, removedPerspectives: 0, leftSharedPerspectives: 0, keyDestroyedAt: null };
      },
      exportFile: async () => {
        calls.push('export');
        return new Uint8Array([1, 2, 3]);
      },
      importFile: async (file) => {
        calls.push(`import:${file.length}`);
        if (options.held) refuse();
        return { linksWritten: 4, linksInvalid: 1, neighbourhoodUrls: [] };
      },
      close: () => void closed.push(url),
    };
  };
  const hosts: HostPort = {
    operator: {
      info: async () => ({
        multiUser: options.multiUser ?? true,
        signup: 'no_one',
        name: 'n',
        runByCoasys: false,
        full: false,
      }),
      policy: async () => policy,
      setPolicy: async (patch) => {
        calls.push(`signup:${patch.signup}`);
        return { ...policy, signup: patch.signup ?? policy.signup, choiceNeeded: false };
      },
      createInvite: async (days, note) => {
        calls.push(`invite:${days}:${note}`);
        return { inviteId: 'i1', secret: 'secret-code', expiresAt: 5 };
      },
      listInvites: async () => [
        { id: 'i1', createdAt: 1, expiresAt: 4_000_000_000, usedBy: null, revoked: false, note: 'for Sam' },
      ],
      revokeInvite: async (id) => {
        calls.push(`revoke:${id}`);
        return true;
      },
      tenants: async () => [
        {
          tenantId: 't9',
          didScid: 'did:scid:coasys:1:QmAbcdef',
          state: 'detached',
          createdAt: 1,
          activatedAt: 2,
          detachedAt: 3,
        },
      ],
      removeTenant: async (id) => {
        calls.push(`remove:${id}`);
        return true;
      },
    },
    tenant,
  };
  return { hosts, calls, dialled, closed };
}

function mount(): HostStore {
  let store!: HostStore;
  function Capture() {
    store = useHostStore();
    return null;
  }
  render(() => (
    <HostStoreProvider>
      <Capture />
    </HostStoreProvider>
  ));
  return store;
}

beforeEach(() => {
  setPorts(null);
  setDid('did:scid:coasys:1:QmScid');
  saved.length = 0;
  saveOutcome = 'saved';
  picked = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('hostStore as a tenant', () => {
  it('offers a host only where this computer can sign in to one as the person', () => {
    const store = mount();
    expect(store.canViewHost()).toBe(false);
    setPorts({ hosts: fakeHosts().hosts });
    expect(store.canViewHost()).toBe(true);
    setDid(null);
    expect(store.canViewHost()).toBe(false);
  });

  it('asks nothing of a host until the person looks at it, then reads the usage in words', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await flush();
    expect(f.dialled).toEqual([]);

    await store.openHost();
    expect(f.dialled).toEqual(['https://cloud.example.org']);
    expect(store.isCoasysCloud()).toBe(true);
    expect(store.usage()).toEqual({
      host: 'Coasys cloud',
      spend: 'Free during the closed beta',
      storage: '1.5 MB stored',
      aiRuns: '1 AI run today',
      spaces: [{ name: 'Garden', shared: 'Shared with other people on this host' }],
      privateSpaces: '2 private spaces',
    });
    expect(store.held()).toBe(false);
  });

  it('looks at a host at a typed address, and ends the session of the one before', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    await store.openHost(' https://other.example.org ');
    expect(f.dialled).toEqual(['https://cloud.example.org', 'https://other.example.org']);
    expect(f.closed).toEqual(['https://cloud.example.org']);
    expect(store.isCoasysCloud()).toBe(false);
  });

  it('shows the held state, and a refused call leaves it shown without an error', async () => {
    const f = fakeHosts({ held: true });
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    expect(store.held()).toBe(true);
    picked = new File([new Uint8Array(3)], 'x.json.gz');
    expect(await store.importData()).toBe(false);
    expect(store.held()).toBe(true);
    expect(store.error()).toBe('');
  });

  it('says in words when the host cannot be reached', async () => {
    const f = fakeHosts();
    f.hosts.tenant = () => ({
      usage: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      leave: async () => {
        throw new Error('x');
      },
      exportFile: async () => new Uint8Array(),
      importFile: async () => {
        throw new Error('x');
      },
      close: () => {},
    });
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    expect(store.error()).toBe("Can't reach cloud.example.org. Try again.");
    expect(store.held()).toBe(false);
    expect(store.usage()).toBeNull();
  });

  it('saves the export to a gzip file named for the host', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    expect(await store.exportData()).toBe(true);
    expect(saved).toEqual([{ name: 'cloud.example.org-export.json.gz', type: 'application/gzip', bytes: [1, 2, 3] }]);
    expect(store.notice()).toBe('Export saved');
  });

  it('does not say it saved when the person closed the save dialog', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    saveOutcome = 'cancelled';
    expect(await store.exportData()).toBe(false);
    expect(store.notice()).toBe('');
  });

  it('imports a file and counts what did not pass the signature check', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    expect(await store.importData()).toBe(false);
    expect(f.calls).toEqual([]);

    picked = new File([new Uint8Array(7)], 'x.json.gz');
    expect(await store.importData()).toBe(true);
    expect(f.calls).toEqual(['import:7']);
    expect(store.notice()).toBe('Imported 4 items. 1 did not pass the signature check.');
  });

  it('leaves keeping the data, and deleting it only when told to', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    expect(await store.leave(true, false)).toBe(true);
    expect(store.notice()).toBe('You left cloud.example.org. Your data stays there.');
    expect(store.usage()).toBeNull();

    await store.openHost();
    expect(await store.leave(false, false)).toBe(true);
    expect(store.notice()).toBe('You left cloud.example.org. Your data is deleted.');
    expect(f.calls).toEqual(['leave:true', 'leave:false']);
  });

  it('exports first when asked, and does not leave if the file was not saved', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();

    saveOutcome = 'cancelled';
    expect(await store.leave(false, true)).toBe(false);
    expect(f.calls).toEqual([]);

    saveOutcome = 'saved';
    expect(await store.leave(false, true)).toBe(true);
    expect(f.calls).toEqual(['export', 'leave:false']);
  });

  it('ends the session and forgets the host when the backend changes', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await store.openHost();
    setPorts({ hosts: fakeHosts().hosts });
    await flush();
    expect(f.closed).toEqual(['https://cloud.example.org']);
    expect(store.usage()).toBeNull();
  });
});

describe('hostStore as the operator', () => {
  it('offers Sign-ups and People only where the host takes more than one person', async () => {
    setPorts({ hosts: fakeHosts({ multiUser: false }).hosts });
    const store = mount();
    await flush();
    expect(store.canOperate()).toBe(false);

    setPorts({ hosts: fakeHosts().hosts });
    await flush();
    expect(store.canOperate()).toBe(true);
    expect(store.choiceNeeded()).toBe(true);
    expect(store.people()).toEqual([
      { id: 't9', label: 'Person Abcdef', state: 'Left', canRemove: true, since: expect.any(String) },
    ]);
    expect(store.invites()).toEqual([
      { id: 'i1', note: 'for Sam', status: 'Open', expires: expect.any(String), canRevoke: true },
    ]);
  });

  it('sets who may join, and the choice is no longer needed', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await flush();
    await store.setSignup('by_invite');
    expect(f.calls).toEqual(['signup:by_invite']);
    expect(store.policy()?.signup).toBe('by_invite');
    expect(store.choiceNeeded()).toBe(false);
  });

  it('makes an invite for a week and keeps its code to show once', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await flush();
    await store.createInvite('  for Sam ');
    expect(f.calls).toEqual(['invite:7:for Sam']);
    expect(store.newInvite()).toBe('secret-code');
  });

  it('revokes an invite and removes a person who left', async () => {
    const f = fakeHosts();
    setPorts({ hosts: f.hosts });
    const store = mount();
    await flush();
    await store.revokeInvite('i1');
    await store.removePerson('t9');
    expect(f.calls).toEqual(['revoke:i1', 'remove:t9']);
  });

  it('says in words when a call fails, and frees the controls', async () => {
    const f = fakeHosts();
    f.hosts.operator.setPolicy = async () => {
      throw new Error('boom');
    };
    setPorts({ hosts: f.hosts });
    const store = mount();
    await flush();
    await store.setSignup('anyone');
    expect(store.operatorError()).toBe('That did not work. Try again.');
    expect(store.operatorBusy()).toBe(false);
  });
});
