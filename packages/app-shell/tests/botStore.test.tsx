/**
 * botStore: what it reads from the backend's bot port, the grant it sends (whole, with the version it
 * replaces), what it does when another change came first, paging the activity log, and that the
 * bot's credential is shown once and let go, when dismissed or when the person leaves its page.
 */
import { render } from '@solidjs/testing-library';
import {
  type BotActivityView,
  BotGrantConflict,
  type BotGrantInput,
  type BotPort,
  type BotView,
  type IdentityChange,
  NO_IDENTITY_CAPABILITIES,
} from '@we/backend-shared';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activityRow, botRow, draftEnds, draftOf, draftProblem, grantInput, grantSpaces } from '../src/shared/botRows';

const OWNER = 'did:scid:coasys:1:QmScid';
const BOT = 'did:key:z6MkBot';
// A grant names a space by its shared id, what `Space.url` holds.
const SHARED = 'QmShared';
const SWAP = 'QmSwap';

const [ports, setPorts] = createSignal<{ identity?: { bots?: BotPort } } | null>(null);
const [holdsMaster, setHoldsMaster] = createSignal(true);
const [shellPage, setShellPage] = createSignal<string | null>('/bots');
const opened: IdentityChange[] = [];
// What the identity change answers, and what the identity store then says went wrong.
let changeOutcome: 'done' | 'cancelled' | 'failed' = 'done';
let changeError = '';
// What a finished key revoke does to the bot as the port reads it.
let onChange: (change: IdentityChange) => void = () => undefined;

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({
  useSessionStore: () => ({
    backendPorts: ports,
    identityCapabilities: () => ({ ...NO_IDENTITY_CAPABILITIES, bots: !!ports()?.identity?.bots }),
  }),
}));

vi.mock('../src/frameworks/solid/stores/IdentityStore', () => ({
  useIdentityStore: () => ({
    did: () => OWNER,
    keyLog: () => [],
    keyLogLoaded: () => true,
    canChange: () => true,
    custody: () => ({ holdsMaster: holdsMaster() }),
    error: () => changeError,
    open: async (change: IdentityChange) => {
      opened.push(change);
      if (changeOutcome === 'done') onChange(change);
      return changeOutcome;
    },
  }),
}));

vi.mock('../src/frameworks/solid/stores/ShellStore', () => ({
  useShellStore: () => ({ shellPage }),
}));

vi.mock('../src/frameworks/solid/stores/SpaceStore', () => ({
  useSpaceStore: () => ({
    mySpaces: () => [
      { uuid: 'p-personal', url: null, name: 'Notes' },
      { uuid: 'p-shared', url: 'QmShared', name: 'Garden club' },
      { uuid: 'p-swap', url: 'QmSwap', name: 'Seed swap' },
    ],
  }),
}));

import { BOT_LOG_PAGE, type BotStore, BotStoreProvider, useBotStore } from '../src/frameworks/solid/stores/BotStore';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

function view(over: Partial<BotView['grant']> = {}): BotView {
  return {
    did: BOT,
    name: 'Test bot',
    owner: OWNER,
    createdAt: 1_760_000_000,
    grant: { spaces: [], can: [], expires: null, state: 'active', version: 1, updatedAt: 1, ...over },
    key: { keyId: 'd3', verdict: 'valid', can: ['read', 'write'], expires: 1_790_000_000 },
  };
}

/** A bot port that keeps one grant the way a backend does: whole, versioned, revoked for good. */
function fakePort(entries: BotActivityView[] = []) {
  let bot = view();
  const sent: BotGrantInput[] = [];
  const logAsked: Array<{ before?: number; limit?: number }> = [];
  const port: BotPort = {
    list: async () => [bot],
    grant: async () => bot,
    create: async () => ({
      did: BOT,
      owner: OWNER,
      matchCode: 'R7K Q2M',
      expires: 1_760_000_300,
      token: 'throwaway-token',
    }),
    async setGrant(_did, grant) {
      sent.push(grant);
      if (bot.grant.state === 'revoked')
        throw new BotGrantConflict('revoked', "This bot was removed, so its permissions can't change.");
      if (grant.version !== bot.grant.version) {
        throw new BotGrantConflict(
          'version',
          'These permissions changed while you were editing. Showing the latest.',
          bot.grant.version,
        );
      }
      bot = { ...bot, grant: { ...grant, version: bot.grant.version + 1, updatedAt: 2 } };
      return bot;
    },
    async log(_did, page = {}) {
      logAsked.push(page);
      const older = entries.filter((e) => page.before === undefined || e.id < page.before);
      return older.slice(0, page.limit ?? 50);
    },
  };
  /** Another window's change, made behind this one's back. */
  const elsewhere = (grant: Partial<BotView['grant']>) => {
    bot = { ...bot, grant: { ...bot.grant, ...grant, version: bot.grant.version + 1 } };
  };
  const revokeKey = () => {
    if (bot.key) bot = { ...bot, key: { ...bot.key, verdict: 'revoked' } };
  };
  const withoutKey = () => {
    bot = { ...bot, key: null };
  };
  return { port, sent, logAsked, elsewhere, revokeKey, withoutKey, current: () => bot };
}

function mount(): BotStore {
  let store!: BotStore;
  function Capture() {
    store = useBotStore();
    return null;
  }
  render(() => (
    <BotStoreProvider>
      <Capture />
    </BotStoreProvider>
  ));
  return store;
}

const entry = (id: number, allowed: boolean): BotActivityView => ({
  id,
  at: 1_760_000_000 + id,
  method: 'records.write',
  action: 'write',
  space: allowed ? SHARED : 'QmOther',
  reason: allowed ? 'Summarise the call' : null,
  allowed,
  refusal: allowed ? null : 'bot-grant',
});

beforeEach(() => {
  setPorts(null);
  setHoldsMaster(true);
  setShellPage('/bots');
  opened.length = 0;
  changeOutcome = 'done';
  changeError = '';
  onChange = () => undefined;
});

describe('botStore', () => {
  it('is off, and lists nothing, on a backend that runs no bots', async () => {
    setPorts({ identity: {} });
    const store = mount();
    await settle();
    expect(store.available()).toBe(false);
    expect(store.canAdd()).toBe(false);
    expect(store.bots()).toEqual([]);
  });

  it('lists the bots, worded, and offers "Add a bot" only where the master key is kept', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    expect(store.loaded()).toBe(true);
    expect(store.bots()).toHaveLength(1);
    expect(store.bots()[0]).toMatchObject({ name: 'Test bot', status: 'Active', paused: false, revoked: false });
    expect(store.bots()[0].grantLine).toBe('No permissions yet');
    expect(store.canAdd()).toBe(true);
    setHoldsMaster(false);
    expect(store.canAdd()).toBe(false);
  });

  it('asks for the bot key as an identity change', async () => {
    setPorts({ identity: { bots: fakePort().port } });
    const store = mount();
    await store.addBot();
    expect(opened).toEqual([{ kind: 'add-bot' }]);
  });

  it('shows the match code and the credential once, and lets the credential go', async () => {
    setPorts({ identity: { bots: fakePort().port } });
    const store = mount();
    await settle();
    expect(await store.create('', 'Test bot')).toBe(false);
    expect(store.createError()).toContain('Paste the setup code');
    expect(await store.create('coasys:offer:1:x', ' Test bot ')).toBe(true);
    expect(store.created()).toMatchObject({ name: 'Test bot', matchCode: 'R7K Q2M', token: 'throwaway-token' });
    store.dismissCreated();
    expect(store.created()).toBeNull();
    expect(JSON.stringify(store.bots())).not.toContain('throwaway-token');
  });

  it('lets the credential go when the person leaves the page it was shown on', async () => {
    setPorts({ identity: { bots: fakePort().port } });
    const store = mount();
    await settle();
    expect(await store.create('coasys:offer:1:x', 'Test bot')).toBe(true);
    // Still on the page that made it: the person can read and copy it.
    expect(store.created()?.token).toBe('throwaway-token');
    setShellPage('/account');
    expect(store.created()).toBeNull();

    // Closing the overlay is leaving it too.
    setShellPage('/bots');
    expect(await store.create('coasys:offer:1:x', 'Test bot')).toBe(true);
    expect(store.created()?.token).toBe('throwaway-token');
    setShellPage(null);
    expect(store.created()).toBeNull();
  });

  describe('a create that resolves after the person left the page', () => {
    /** A port whose create waits until the test answers it. */
    function slowCreate() {
      const fake = fakePort();
      let answer!: () => void;
      let lists = 0;
      const port: BotPort = {
        ...fake.port,
        list: async () => {
          lists++;
          return fake.port.list();
        },
        create: () =>
          new Promise((resolve) => {
            answer = () =>
              resolve({
                did: BOT,
                owner: OWNER,
                matchCode: 'R7K Q2M',
                expires: 1_760_000_300,
                token: 'late-token',
              });
          }),
      };
      return { port, answer: () => answer(), lists: () => lists };
    }

    const cases: Array<[string, () => void]> = [
      ['goes to another page', () => setShellPage('/account')],
      ['closes the overlay', () => setShellPage(null)],
      [
        'goes away and comes back',
        () => {
          setShellPage('/account');
          setShellPage('/bots');
        },
      ],
    ];

    it.each(cases)('keeps the credential out of sight when the person %s', async (_name, leave) => {
      const slow = slowCreate();
      setPorts({ identity: { bots: slow.port } });
      const store = mount();
      await settle();
      const listsBefore = slow.lists();

      const pending = store.create('coasys:offer:1:x', 'Test bot');
      leave();
      slow.answer();
      expect(await pending).toBe(false);
      await settle();

      expect(store.created()).toBeNull();
      expect(store.creating()).toBe(false);
      expect(store.createError()).toContain('credential could be shown');
      // The bot exists on the backend, so the list is read again and shows it.
      expect(slow.lists()).toBeGreaterThan(listsBefore);
      expect(store.bots().map((b) => b.did)).toEqual([BOT]);
      expect(JSON.stringify(store.bots())).not.toContain('late-token');
    });
  });

  it('edits the grant as a draft over the person’s spaces and sends it whole, with its version', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    await settle();
    // A personal space is not offered: a bot cannot reach it.
    expect(store.editor()?.spaces.map((s) => [s.id, s.name, s.checked])).toEqual([
      [SHARED, 'Garden club', false],
      [SWAP, 'Seed swap', false],
    ]);
    // The key may not join: the grant cannot give it.
    expect(store.editor()?.actions.find((a) => a.action === 'join')?.allowed).toBe(false);
    expect(store.editor()?.changed).toBe(false);

    store.toggleSpace(SHARED);
    store.toggleAction('write');
    store.toggleAction('read');
    store.setDays('30');
    expect(store.editor()?.changed).toBe(true);
    expect(store.editor()?.problem).toBe('');
    expect(await store.saveGrant()).toBe(true);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ spaces: [SHARED], can: ['read', 'write'], state: 'active', version: 1 });
    expect(fake.sent[0].expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86_400);
    expect(store.selected()?.grantLine).toMatch(/^1 space · read, write · until /);
    expect(store.editor()?.changed).toBe(false);
  });

  it('counts a state that differs from the grant as read as a change', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    expect(store.editor()?.changed).toBe(false);
    // Paused elsewhere and read again without the draft being reset: saving it would resume it.
    fake.elsewhere({ state: 'paused' });
    await store.refresh();
    expect(store.selected()?.paused).toBe(true);
    expect(store.editor()?.changed).toBe(true);
    store.resetDraft();
    expect(store.editor()?.changed).toBe(false);
  });

  it('refuses to save a grant beyond the key, before asking', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    store.toggleAction('join');
    expect(store.editor()?.problem).toContain("This bot can't join");
    expect(await store.saveGrant()).toBe(false);
    expect(fake.sent).toEqual([]);
  });

  it('on a version conflict, reads the grant again, shows it as it is now, and says so', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    store.toggleSpace(SWAP);
    // Another window gives it the shared space first.
    fake.elsewhere({ spaces: [SHARED], can: ['read'] });
    expect(await store.saveGrant()).toBe(false);
    expect(fake.sent[0].version).toBe(1);
    expect(store.conflict()).toContain('changed while you were editing');
    expect(
      store
        .editor()
        ?.spaces.filter((s) => s.checked)
        .map((s) => s.id),
    ).toEqual([SHARED]);
    // Saving again names the version it now replaces.
    store.toggleSpace(SWAP);
    expect(await store.saveGrant()).toBe(true);
    expect(fake.sent[1]).toMatchObject({ spaces: [SHARED, SWAP], version: 2 });
    expect(store.conflict()).toBe('');
  });

  it('pauses and resumes from the grant as read, keeping an edit in progress unsent', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    fake.elsewhere({ spaces: [SHARED], can: ['read'] });
    store.toggleSpace(SWAP);
    expect(await store.pause()).toBe(true);
    // The pause carried the grant as it is now, not the unsaved edit, and did not conflict.
    expect(fake.sent[0]).toMatchObject({ spaces: [SHARED], state: 'paused', version: 2 });
    expect(store.selected()).toMatchObject({ status: 'Paused', paused: true });
    expect(await store.resume()).toBe(true);
    expect(fake.sent[1]).toMatchObject({ state: 'active', version: 3 });
    expect(store.selected()?.status).toBe('Active');
  });

  it('does not carry an edit over a pause when the grant changed elsewhere meanwhile', async () => {
    /*
      Window A edits a broad grant; window B removes `write` and a space. A pauses: the pause
      carries B's grant (right), but A's old draft must not come back with the new version, or
      a later Save restores what B removed without any conflict.
    */
    const fake = fakePort();
    fake.elsewhere({ spaces: [SHARED, SWAP], can: ['read', 'write'] });
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    store.setDays('30');
    // B narrows the grant behind A's back.
    fake.elsewhere({ spaces: [SHARED], can: ['read'] });
    expect(await store.pause()).toBe(true);
    expect(fake.sent[0]).toMatchObject({ spaces: [SHARED], can: ['read'], state: 'paused' });
    // A is told, and sees the grant as it is now, not the draft it started from.
    expect(store.conflict()).toContain('changed while you were editing');
    expect(
      store
        .editor()
        ?.spaces.filter((s) => s.checked)
        .map((s) => s.id),
    ).toEqual([SHARED]);
    expect(await store.resume()).toBe(true);
    expect(await store.saveGrant()).toBe(true);
    // Nothing B removed comes back.
    const saved = fake.sent[fake.sent.length - 1];
    expect(saved.spaces).toEqual([SHARED]);
    expect(saved.can).toEqual(['read']);
  });

  it('revokes for good: a later change is refused and the grant is shown as revoked', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    expect(await store.revoke()).toBe(true);
    expect(store.selected()).toMatchObject({ status: 'Removed', revoked: true });
    expect(await store.resume()).toBe(false);
    expect(store.conflict()).toContain('removed');
    expect(fake.current().grant.state).toBe('revoked');
  });

  it("removing also revokes the bot's key in the key log, through the identity change", async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    onChange = (change) => {
      if (change.kind === 'revoke') fake.revokeKey();
    };
    const store = mount();
    await settle();
    await store.select(BOT);
    expect(await store.revoke()).toBe(true);
    expect(opened).toEqual([{ kind: 'revoke', keyId: 'd3' }]);
    expect(fake.current().grant.state).toBe('revoked');
    expect(fake.current().key?.verdict).toBe('revoked');
    expect(store.keyRevokeError()).toBe('');
    expect(store.selected()).toMatchObject({ revoked: true, keyStillValid: false });
  });

  it('says the key is still valid when revoking it fails, and retries only the key', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    onChange = (change) => {
      if (change.kind === 'revoke') fake.revokeKey();
    };
    const store = mount();
    await settle();
    await store.select(BOT);
    changeOutcome = 'failed';
    changeError = 'The key service did not answer.';
    expect(await store.revoke()).toBe(false);
    expect(fake.current().grant.state).toBe('revoked');
    expect(store.keyRevokeError()).toContain('still valid');
    expect(store.keyRevokeError()).toContain('The key service did not answer.');
    expect(store.selected()).toMatchObject({ revoked: true, keyStillValid: true });
    const grantWrites = fake.sent.length;
    changeOutcome = 'done';
    expect(await store.revoke()).toBe(true);
    // The grant was not sent a second time; the key was.
    expect(fake.sent).toHaveLength(grantWrites);
    expect(opened.filter((c) => c.kind === 'revoke')).toHaveLength(2);
    expect(store.keyRevokeError()).toBe('');
    expect(store.selected()?.keyStillValid).toBe(false);
  });

  it('says so when the person cancels the key revoke', async () => {
    const fake = fakePort();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    changeOutcome = 'cancelled';
    expect(await store.revoke()).toBe(false);
    expect(store.keyRevokeError()).toContain('still valid');
  });

  it('revokes no key for a bot whose key was never confirmed', async () => {
    const fake = fakePort();
    fake.withoutKey();
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    expect(await store.revoke()).toBe(true);
    expect(opened).toEqual([]);
  });

  describe('a selection that moves while a write is pending', () => {
    const A = 'did:key:z6MkA';
    const B = 'did:key:z6MkB';
    const bot = (did: string, keyId: string): BotView => ({
      ...view(),
      did,
      name: did,
      key: { keyId, verdict: 'valid', can: ['read', 'write'], expires: 1_790_000_000 },
    });

    /** Two bots; the grant write waits until `release` is called. */
    function twoBots() {
      const bots = new Map([
        [A, bot(A, 'kA')],
        [B, bot(B, 'kB')],
      ]);
      const written: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const port: BotPort = {
        list: async () => [...bots.values()],
        grant: async (did) => bots.get(did)!,
        create: async () => {
          throw new Error('unused');
        },
        async setGrant(did, grant) {
          written.push(did);
          await gate;
          const next = { ...bots.get(did)!, grant: { ...grant, version: grant.version + 1, updatedAt: 2 } };
          bots.set(did, next);
          return next;
        },
        log: async () => [],
      };
      const revokeKey = (keyId: string) => {
        for (const [did, b] of bots) {
          if (b.key?.keyId === keyId) bots.set(did, { ...b, key: { ...b.key, verdict: 'revoked' } });
        }
      };
      return { port, written, release, bots, revokeKey };
    }

    it("revokes the removed bot's key, not the one opened while the grant was ending", async () => {
      const fake = twoBots();
      setPorts({ identity: { bots: fake.port } });
      onChange = (c) => {
        if (c.kind === 'revoke') fake.revokeKey(c.keyId);
      };
      const store = mount();
      await settle();
      await store.select(A);
      const removing = store.revoke();
      await settle();
      await store.select(B);
      fake.release();
      expect(await removing).toBe(true);
      expect(fake.written).toEqual([A]);
      expect(opened).toEqual([{ kind: 'revoke', keyId: 'kA' }]);
      expect(fake.bots.get(B)!.key?.verdict).toBe('valid');
      expect(fake.bots.get(B)!.grant.state).toBe('active');
    });

    it('still revokes the key when the detail view is closed while the grant was ending', async () => {
      const fake = twoBots();
      setPorts({ identity: { bots: fake.port } });
      onChange = (c) => {
        if (c.kind === 'revoke') fake.revokeKey(c.keyId);
      };
      const store = mount();
      await settle();
      await store.select(A);
      const removing = store.revoke();
      await settle();
      store.close();
      fake.release();
      expect(await removing).toBe(true);
      expect(opened).toEqual([{ kind: 'revoke', keyId: 'kA' }]);
      expect(fake.bots.get(A)!.key?.verdict).toBe('revoked');
    });

    it('keeps a failed key revoke with the bot it concerns, not the one now open', async () => {
      const fake = twoBots();
      setPorts({ identity: { bots: fake.port } });
      const store = mount();
      await settle();
      await store.select(A);
      changeOutcome = 'cancelled';
      const removing = store.revoke();
      await settle();
      await store.select(B);
      fake.release();
      expect(await removing).toBe(false);
      expect(store.keyRevokeError()).toBe('');
      expect(store.bots().find((r) => r.did === A)).toMatchObject({ keyStillValid: true });
      await store.select(A);
      expect(store.keyRevokeError()).toContain('still valid');
    });

    it('sends a grant save to the bot it was made for when another is opened meanwhile', async () => {
      const fake = twoBots();
      setPorts({ identity: { bots: fake.port } });
      const store = mount();
      await settle();
      await store.select(A);
      store.toggleAction('read');
      const saving = store.saveGrant();
      await settle();
      await store.select(B);
      fake.release();
      expect(await saving).toBe(true);
      expect(fake.written).toEqual([A]);
      expect(fake.bots.get(B)!.grant.version).toBe(1);
      expect(store.selected()?.did).toBe(B);
    });
  });

  it('reads the activity newest first and pages older entries by the last id', async () => {
    const entries = Array.from({ length: BOT_LOG_PAGE + 3 }, (_, i) => entry(BOT_LOG_PAGE + 3 - i, i % 2 === 0));
    const fake = fakePort(entries);
    setPorts({ identity: { bots: fake.port } });
    const store = mount();
    await settle();
    await store.select(BOT);
    await settle();
    expect(store.activity()).toHaveLength(BOT_LOG_PAGE);
    expect(store.hasOlder()).toBe(true);
    expect(fake.logAsked[0]).toEqual({ before: undefined, limit: BOT_LOG_PAGE });
    const last = store.activity().at(-1)!.id;
    await store.loadOlder();
    expect(fake.logAsked.at(-1)).toEqual({ before: last, limit: BOT_LOG_PAGE });
    expect(store.activity()).toHaveLength(BOT_LOG_PAGE + 3);
    expect(store.hasOlder()).toBe(false);
    expect(store.activity()[0]).toMatchObject({ allowed: true, outcome: 'Allowed', what: 'write in Garden club' });
    expect(store.activity()[1]).toMatchObject({
      allowed: false,
      outcome: 'Blocked: Not allowed',
      reason: 'No reason given',
    });
  });
});

describe('botRows', () => {
  it('offers only shared spaces, each named by its shared id', () => {
    expect(
      grantSpaces([
        { url: 'QmShared', name: 'Garden club' },
        { url: null, name: 'Notes' },
        { url: 'QmOther', name: ' ' },
      ]),
    ).toEqual([
      { id: SHARED, name: 'Garden club' },
      { id: 'QmOther', name: 'Untitled space' },
    ]);
  });

  it('says what the key log says of the key', () => {
    expect(botRow({ ...view(), key: null }).status).toBe('Not confirmed');
    expect(botRow({ ...view(), key: { keyId: 'd3', verdict: 'expired', can: [], expires: 1 } }).keyTone).toBe(
      'danger-text',
    );
    expect(botRow({ ...view(), key: { keyId: 'd3', verdict: 'valid', can: ['read'], expires: null } }).keyLine).toBe(
      'Key valid · allows read',
    );
  });

  it('keeps the grant’s end when the days are not touched, and checks them when they are', () => {
    const draft = draftOf(view({ expires: 1_800_000_000 }));
    expect(grantInput(draft, 1_000).expires).toBe(1_800_000_000);
    expect(grantInput({ ...draft, days: '2' }, 1_000).expires).toBe(1_000 + 2 * 86_400);
    expect(draftProblem({ ...draft, days: 'soon' }, null)).toContain('1 to 3650 days');
    expect(draftProblem({ ...draft, days: '0' }, null)).toContain('1 to 3650 days');
    expect(draftEnds({ ...draft, expires: null }, null, 0)).toBe('No end set.');
  });

  it('names the space of a join and of a write by the shared id, as the log records both', () => {
    const spaces = grantSpaces([{ url: 'QmShared', name: 'Garden club' }]);
    expect(activityRow({ ...entry(1, true), action: 'join', space: SHARED }, spaces).what).toBe('join in Garden club');
    expect(activityRow({ ...entry(2, true), space: SHARED }, spaces).what).toBe('write in Garden club');
    expect(activityRow({ ...entry(3, true), space: 'QmElsewhere' }, spaces).what).toBe('write in QmElsewhere');
  });

  it('never shows the backend’s name for a call outside every action', () => {
    const row = activityRow({ ...entry(1, false), method: 'agent.status', action: null, space: null }, []);
    expect(row.what).toBe('Another request');
    expect(JSON.stringify(row)).not.toContain('agent.status');
  });

  it('words a write without a reason', () => {
    expect(activityRow({ ...entry(1, false), refusal: 'reason-required' }, []).outcome).toBe(
      'Blocked: No reason given',
    );
  });

  it('never words a refusal it does not know as allowed', () => {
    expect(activityRow({ ...entry(1, false), refusal: 'something-new' }, []).outcome).toBe('Blocked: something-new');
  });
});
