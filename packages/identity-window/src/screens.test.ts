/**
 * The identity window's wording, and that its bundle and policy stay narrow: the window shows the
 * recovery words, so nothing a template or a post can influence may load or run in it.
 */
import { describe, expect, it } from 'vitest';

// The policy as `vite.js` writes it into the built page.
import policy from '../csp.txt?raw';
import indexSource from './index.ts?raw';
import {
  heading,
  isLast,
  remaining,
  type RevokeTarget,
  type Screen,
  spreadWords,
  targetLine,
  wordNumber,
} from './screens';
import screensSource from './screens.ts?raw';
import windowSource from './window.ts?raw';

const IDENTITY_CSP = policy.trim();

describe('the identity window', () => {
  it('says what a revocation does, and promises nothing about earlier signatures', () => {
    const confirm = { screen: 'revoke-confirm' as const, keyId: 'd2', rotate: false, passphrase: false, error: null };
    const lead = heading({ ...confirm, mayHoldMaster: false }).lead;
    expect(lead).toContain('when they next read your key log');
    expect(lead).toContain('can also stop counting as yours');
    expect(lead).not.toContain('master key');
  });

  it('tells before revoking a device the key log let keep the master key that it may still hold a valid one', () => {
    const lead = heading({
      screen: 'revoke-confirm',
      keyId: 'd2',
      mayHoldMaster: true,
      rotate: true,
      passphrase: false,
      error: null,
    }).lead;
    expect(lead).toContain('may still hold a valid master key');
    expect(lead).toContain('replace your master key');
    // The choice on this screen does that, with the 12 words.
    expect(lead).toContain('Also replace my master key');
    expect(lead).toContain('12 words');
    // Not a claim about what the device holds: the log says it may, not that it does.
    expect(lead).not.toMatch(/keeps a copy|stays valid/);
  });

  it('asks for the two words the custody service chose', () => {
    expect(heading({ screen: 'confirm-words', positions: [3, 11], error: null }).lead).toContain('words 3 and 11');
  });

  it('counts an offer down and numbers the words', () => {
    expect(remaining(1000 + 292, 1000)).toBe('4:52');
    expect(remaining(1000, 2000)).toBe('0:00');
    expect(wordNumber(0)).toBe('01');
    expect(wordNumber(11)).toBe('12');
  });

  it('names the device on the approve card when it gave a hint', () => {
    const match = { screen: 'match' as const, code: 'R7K Q2M', canKeep: false, ownName: false };
    expect(heading({ ...match, hint: 'server b' }).title).toBe('Add server b?');
    expect(heading({ ...match, hint: null }).title).toBe('Add this device?');
  });

  it('asks the holder by key whether to send the master key, and the revoke request names each key from the log', () => {
    const request = {
      screen: 'request' as const,
      id: 'r1',
      keyId: 'd2',
      fingerprint: 'AbCd 1234',
      code: 'R7K Q2M',
      passphrase: false,
      error: null,
    };
    const send = heading({ ...request, kind: 'send-master', device: 'Phone', targets: [] });
    // The key log's key, not the name any device can write, says who asks.
    expect(send.title).toBe('Device d2 (key AbCd 1234) asks for the master key — send it?');
    expect(send.lead).toContain('Phone');
    expect(send.lead).toContain('R7K Q2M');
    expect(send.lead).toContain('add and remove your devices');

    // A record that renamed the target "Old desktop" and said it keeps no master key: the card
    // still says which key goes, by the log's key id and fingerprint, and that it may hold one.
    const targets: RevokeTarget[] = [
      { keyId: 'd3', fingerprint: 'WxYz 5678', recordName: 'Old desktop', mayHoldMaster: true },
      { keyId: 'd4', fingerprint: 'QrSt 9012', recordName: null, mayHoldMaster: false },
    ];
    const revoke = heading({ ...request, kind: 'confirm-revoke', device: 'Laptop', targets });
    expect(revoke.title).toBe('Device d2 (key AbCd 1234) asks to revoke d3 (key WxYz 5678), d4 (key QrSt 9012)');
    expect(revoke.title).not.toContain('Old desktop');
    expect(revoke.lead).toContain('Your record calls the asking device Laptop');
    expect(revoke.lead).toContain('R7K Q2M');
    expect(revoke.lead).toContain('d3 may still hold a valid master key');
    expect(revoke.lead).toContain('replace your master key');
    expect(revoke.lead).not.toContain('d4 may');
    expect(targetLine(targets[0])).toBe(
      'd3 · key WxYz 5678 · your record calls it Old desktop · may still hold a valid master key',
    );
    expect(targetLine(targets[1])).toBe('d4 · key QrSt 9012');

    const none = heading({ ...request, kind: 'confirm-revoke', device: 'Laptop', targets: [targets[1]] });
    expect(none.lead).not.toContain('master key');
  });

  it('says on a linked device what it can and cannot do, and what is still on its way', () => {
    expect(heading({ screen: 'joined', did: 'did:scid:coasys:1:Qm', keyId: 'd2' }).lead).toContain(
      'does not hold your master key',
    );
    const linked = heading({ screen: 'linked', seq: 3, masterSent: true, note: 'Its name is not saved yet.' }).lead;
    expect(linked).toContain('entry #3');
    expect(linked).toContain('The master key waits for it');
    expect(linked).toContain('Its name is not saved yet.');
    expect(heading({ screen: 'linked', seq: 3, masterSent: false, note: null }).lead).toBe(
      'Your key log records it as entry #3.',
    );
  });

  it('titles the device steps as the Devices page names them', () => {
    expect(heading({ screen: 'enter-code', error: null }).title).toBe('Scan or paste a code');
    expect(heading({ screen: 'device-code', code: 'coasys:device:1:x', qrSvg: '', expires: 0 }).title).toBe(
      'Show my code',
    );
    const asked = heading({ screen: 'asked', keyId: 'd2', fingerprint: 'AbCd 1234', code: 'R7K Q2M' }).lead;
    expect(asked).toContain('Take the master key');
    // The holder's card shows the same key and code.
    expect(asked).toContain('d2 (key AbCd 1234)');
    expect(asked).toContain('R7K Q2M');
    expect(heading({ screen: 'renamed', keyId: 'd2', name: 'Laptop' }).title).toBe('Named Laptop');
  });

  it('says what the words do: add and remove devices, restore the identity, replace the master key', () => {
    const lead = heading({ screen: 'show-words', words: [] }).lead;
    expect(lead).toContain('adds and removes your devices');
    expect(lead).toContain('restore your identity on a new computer');
    expect(lead).toContain('replace your master key');
    // Nothing this app cannot do: the words bring back no stolen data and no other keys.
    expect(lead).not.toMatch(/stolen|restore everything/);
  });

  it('titles the words entry by what the words are for', () => {
    const entry = { screen: 'enter-words' as const, error: null, position: null };
    expect(heading({ ...entry, purpose: 'replace' }).title).toBe('Replace my master key');
    expect(heading({ ...entry, purpose: 'restore' }).title).toBe('Use my 12 words');
    expect(heading({ ...entry, purpose: 'revoke' }).lead).toContain('also replaces your master key');
    expect(heading({ ...entry, purpose: 'answer' }).lead).toContain('12 words');
    expect(isLast({ ...entry, purpose: 'replace' })).toBe(false);
  });

  it('spreads a pasted phrase over the word fields from the one it was pasted into', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `w${i + 1}`).join(' ');
    expect(spreadWords(twelve, 0)).toHaveLength(12);
    expect(spreadWords(`  ${twelve}\n`, 0)[11]).toEqual([11, 'w12']);
    // From field 10 on, only three fields are left.
    expect(spreadWords(twelve, 9)).toEqual([
      [9, 'w1'],
      [10, 'w2'],
      [11, 'w3'],
    ]);
    // One word is an ordinary paste.
    expect(spreadWords('abandon', 4)).toEqual([]);
  });

  it('says what replacing, restoring and removing the master key did', () => {
    const replaced = heading({ screen: 'master-replaced', index: 1, revoked: ['d2'], note: null });
    expect(replaced.title).toBe('Your master key is replaced');
    expect(replaced.lead).toContain('master key #1');
    expect(replaced.lead).toContain('Revoked in the same step: d2.');
    expect(heading({ screen: 'master-replaced', index: 2, revoked: [], note: 'Late.' }).lead).not.toContain('Revoked');
    const restored = heading({
      screen: 'restored',
      did: 'did:scid:coasys:1:Qm',
      name: 'Laptop',
      keyId: 'd3',
      revoked: ['d1'],
      note: null,
    });
    expect(restored.title).toBe('Restored as Laptop');
    expect(restored.lead).toContain('as d3');
    expect(restored.lead).toContain('Locked out: d1.');
    expect(heading({ screen: 'master-removed' }).title).toBe('This computer no longer keeps your master key');
    expect(heading({ screen: 'remove-master', error: null }).lead).toContain('your 12 words, still add and remove');
    const devices = heading({
      screen: 'restore-devices',
      did: 'did:scid:coasys:1:Qm',
      devices: [],
      note: 'Your record could not be read.',
    }).lead;
    expect(devices).toContain('Tick each one you lost');
    expect(devices).toContain('Your record could not be read.');
  });

  it('never draws the 12 words on a screen after the words entry', () => {
    // The window draws only what a screen carries: none of the later screens has a field for words.
    const later: Screen[] = [
      { screen: 'enter-words', purpose: 'restore', error: 'Word 3 is not one of the words.', position: 3 },
      { screen: 'restore-devices', did: 'did:scid:coasys:1:Qm', devices: [], note: null },
      { screen: 'master-replaced', index: 1, revoked: [], note: null },
      { screen: 'restored', did: 'did:scid:coasys:1:Qm', name: 'Laptop', keyId: 'd3', revoked: [], note: null },
      { screen: 'master-removed' },
    ];
    for (const screen of later) expect(Object.keys(screen)).not.toContain('words');
    // The fields are emptied as soon as another screen is drawn.
    expect(windowSource).toMatch(/if \(screen\.screen !== 'enter-words'\) forgetWords\(\);/);
  });

  it('names why a kept identity can never be published, and waits for the person to discard it', () => {
    const refused = {
      screen: 'pending-refused' as const,
      did: 'did:scid:coasys:1:Qm',
      message: 'The identity store holds a different log for did:scid:coasys:1:Qm.',
    };
    expect(heading(refused).lead).toContain('different log');
    expect(heading(refused).lead).toContain('Trying again will not change that');
    expect(isLast(refused)).toBe(false);
  });

  it('ends on the screens that end a step', () => {
    expect(isLast({ screen: 'identity-ready', did: 'did:scid:coasys:1:Qm', keyId: 'd1' })).toBe(true);
    expect(isLast({ screen: 'revoked', keyId: 'd2', seq: 2 })).toBe(true);
    expect(isLast({ screen: 'show-words', words: [] })).toBe(false);
    expect(isLast({ screen: 'offer', link: '', qrSvg: '', expires: 0 })).toBe(false);
    for (const last of [
      { screen: 'joined' as const, did: 'did:scid:coasys:1:Qm', keyId: 'd2' },
      { screen: 'master-taken' as const, did: 'did:scid:coasys:1:Qm', note: null },
      { screen: 'request-answered' as const, kind: 'send-master' as const, device: 'Phone', note: null },
      { screen: 'asked' as const, keyId: 'd2', fingerprint: 'AbCd 1234', code: 'R7K Q2M' },
      { screen: 'renamed' as const, keyId: 'd2', name: 'Laptop' },
      { screen: 'master-replaced' as const, index: 1, revoked: [], note: null },
      {
        screen: 'restored' as const,
        did: 'did:scid:coasys:1:Qm',
        name: 'Laptop',
        keyId: 'd3',
        revoked: [],
        note: null,
      },
      { screen: 'master-removed' as const },
    ]) {
      expect(isLast(last), last.screen).toBe(true);
    }
    // The waits draw a screen and ask for the next; the person ends them only by cancelling.
    for (const waiting of [
      { screen: 'code-sent' as const, expires: 0 },
      { screen: 'device-code' as const, code: '', qrSvg: '', expires: 0 },
      { screen: 'device-match' as const, code: '', did: '' },
      { screen: 'restore-devices' as const, did: '', devices: [], note: null },
      { screen: 'remove-master' as const, error: null },
    ]) {
      expect(isLast(waiting), waiting.screen).toBe(false);
    }
  });

  it('names no app: the host titles the window, so a WE build and a Coasys build say their own name', () => {
    for (const source of [windowSource, screensSource]) expect(source).not.toMatch(/Coasys/);
  });

  it('runs under the strict policy: no remote content, no inline script, no string sinks', () => {
    expect(IDENTITY_CSP).toContain("default-src 'none'");
    expect(IDENTITY_CSP).toContain("script-src 'self'");
    expect(IDENTITY_CSP).not.toMatch(/unsafe-(inline|eval)|https:/);
    expect(IDENTITY_CSP).toContain("require-trusted-types-for 'script'");
  });

  it('imports no code of WE: no template, store or module code reaches the window', () => {
    // Stylesheets only: the token ramps, and the themes `vite.js` works out at build time.
    const styles = ['@we/tokens/css/color', 'virtual:we-identity-theme.css'];
    for (const source of [indexSource, windowSource, screensSource]) {
      const imports = [...source.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1]);
      for (const name of imports) expect(name.startsWith('./') || styles.includes(name)).toBe(true);
      expect(source).not.toMatch(/\.(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\(/);
    }
  });
});
