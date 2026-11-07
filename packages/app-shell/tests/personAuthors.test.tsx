/**
 * One author per person: a record's `author` is the device that signed it, and the profile cache
 * answers it as the person that device speaks for — one name and face for posts from two computers,
 * with the signing device kept.
 */
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

import { byAnyDid, onePerPerson, profileAsPerson, selfDids } from '../src/shared/personProfile';

const PERSON = 'did:scid:coasys:1:QmTestPerson';
const LAPTOP = 'did:key:z6MkTestLaptop';
const DESKTOP = 'did:key:z6MkTestDesktop';
const LONER = 'did:key:z6MkTestLoner';
const SILENT_PERSON = 'did:scid:coasys:1:QmTestSilent';
const SILENT_DEVICE = 'did:key:z6MkTestSilentDevice';

const profile = (did: string, firstName: string) => ({ did, firstName, lastName: '', handle: '', bio: '' });

const published: Record<string, ReturnType<typeof profile>> = {
  [PERSON]: profile(PERSON, 'Robin'),
  [LAPTOP]: profile(LAPTOP, 'Robin (old laptop name)'),
  [DESKTOP]: profile(DESKTOP, ''),
  [LONER]: profile(LONER, 'Sam'),
  // A person whose own profile has not been published: their device's stands in.
  [SILENT_PERSON]: profile(SILENT_PERSON, ''),
  [SILENT_DEVICE]: profile(SILENT_DEVICE, 'Kit'),
};
const personOfKey: Record<string, string> = { [LAPTOP]: PERSON, [DESKTOP]: PERSON, [SILENT_DEVICE]: SILENT_PERSON };

let me: { did: string; person?: string; dids?: string[] } = { did: 'did:key:z6MkTestViewer' };
const persons = { personOf: vi.fn(async (did: string) => personOfKey[did] ?? did) };
const profilePort = {
  get: async (did: string) => published[did] ?? profile(did, ''),
  publish: async () => {},
  uploadFile: async () => '',
};
const sessionStub = {
  me: () => me,
  backendPorts: () => ({ profiles: profilePort, persons }),
  bootState: () => 'ready',
};

vi.mock('../src/frameworks/solid/stores/SessionStore', () => ({ useSessionStore: () => sessionStub }));
vi.mock('../src/frameworks/solid/stores/AccountStore', () => ({
  useAccountStore: () => ({ syncDisplay: async () => {} }),
}));

import { type ProfileStore, ProfileStoreProvider, useProfileStore } from '../src/frameworks/solid/stores/ProfileStore';

function mount(): ProfileStore {
  let store!: ProfileStore;
  function Capture() {
    store = useProfileStore();
    return null;
  }
  render(() => (
    <ProfileStoreProvider>
      <Capture />
    </ProfileStoreProvider>
  ));
  return store;
}

/** Every pending resolve and fetch, settled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('profileAsPerson', () => {
  const byPerson = profile(PERSON, 'Robin');
  const byDevice = profile(LAPTOP, 'Laptop');

  it("answers a device author with the person's profile, under the person, keeping the device", () => {
    expect(profileAsPerson(LAPTOP, PERSON, byPerson, byDevice)).toEqual({ ...byPerson, did: PERSON, device: LAPTOP });
  });

  it("stands the device's profile in while the person has published nothing, still under the person", () => {
    const empty = profile(PERSON, '');
    expect(profileAsPerson(LAPTOP, PERSON, empty, byDevice)).toEqual({ ...byDevice, did: PERSON, device: LAPTOP });
    expect(profileAsPerson(LAPTOP, PERSON, undefined, byDevice)).toEqual({ ...byDevice, did: PERSON, device: LAPTOP });
  });

  it('leaves an author who is their own person exactly as it was', () => {
    expect(profileAsPerson(LONER, LONER, undefined, profile(LONER, 'Sam'))).toEqual(profile(LONER, 'Sam'));
    expect(profileAsPerson(LAPTOP, PERSON, undefined, undefined)).toBeUndefined();
  });
});

describe('onePerPerson — space members and the profile list', () => {
  const answers: Record<string, ReturnType<typeof profile> & { device?: string }> = {
    [LAPTOP]: { ...profile(PERSON, 'Robin'), device: LAPTOP },
    [DESKTOP]: { ...profile(PERSON, 'Robin'), device: DESKTOP },
    [LONER]: profile(LONER, 'Sam'),
  };
  const profileFor = (did: string) => answers[did];

  it("folds a person's member keys into one entry, the keys kept under it, in first-seen order", () => {
    const members = onePerPerson([LONER, LAPTOP, DESKTOP, LAPTOP], profileFor);
    expect(members).toEqual([profile(LONER, 'Sam'), { ...profile(PERSON, 'Robin'), devices: [LAPTOP, DESKTOP] }]);
  });

  it('drops a key with no profile yet rather than listing it under nobody', () => {
    expect(onePerPerson(['did:key:z6MkTestUnknown', LONER], profileFor)).toEqual([profile(LONER, 'Sam')]);
  });

  it('finds a person by the person or by any of their keys', () => {
    const index = byAnyDid<{ did: string; devices?: string[] }>(onePerPerson([LAPTOP, DESKTOP, LONER], profileFor));
    expect(index.get(LAPTOP)?.did).toBe(PERSON);
    expect(index.get(DESKTOP)?.did).toBe(PERSON);
    expect(index.get(PERSON)?.did).toBe(PERSON);
    expect(index.get(LONER)?.did).toBe(LONER);
    expect(byAnyDid(undefined).size).toBe(0);
  });

  it('reads the viewer from a list or a single DID, ignoring blanks', () => {
    expect([...selfDids([DESKTOP, LAPTOP, PERSON])]).toEqual([DESKTOP, LAPTOP, PERSON]);
    expect([...selfDids(DESKTOP)]).toEqual([DESKTOP]);
    expect([...selfDids(['', null, LAPTOP])]).toEqual([LAPTOP]);
    expect(selfDids(undefined).size).toBe(0);
  });
});

describe('ProfileStore — authors as persons', () => {
  it("draws both of a person's computers with one name, and keeps which one signed", async () => {
    me = { did: 'did:key:z6MkTestViewer' };
    const store = mount();
    await store.fetchProfile(LAPTOP);
    await store.fetchProfile(DESKTOP);
    await settle();

    const fromLaptop = store.profileFor(LAPTOP);
    const fromDesktop = store.profileFor(DESKTOP);
    expect(fromLaptop?.name).toBe('Robin');
    expect(fromDesktop?.name).toBe('Robin');
    expect(fromLaptop?.did).toBe(PERSON);
    expect(fromDesktop?.did).toBe(PERSON);
    expect(fromLaptop?.device).toBe(LAPTOP);
    expect(fromDesktop?.device).toBe(DESKTOP);
    expect(store.personOf(LAPTOP)).toBe(PERSON);
    expect(store.personOf(DESKTOP)).toBe(PERSON);
  });

  it("falls back to the signing device's profile when the person's is empty", async () => {
    me = { did: 'did:key:z6MkTestViewer' };
    const store = mount();
    await store.fetchProfile(SILENT_DEVICE);
    await settle();

    expect(store.profileFor(SILENT_DEVICE)).toMatchObject({ name: 'Kit', did: SILENT_PERSON, device: SILENT_DEVICE });
  });

  it('leaves a key no log lists as its own author, with no device field', async () => {
    me = { did: 'did:key:z6MkTestViewer' };
    const store = mount();
    await store.fetchProfile(LONER);
    await settle();

    expect(store.profileFor(LONER)).toMatchObject({ did: LONER, name: 'Sam' });
    expect(store.profileFor(LONER)).not.toHaveProperty('device');
    expect(store.personOf(LONER)).toBe(LONER);
  });

  it("answers a post from my other computer with this computer's own profile, as me", async () => {
    // I am on the desktop; the laptop is my other device. My profile as edited here is the freshest.
    me = { did: DESKTOP, person: PERSON, dids: [DESKTOP, LAPTOP] };
    published[DESKTOP] = profile(DESKTOP, 'Robin, just renamed');
    const store = mount();
    await store.fetchProfile(DESKTOP);
    await store.fetchProfile(LAPTOP);
    await settle();

    const mine = store.profileFor(LAPTOP);
    expect(mine?.did).toBe(me.person);
    expect(mine?.name).toBe('Robin, just renamed');
    expect(mine?.device).toBe(LAPTOP);
    published[DESKTOP] = profile(DESKTOP, '');
  });

  it("lists a person once, with both computers' keys under them", async () => {
    me = { did: 'did:key:z6MkTestViewer' };
    const store = mount();
    await store.fetchProfile(LAPTOP);
    await store.fetchProfile(DESKTOP);
    await store.fetchProfile(LONER);
    await settle();

    const robin = store.profiles().filter((p) => p.did === PERSON);
    expect(robin).toHaveLength(1);
    expect(robin[0]).toMatchObject({ did: PERSON, name: 'Robin' });
    expect(robin[0]?.devices).toEqual(expect.arrayContaining([LAPTOP, DESKTOP]));
    expect(robin[0]).not.toHaveProperty('device');
    expect(store.profiles().some((p) => p.did === LAPTOP || p.did === DESKTOP)).toBe(false);
    // An agent that is its own person stays as it was, with no device list.
    const sam = store.profiles().find((p) => p.did === LONER);
    expect(sam).toMatchObject({ did: LONER, name: 'Sam' });
    expect(sam).not.toHaveProperty('devices');
  });

  it('asks the backend once per key, however often the author is read', async () => {
    me = { did: 'did:key:z6MkTestViewer' };
    persons.personOf.mockClear();
    const store = mount();
    store.profileFor(LAPTOP);
    store.profileFor(LAPTOP);
    await store.fetchProfile(LAPTOP);
    await settle();
    expect(persons.personOf.mock.calls.filter(([did]) => did === LAPTOP)).toHaveLength(1);
  });
});
