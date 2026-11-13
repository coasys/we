/**
 * The phone's identity page: the shared window's screens made from the DeviceKey plugin's calls,
 * against a plugin that answers as the Kotlin one does.
 */
import { describe, expect, it } from 'vitest';

import type {
  DeviceKeyPlugin,
  DeviceKeyStatus,
  DeviceRequestView,
  LinkStep,
  PhoneDeviceView,
} from '../../we-web/src/platform/deviceKey';
import deviceKeySource from '../../we-web/src/platform/deviceKey.ts?raw';
import keyHostSource from '../../we-web/src/platform/keyHost.ts?raw';
import mainSource from '../src/identity/main.ts?raw';
import {
  ANSWER_ON_A_COMPUTER,
  backPath,
  executorUrl,
  NOT_SECURE,
  ON_A_COMPUTER,
  pageStart,
  type PhoneOutcome,
  phoneTransport,
  revokeTargets,
  ROTATE_AFTER,
} from '../src/identity/transport';
import transportSource from '../src/identity/transport.ts?raw';

type Calls = Array<[string, unknown]>;

/** A refusal as Capacitor rejects one: an Error with the plugin's code. */
function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const laptop: PhoneDeviceView = {
  keyId: 'd1',
  fingerprint: 'AbCd 1234',
  name: 'Laptop',
  kind: 'desktop-app',
  addedSeq: 0,
  revokedSeq: null,
  thisDevice: false,
  holdsMaster: 'yes',
  masterIndex: 0,
  mayKeepMaster: true,
  bot: false,
};
const thisPhone: PhoneDeviceView = {
  ...laptop,
  keyId: 'd2',
  fingerprint: 'EfGh 5678',
  name: 'Phone',
  kind: 'phone-app',
  addedSeq: 1,
  thisDevice: true,
};

const emptyStatus: DeviceKeyStatus = { keys: null, identity: null, pending: null, protection: 'none' };

/**
 * A plugin whose answers the test gives: each method answers from `answers` (a value, a function of
 * the call's options, or a list taken in order), and every call is recorded.
 */
function plugin(answers: Partial<Record<keyof DeviceKeyPlugin, unknown>>, calls: Calls = []): DeviceKeyPlugin {
  const queues = new Map<string, unknown[]>();
  return new Proxy({} as DeviceKeyPlugin, {
    get(_, method: string) {
      return async (options?: unknown) => {
        calls.push([method, options]);
        let answer = answers[method as keyof DeviceKeyPlugin];
        if (Array.isArray(answer)) {
          if (!queues.has(method)) queues.set(method, [...answer]);
          answer = queues.get(method)!.shift();
        }
        if (answer === undefined) throw new Error(`${method} was not expected`);
        const value = typeof answer === 'function' ? (answer as (o: unknown) => unknown)(options) : answer;
        if (value instanceof Error) throw value;
        return value;
      };
    },
  });
}

function left(): { outcomes: PhoneOutcome[]; leave: (o: PhoneOutcome) => void } {
  const outcomes: PhoneOutcome[] = [];
  return { outcomes, leave: (o) => outcomes.push(o) };
}

describe('joining an identity on the phone', () => {
  it('makes the keys, asks for the offer and the executor, keeps the executor, and waits to be added', async () => {
    const calls: Calls = [];
    const kept: string[] = [];
    const { outcomes, leave } = left();
    const transport = phoneTransport(
      { kind: 'join' },
      {
        plugin: plugin(
          {
            status: emptyStatus,
            create: { sign: 'z6Mk', enc: 'z6LS', didKey: 'did:key:z6Mk', protection: 'tee' },
            join: {
              did: 'did:scid:coasys:1:abc',
              matchCode: 'R7K Q2M',
              progress: { state: 'waiting', detail: 'open' },
            },
            waitJoined: [
              { progress: { state: 'waiting', detail: 'claimed' } },
              { progress: { state: 'joined', did: 'did:scid:coasys:1:abc', scid: 'abc', seq: 1 } },
            ],
            identityStatus: { keyId: 'd2' },
          },
          calls,
        ),
        leave,
        hint: 'Phone',
        keyHost: { read: () => null, remember: (url) => kept.push(url) },
      },
    );

    expect(await transport.start()).toEqual({ screen: 'enter-offer', error: null, host: '' });
    expect(calls.map(([m]) => m)).toEqual(['status', 'create']);

    const noHost = await transport.step({
      kind: 'offer',
      link: 'https://id.coasys.org/o#coasys:offer:1:x',
      host: 'executor',
    });
    expect(noHost).toMatchObject({ screen: 'enter-offer', host: 'executor' });
    expect((noHost as { error: string }).error).toContain('https://');
    expect(calls.map(([m]) => m)).not.toContain('join');

    const match = await transport.step({
      kind: 'offer',
      link: 'https://id.coasys.org/o#coasys:offer:1:x',
      host: 'https://executor.example/',
    });
    expect(match).toEqual({
      screen: 'device-match',
      code: 'R7K Q2M',
      did: 'did:scid:coasys:1:abc',
      needsAccept: false,
      accepted: false,
      confirmed: false,
    });
    expect(calls.find(([m]) => m === 'join')?.[1]).toEqual({
      link: 'https://id.coasys.org/o#coasys:offer:1:x',
      hint: 'Phone',
    });
    expect(kept).toEqual(['https://executor.example']);

    expect(await transport.step({ kind: 'wait-join' })).toEqual({
      screen: 'joined',
      did: 'did:scid:coasys:1:abc',
      keyId: 'd2',
    });
    await transport.finish();
    expect(outcomes).toEqual(['done']);
  });

  it('shows a refused offer on the offer screen, and keeps no executor for it', async () => {
    const kept: string[] = [];
    const transport = phoneTransport(
      { kind: 'join' },
      {
        plugin: plugin({
          status: { ...emptyStatus, keys: { sign: 'a', enc: 'b', didKey: 'c' } },
          join: refusal('Invalid', 'that offer has expired'),
        }),
        leave: () => {},
        keyHost: { read: () => 'https://kept.example', remember: (url) => kept.push(url) },
      },
    );
    expect(await transport.start()).toEqual({ screen: 'enter-offer', error: null, host: 'https://kept.example' });
    expect(await transport.step({ kind: 'offer', link: 'coasys:offer:1:x', host: 'https://kept.example' })).toEqual({
      screen: 'enter-offer',
      error: 'that offer has expired',
      host: 'https://kept.example',
    });
    expect(kept).toEqual([]);
  });

  it('goes back to the code it showed when a claim is pending, and refuses a phone that joined already', async () => {
    const pending = phoneTransport(
      { kind: 'join' },
      {
        plugin: plugin({
          status: {
            ...emptyStatus,
            keys: { sign: 'a', enc: 'b', didKey: 'c' },
            pending: { did: 'did:scid:coasys:1:abc', offerId: 'o', store: 's', matchCode: 'R7K Q2M' },
          },
        }),
        leave: () => {},
      },
    );
    expect(await pending.start()).toEqual({
      screen: 'device-match',
      code: 'R7K Q2M',
      did: 'did:scid:coasys:1:abc',
      needsAccept: false,
      accepted: false,
      confirmed: false,
    });
    // The window words its screens for a phone: "This phone then joins your identity".
    expect(pending.deviceNoun).toBe('phone');

    const joined = phoneTransport(
      { kind: 'join' },
      {
        plugin: plugin({
          status: { ...emptyStatus, identity: { scid: 'abc', did: 'did:scid:coasys:1:abc', seq: 1 } },
        }),
        leave: () => {},
      },
    );
    expect(await joined.start()).toMatchObject({ screen: 'failed' });
  });

  it('says why a claim ended, and leaves as cancelled on Not now', async () => {
    const { outcomes, leave } = left();
    const transport = phoneTransport(
      { kind: 'join' },
      {
        plugin: plugin({
          status: { ...emptyStatus, keys: { sign: 'a', enc: 'b', didKey: 'c' } },
          waitJoined: { progress: { state: 'ended', reason: 'the holder denied it' } },
        }),
        leave,
      },
    );
    expect(await transport.start()).toEqual({ screen: 'enter-offer', error: null });
    expect(await transport.step({ kind: 'wait-join' })).toEqual({ screen: 'failed', message: 'the holder denied it' });
    await transport.cancel();
    expect(outcomes).toEqual(['cancelled']);
  });
});

describe('adding a device by the code it shows', () => {
  it('sends the ticket, shows the claim, and adds the device with the name and the master key chosen', async () => {
    const calls: Calls = [];
    const { outcomes, leave } = left();
    const steps: LinkStep[] = [
      { step: 'ticket-sent', expires: 1_900_000_000 },
      { step: 'claimed', code: 'Q2M R7K', hint: 'Desktop', canKeepMaster: true },
      { step: 'linked', keyId: 'd3', seq: 4, masterSent: true, note: null },
    ];
    const transport = phoneTransport(
      { kind: 'scan-device' },
      {
        plugin: plugin({ scanDevice: { link: 'L1' }, linkNext: steps, linkConfirm: {} }, calls),
        leave,
      },
    );
    expect(await transport.start()).toEqual({ screen: 'enter-code', error: null });
    expect(await transport.step({ kind: 'code', code: 'coasys:device:1:x' })).toEqual({
      screen: 'code-sent',
      expires: 1_900_000_000,
    });
    expect(await transport.step({ kind: 'wait-claim' })).toEqual({
      screen: 'match',
      code: 'Q2M R7K',
      hint: 'Desktop',
      canKeep: true,
      ownName: false,
    });
    expect(await transport.step({ kind: 'confirm', name: 'Office', keepMaster: true })).toEqual({
      screen: 'linked',
      seq: 4,
      masterSent: true,
      note: null,
    });
    expect(calls.find(([m]) => m === 'linkConfirm')?.[1]).toEqual({ link: 'L1', name: 'Office', keepMaster: true });
    await transport.finish();
    expect(outcomes).toEqual(['done']);
  });

  it('shows a refused code on the code screen, and cancels a link that runs', async () => {
    const calls: Calls = [];
    const refused = phoneTransport(
      { kind: 'scan-device' },
      { plugin: plugin({ scanDevice: refusal('Refused', 'that code is for another store') }), leave: () => {} },
    );
    await refused.start();
    expect(await refused.step({ kind: 'code', code: 'coasys:device:1:x' })).toEqual({
      screen: 'enter-code',
      error: 'that code is for another store',
    });

    const { outcomes, leave } = left();
    const running = phoneTransport(
      { kind: 'scan-device' },
      {
        plugin: plugin(
          { scanDevice: { link: 'L2' }, linkNext: { step: 'ticket-sent', expires: 1 }, linkCancel: {} },
          calls,
        ),
        leave,
      },
    );
    await running.start();
    await running.step({ kind: 'code', code: 'coasys:device:1:x' });
    await running.cancel();
    expect(calls.find(([m]) => m === 'linkCancel')?.[1]).toEqual({ link: 'L2' });
    expect(outcomes).toEqual(['cancelled']);
  });

  it('reads a QR code through the camera, and treats closing it as no code', async () => {
    const scanning = phoneTransport(
      { kind: 'scan-device' },
      {
        plugin: plugin({
          scanCode: [
            { text: 'coasys:device:1:x' },
            refusal('Cancelled', 'the scan was cancelled'),
            refusal('CameraDenied', 'the camera was not allowed; paste the code instead'),
          ],
        }),
        leave: () => {},
      },
    );
    expect(await scanning.scan!('coasys:device:1:')).toBe('coasys:device:1:x');
    expect(await scanning.scan!('coasys:device:1:')).toBeNull();
    await expect(scanning.scan!('coasys:device:1:')).rejects.toThrow('paste the code instead');
  });
});

describe('the master key on the phone', () => {
  it('takes the master key, or says none waits', async () => {
    const taken = phoneTransport(
      { kind: 'take-master' },
      {
        plugin: plugin({ takeMaster: { taken: { did: 'did:scid:coasys:1:abc', index: 0, note: null } } }),
        leave: () => {},
      },
    );
    expect(await taken.start()).toEqual({ screen: 'master-taken', did: 'did:scid:coasys:1:abc', note: null });

    const { outcomes, leave } = left();
    const none = phoneTransport({ kind: 'take-master' }, { plugin: plugin({ takeMaster: { taken: null } }), leave });
    expect(await none.start()).toMatchObject({ screen: 'failed' });
    await none.finish();
    expect(outcomes).toEqual(['failed']);
  });

  it('says the phone needs a biometric, in the plugin’s words', async () => {
    const transport = phoneTransport(
      { kind: 'take-master' },
      {
        plugin: plugin({
          takeMaster: refusal(
            'NoBiometrics',
            'set up a fingerprint or face unlock on this phone to keep the master key here',
          ),
        }),
        leave: () => {},
      },
    );
    expect(await transport.start()).toEqual({
      screen: 'failed',
      message: 'set up a fingerprint or face unlock on this phone to keep the master key here',
    });
  });

  it('asks for the master key and shows the code the holder shows', async () => {
    const transport = phoneTransport(
      { kind: 'ask-master' },
      {
        plugin: plugin({ askForMaster: { requestId: 'r1', keyId: 'd2', fingerprint: 'EfGh 5678', code: 'K2P 9QX' } }),
        leave: () => {},
      },
    );
    expect(await transport.start()).toEqual({
      screen: 'asked',
      keyId: 'd2',
      fingerprint: 'EfGh 5678',
      code: 'K2P 9QX',
    });
  });
});

const sendMaster: DeviceRequestView = {
  id: 'r1',
  kind: 'send-master',
  by: 'd1',
  device: 'Laptop',
  fingerprint: 'AbCd 1234',
  code: 'K2P 9QX',
  targets: [],
  targetKeys: [],
  rotate: false,
  expires: 1_900_000_000,
  problem: null,
};

describe('answering another device', () => {
  it('shows who asks and sends the master key', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'answer-request', id: 'r1' },
      {
        plugin: plugin(
          {
            requests: { requests: [sendMaster] },
            devices: { devices: [laptop, thisPhone] },
            answer: { kind: 'send-master', device: 'Laptop', note: null },
          },
          calls,
        ),
        leave: () => {},
      },
    );
    expect(await transport.start()).toEqual({
      screen: 'request',
      id: 'r1',
      kind: 'send-master',
      device: 'Laptop',
      keyId: 'd1',
      fingerprint: 'AbCd 1234',
      code: 'K2P 9QX',
      targets: [],
      passphrase: false,
      error: null,
    });
    expect(await transport.step({ kind: 'answer' })).toEqual({
      screen: 'request-answered',
      kind: 'send-master',
      device: 'Laptop',
      note: null,
    });
    expect(calls.find(([m]) => m === 'answer')?.[1]).toEqual({ id: 'r1' });
  });

  it('lists a revoke request’s keys by id, and sends one that needs the words to a computer', async () => {
    const revokeRequest: DeviceRequestView = {
      ...sendMaster,
      id: 'r2',
      kind: 'confirm-revoke',
      targets: ['Phone'],
      targetKeys: ['d2'],
      rotate: true,
    };
    expect(revokeTargets(revokeRequest, [laptop, thisPhone])).toEqual([
      { keyId: 'd2', fingerprint: 'EfGh 5678', recordName: 'Phone', mayHoldMaster: true },
    ]);
    const transport = phoneTransport(
      { kind: 'answer-request', id: 'r2' },
      {
        plugin: plugin({
          requests: { requests: [revokeRequest] },
          devices: { devices: [laptop, thisPhone] },
          answer: refusal('NeedsWords', 'the 12 words are needed'),
        }),
        leave: () => {},
      },
    );
    await transport.start();
    expect(await transport.step({ kind: 'answer' })).toMatchObject({
      screen: 'request',
      id: 'r2',
      error: ANSWER_ON_A_COMPUTER,
    });
  });

  it('says a request it cannot answer is gone, or why', async () => {
    const gone = phoneTransport(
      { kind: 'answer-request', id: 'r9' },
      { plugin: plugin({ requests: { requests: [sendMaster] }, devices: { devices: [] } }), leave: () => {} },
    );
    expect(await gone.start()).toMatchObject({ screen: 'failed' });
    const problem = phoneTransport(
      { kind: 'answer-request', id: 'r1' },
      {
        plugin: plugin({
          requests: { requests: [{ ...sendMaster, problem: 'its poster is not a device of this identity' }] },
          devices: { devices: [] },
        }),
        leave: () => {},
      },
    );
    expect(await problem.start()).toEqual({ screen: 'failed', message: 'its poster is not a device of this identity' });
  });
});

describe('naming and revoking a device', () => {
  it('renames a device', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'rename', keyId: 'd1' },
      { plugin: plugin({ devices: { devices: [laptop, thisPhone] }, rename: {} }, calls), leave: () => {} },
    );
    expect(await transport.start()).toEqual({ screen: 'rename', keyId: 'd1', name: 'Laptop', error: null });
    expect(await transport.step({ kind: 'name', name: 'Old laptop' })).toEqual({
      screen: 'renamed',
      keyId: 'd1',
      name: 'Old laptop',
    });
    expect(calls.find(([m]) => m === 'rename')?.[1]).toEqual({ keyId: 'd1', name: 'Old laptop' });
  });

  it('revokes without replacing the master key, which Settings replaces after, and names the entry', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'revoke', keyId: 'd1' },
      {
        plugin: plugin(
          {
            devices: [{ devices: [laptop, thisPhone] }, { devices: [{ ...laptop, revokedSeq: 5 }, thisPhone] }],
            revoke: { note: null },
          },
          calls,
        ),
        leave: () => {},
      },
    );
    expect(await transport.start()).toEqual({
      screen: 'revoke-confirm',
      keyId: 'd1',
      mayHoldMaster: true,
      rotate: false,
      passphrase: false,
      error: null,
    });
    const rotate = await transport.step({ kind: 'revoke', rotate: true });
    expect(rotate).toMatchObject({ screen: 'revoke-confirm', keyId: 'd1' });
    expect((rotate as { error: string }).error).toBe(ROTATE_AFTER);
    expect(calls.map(([m]) => m)).not.toContain('revoke');

    expect(await transport.step({ kind: 'revoke', rotate: false })).toEqual({ screen: 'revoked', keyId: 'd1', seq: 5 });
    expect(calls.find(([m]) => m === 'revoke')?.[1]).toEqual({ keyIds: ['d1'] });
  });

  it('does not revoke the phone from itself', async () => {
    const transport = phoneTransport(
      { kind: 'revoke', keyId: 'd2' },
      { plugin: plugin({ devices: { devices: [laptop, thisPhone] } }), leave: () => {} },
    );
    expect(await transport.start()).toMatchObject({ screen: 'failed' });
  });
});

const WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const keys = { sign: 'a', enc: 'b', didKey: 'c' };
const MADE = 'did:scid:coasys:1:made';

/** The methods and options called, the secure marks shown as `secure:on` / `secure:off`. */
const trail = (calls: Calls): string[] =>
  calls.map(([m, o]) => (m === 'setSecure' ? `secure:${(o as { on: boolean }).on ? 'on' : 'off'}` : m));

describe('making an identity on the phone', () => {
  it('shows the words, asks two back, names the phone, and shows the identity it made', async () => {
    const calls: Calls = [];
    const { outcomes, leave } = left();
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin(
          {
            status: emptyStatus,
            create: { ...keys, protection: 'tee' },
            setSecure: {},
            startMake: { flow: 'f1', ended: false, screen: { screen: 'show-words', words: WORDS.split(' ') } },
            identityStep: [
              { ended: false, screen: { screen: 'confirm-words', positions: [3, 9], error: null } },
              {
                ended: false,
                screen: { screen: 'confirm-words', positions: [2, 7], error: 'Those are not the words.' },
              },
              { ended: false, screen: { screen: 'name-device' } },
              {
                ended: true,
                screen: { screen: 'identity-ready', did: MADE, keyId: 'd0', note: null },
              },
            ],
          },
          calls,
        ),
        leave,
        hint: 'Pixel',
      },
    );

    expect(await transport.start()).toEqual({ screen: 'show-words', words: WORDS.split(' ') });
    // The window is secure before the plugin makes a word.
    expect(trail(calls)).toEqual(['status', 'create', 'secure:on', 'startMake']);

    expect(await transport.step({ kind: 'words-written' })).toEqual({
      screen: 'confirm-words',
      positions: [3, 9],
      error: null,
    });
    expect(await transport.step({ kind: 'words', answers: ['about', 'absurd'] })).toEqual({
      screen: 'confirm-words',
      positions: [2, 7],
      error: 'Those are not the words.',
    });
    expect(await transport.step({ kind: 'words', answers: ['ability', 'abstract'] })).toEqual({
      screen: 'name-device',
      name: 'Pixel',
    });
    expect(await transport.step({ kind: 'name-device', name: 'My phone' })).toEqual({
      screen: 'identity-ready',
      did: MADE,
      keyId: 'd0',
      note: null,
    });
    expect(calls.filter(([m]) => m === 'identityStep').map(([, o]) => o)).toEqual([
      { flow: 'f1', input: { input: 'words-written' } },
      { flow: 'f1', input: { input: 'confirm-words', first: 'about', second: 'absurd' } },
      { flow: 'f1', input: { input: 'confirm-words', first: 'ability', second: 'abstract' } },
      { flow: 'f1', input: { input: 'name-device', name: 'My phone' } },
    ]);
    // Secure from before the words until the screen after them, the wrong answer included.
    expect(trail(calls)).toEqual([
      'status',
      'create',
      'secure:on',
      'startMake',
      'identityStep',
      'identityStep',
      'identityStep',
      'secure:off',
      'identityStep',
    ]);

    await transport.finish();
    expect(outcomes).toEqual(['done']);
    // The flow had ended: nothing to cancel.
    expect(trail(calls)).not.toContain('identityCancel');
  });

  it('says a make that stopped, and tries the publish again', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin(
          {
            status: { ...emptyStatus, keys },
            setSecure: {},
            startMake: { flow: 'f2', ended: false, screen: { screen: 'name-device' } },
            identityStep: [
              {
                ended: false,
                screen: { screen: 'make-stopped', did: MADE, reason: 'The store did not answer.', pending: true },
              },
              { ended: true, screen: { screen: 'identity-ready', did: MADE, keyId: 'd0', note: null } },
            ],
          },
          calls,
        ),
        leave: () => {},
      },
    );
    expect(await transport.start()).toEqual({ screen: 'name-device', name: 'Phone' });
    const stopped = await transport.step({ kind: 'name-device' });
    // No DID on the stop screen: only `identity-ready` shows it.
    expect(stopped).toEqual({ screen: 'make-stopped', reason: 'The store did not answer.', pending: true });
    expect(await transport.step({ kind: 'try-again' })).toMatchObject({ screen: 'identity-ready' });
    expect(calls.filter(([m]) => m === 'identityStep').map(([, o]) => o)).toEqual([
      { flow: 'f2', input: { input: 'name-device' } },
      { flow: 'f2', input: { input: 'try-again' } },
    ]);
  });

  it('shows the identity at once when the phone had one made and not published', async () => {
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin({
          status: { ...emptyStatus, keys },
          setSecure: {},
          startMake: {
            flow: 'f3',
            ended: true,
            screen: { screen: 'identity-ready', did: MADE, keyId: 'd0', note: null },
          },
        }),
        leave: () => {},
      },
    );
    expect(await transport.start()).toMatchObject({ screen: 'identity-ready', did: MADE });
  });

  it('says why a make could not start, in the page’s words, and leaves the window as it was', async () => {
    const cases: Array<[string, RegExp]> = [
      ['NoBiometrics', /fingerprint or face unlock/],
      ['WeakProtection', /no identity was made/],
      ['AlreadyJoined', /one of your devices already/],
      ['Unavailable', /did not answer/],
      ['Rpc', /the plugin’s own words/],
    ];
    for (const [code, text] of cases) {
      const calls: Calls = [];
      const transport = phoneTransport(
        { kind: 'create' },
        {
          plugin: plugin(
            {
              status: { ...emptyStatus, keys },
              setSecure: {},
              startMake: refusal(code, 'the plugin’s own words'),
            },
            calls,
          ),
          leave: () => {},
        },
      );
      const screen = await transport.start();
      expect(screen).toMatchObject({ screen: 'failed' });
      expect((screen as { message: string }).message).toMatch(text);
      expect(trail(calls).filter((m) => m.startsWith('secure'))).toEqual(['secure:on', 'secure:off']);
    }
  });

  it('shows no words when the window cannot be kept out of screenshots', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin({ status: { ...emptyStatus, keys }, setSecure: refusal('Unavailable', 'no window') }, calls),
        leave: () => {},
      },
    );
    expect(await transport.start()).toEqual({ screen: 'failed', message: NOT_SECURE });
    expect(trail(calls)).not.toContain('startMake');
  });

  it('ends the flow and clears the secure mark when the person leaves', async () => {
    const calls: Calls = [];
    const { outcomes, leave } = left();
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin(
          {
            status: { ...emptyStatus, keys },
            setSecure: {},
            startMake: { flow: 'f4', ended: false, screen: { screen: 'show-words', words: WORDS.split(' ') } },
            identityCancel: {},
          },
          calls,
        ),
        leave,
      },
    );
    await transport.start();
    expect(await transport.cancel()).toBeNull();
    expect(calls.find(([m]) => m === 'identityCancel')?.[1]).toEqual({ flow: 'f4' });
    expect(trail(calls).slice(-2)).toEqual(['identityCancel', 'secure:off']);
    expect(outcomes).toEqual(['cancelled']);
  });

  it('keeps the flow open on an input it did not take, and leaves through it', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin(
          {
            status: { ...emptyStatus, keys },
            setSecure: {},
            startMake: { flow: 'f7', ended: false, screen: { screen: 'name-device' } },
            identityStep: refusal('WrongInput', 'That does not answer this screen.'),
            identityCancel: {},
          },
          calls,
        ),
        leave: () => {},
      },
    );
    await transport.start();
    expect(await transport.step({ kind: 'try-again' })).toEqual({
      screen: 'failed',
      message: 'That does not answer this screen.',
    });
    // The failed screen's Done leaves the page, and the flow the plugin kept open ends with it.
    await transport.finish();
    expect(calls.find(([m]) => m === 'identityCancel')?.[1]).toEqual({ flow: 'f7' });
  });

  it('ends a flow a refusal ended, and sends nothing more to it', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'create' },
      {
        plugin: plugin(
          {
            status: { ...emptyStatus, keys },
            setSecure: {},
            startMake: { flow: 'f5', ended: false, screen: { screen: 'name-device' } },
            identityStep: refusal('Rpc', 'the flow is gone'),
          },
          calls,
        ),
        leave: () => {},
      },
    );
    await transport.start();
    expect(await transport.step({ kind: 'name-device' })).toEqual({ screen: 'failed', message: 'the flow is gone' });
    expect(await transport.step({ kind: 'try-again' })).toMatchObject({ screen: 'failed' });
    expect(calls.filter(([m]) => m === 'identityStep')).toHaveLength(1);
    await transport.cancel();
    expect(trail(calls)).not.toContain('identityCancel');
  });

  it('keeps none of the words it showed or was given', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'restore' },
      {
        plugin: plugin(
          {
            status: { ...emptyStatus, keys },
            setSecure: {},
            startRestore: {
              flow: 'f6',
              ended: false,
              screen: { screen: 'enter-words', purpose: 'restore', error: null, position: null },
            },
            identityStep: { ended: false, screen: { screen: 'show-words', words: WORDS.split(' ') } },
            identityCancel: {},
          },
          calls,
        ),
        leave: () => {},
      },
    );
    await transport.start();
    await transport.step({ kind: 'twelve-words', words: WORDS });
    // Whatever the transport closes over, a fresh look at it finds no word: it keeps screen names.
    expect(JSON.stringify(transport)).not.toContain('abandon');
    expect(transportSource).not.toMatch(/let \w+: Screen \| null/);
    expect(transportSource).not.toMatch(/console\.|localStorage|sessionStorage|navigator\.clipboard|history\./);
  });
});

describe('restoring an identity on the phone', () => {
  it('takes the 12 words, asks which devices to lock out, and restores', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'restore' },
      {
        plugin: plugin(
          {
            status: emptyStatus,
            create: { ...keys, protection: 'tee' },
            setSecure: {},
            startRestore: {
              flow: 'r1',
              ended: false,
              screen: { screen: 'enter-words', purpose: 'restore', error: null, position: null },
            },
            identityStep: [
              {
                ended: false,
                screen: { screen: 'enter-words', purpose: 'restore', error: 'Not one of the 2048 words.', position: 4 },
              },
              {
                ended: false,
                screen: {
                  screen: 'restore-devices',
                  did: MADE,
                  devices: [{ keyId: 'd1', name: 'Laptop', kind: 'desktop-app', lockOut: true }],
                  note: null,
                },
              },
              {
                ended: true,
                screen: { screen: 'restored', did: MADE, name: 'Phone', keyId: 'd3', revoked: ['d1'], note: null },
              },
            ],
          },
          calls,
        ),
        leave: () => {},
      },
    );
    expect(await transport.start()).toMatchObject({ screen: 'enter-words', purpose: 'restore' });
    expect(await transport.step({ kind: 'twelve-words', words: WORDS })).toEqual({
      screen: 'enter-words',
      purpose: 'restore',
      error: 'Not one of the 2048 words.',
      position: 4,
    });
    const devices = await transport.step({ kind: 'twelve-words', words: WORDS });
    expect(devices).toMatchObject({ screen: 'restore-devices' });
    expect(await transport.step({ kind: 'lock-out', keyIds: ['d1'], name: 'Phone' })).toMatchObject({
      screen: 'restored',
      revoked: ['d1'],
    });
    expect(calls.filter(([m]) => m === 'identityStep').map(([, o]) => o)).toEqual([
      { flow: 'r1', input: { input: 'twelve-words', words: WORDS } },
      { flow: 'r1', input: { input: 'twelve-words', words: WORDS } },
      { flow: 'r1', input: { input: 'lock-out', keyIds: ['d1'], name: 'Phone' } },
    ]);
    // The window is secure while the words are asked, the failed answer included, and not after.
    expect(trail(calls).filter((m) => m !== 'identityStep')).toEqual([
      'status',
      'create',
      'secure:on',
      'startRestore',
      'secure:off',
    ]);
    const off = trail(calls).indexOf('secure:off');
    const before = trail(calls).slice(0, off);
    expect(before.filter((m) => m === 'identityStep')).toHaveLength(2);
  });

  it('says a phone of an identity already restores none', async () => {
    const transport = phoneTransport(
      { kind: 'restore' },
      {
        plugin: plugin({
          status: { ...emptyStatus, keys },
          setSecure: {},
          startRestore: refusal('AlreadyJoined', 'joined as did:scid:coasys:1:abc'),
        }),
        leave: () => {},
      },
    );
    const screen = await transport.start();
    expect((screen as { message: string }).message).toMatch(/one of your devices already/);
    expect((screen as { message: string }).message).not.toContain('did:');
  });
});

describe('replacing the master key on the phone', () => {
  it('takes the 12 words and replaces the key, or says it could not keep it and tries again', async () => {
    const calls: Calls = [];
    const transport = phoneTransport(
      { kind: 'replace-master' },
      {
        plugin: plugin(
          {
            status: { ...emptyStatus, keys, identity: { scid: 'abc', did: MADE, seq: 4 } },
            setSecure: {},
            startRotate: {
              flow: 'm1',
              ended: false,
              screen: { screen: 'enter-words', purpose: 'replace', error: null, position: null },
            },
            identityStep: [
              {
                ended: false,
                screen: { screen: 'master-not-kept', index: 2, revoked: [], reason: 'Keystore busy.', note: null },
              },
              { ended: true, screen: { screen: 'master-replaced', index: 2, revoked: [], note: null } },
            ],
          },
          calls,
        ),
        leave: () => {},
      },
    );
    expect(await transport.start()).toMatchObject({ screen: 'enter-words', purpose: 'replace' });
    expect(await transport.step({ kind: 'twelve-words', words: WORDS })).toMatchObject({
      screen: 'master-not-kept',
      index: 2,
    });
    expect(await transport.step({ kind: 'try-again' })).toEqual({
      screen: 'master-replaced',
      index: 2,
      revoked: [],
      note: null,
    });
    expect(trail(calls).filter((m) => m.startsWith('secure'))).toEqual(['secure:on', 'secure:off']);
  });

  it('says a phone in no identity has no master key to replace', async () => {
    const transport = phoneTransport(
      { kind: 'replace-master' },
      {
        plugin: plugin({ status: { ...emptyStatus, keys }, setSecure: {}, startRotate: refusal('NoIdentity', 'x') }),
        leave: () => {},
      },
    );
    expect(((await transport.start()) as { message: string }).message).toMatch(/no master key to replace/);
  });
});

describe('what the phone does not run', () => {
  it('sends removing the master key and adding a bot to a computer', async () => {
    for (const kind of ['remove-master', 'add-bot']) {
      const transport = phoneTransport({ kind }, { plugin: plugin({}), leave: () => {} });
      expect(await transport.start()).toEqual({ screen: 'failed', message: ON_A_COMPUTER });
    }
  });
});

describe('the page’s address', () => {
  it('reads the change it was opened on, and nothing else', () => {
    expect(pageStart('?join')).toEqual({ kind: 'join' });
    expect(pageStart(`?change=${encodeURIComponent('{"kind":"take-master"}')}`)).toEqual({ kind: 'take-master' });
    expect(pageStart(`?change=${encodeURIComponent('{"kind":"answer-request","id":"r1"}')}`)).toEqual({
      kind: 'answer-request',
      id: 'r1',
    });
    expect(pageStart(`?change=${encodeURIComponent('{"kind":"revoke"}')}`)).toBeNull();
    expect(pageStart('?change=%7Bnot')).toBeNull();
    expect(pageStart('')).toBeNull();
  });

  it('reads the addresses WE’s phone connector builds (`identityPageUrl` in apps/we-web)', () => {
    // As apps/we-web/src/platform/phoneCustody.test.ts asserts them, built with URLSearchParams.
    expect(pageStart('?join=&back=%2F')).toEqual({ kind: 'join' });
    const params = new URLSearchParams();
    params.set('change', JSON.stringify({ kind: 'revoke', keyId: 'd3' }));
    params.set('back', '/settings/identity?tab=devices');
    expect(pageStart(`?${params}`)).toEqual({ kind: 'revoke', keyId: 'd3' });
    expect(backPath(`?${params}`, 'https://localhost')).toBe('/settings/identity?tab=devices');
  });

  it('goes back only to a path of the app’s own', () => {
    const origin = 'https://localhost';
    expect(backPath('?back=%2Fsettings%2Fidentity', origin)).toBe('/settings/identity');
    expect(backPath('?back=%2Fsettings%2Fidentity%3Ftab%3Ddevices%23top', origin)).toBe(
      '/settings/identity?tab=devices#top',
    );
    expect(backPath('?back=https%3A%2F%2Fevil.example', origin)).toBe('/');
    expect(backPath('?back=%2F%2Fevil.example', origin)).toBe('/');
    expect(backPath('?back=%2F%5Cevil.example', origin)).toBe('/');
    expect(backPath('', origin)).toBe('/');
  });

  it('goes back nowhere a URL parser could make into another origin', () => {
    const origin = 'https://localhost';
    // A tab or newline between the first two slashes: URL parsing removes control characters,
    // which would turn `/\tevil` into `//evil` — a network-path reference off the app.
    expect(backPath(`?back=${encodeURIComponent('/\t/evil.example')}`, origin)).toBe('/');
    expect(backPath(`?back=${encodeURIComponent('/\n/evil.example')}`, origin)).toBe('/');
    expect(backPath('?back=/%09/evil.example', origin)).toBe('/');
    expect(backPath('?back=/%0A/evil.example', origin)).toBe('/');
    // A literal protocol-relative or backslash reference, and the same percent-encoded.
    expect(backPath(`?back=${encodeURIComponent('//evil.example')}`, origin)).toBe('/');
    expect(backPath(`?back=${encodeURIComponent('/\\evil.example')}`, origin)).toBe('/');
    expect(backPath(`?back=${encodeURIComponent('/\\\\evil.example')}`, origin)).toBe('/');
    expect(backPath('?back=%2F%2Fevil.example%2Fpath', origin)).toBe('/');
    expect(backPath('?back=%2f%2fevil.example', origin)).toBe('/');
    // Another scheme entirely, and one merely spelled like the app.
    expect(backPath('?back=javascript%3Aalert(1)', origin)).toBe('/');
    expect(backPath('?back=https%3A%2F%2Flocalhost.evil.example%2Fx', origin)).toBe('/');
    // A same-origin URL or a plain relative path normalizes to its own path — that is allowed.
    expect(backPath(`?back=${encodeURIComponent('https://localhost/settings/identity')}`, origin)).toBe(
      '/settings/identity',
    );
  });

  it('takes an executor only as an http(s) address', () => {
    expect(executorUrl(' https://executor.example/ ')).toBe('https://executor.example');
    expect(executorUrl('http://127.0.0.1:12000')).toBe('http://127.0.0.1:12000');
    expect(executorUrl('executor.example')).toBeNull();
    expect(executorUrl('javascript:alert(1)')).toBeNull();
  });

  it('imports only the shared window and the plugin bridge, which import nothing', () => {
    const imports = (source: string) => [...source.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1]);
    expect(imports(mainSource).sort()).toEqual([
      '../../../we-web/src/platform/deviceKey',
      '../../../we-web/src/platform/keyHost',
      './transport',
      '@we/identity-window',
    ]);
    expect(imports(deviceKeySource)).toEqual([]);
    expect(imports(keyHostSource)).toEqual([]);
  });
});
