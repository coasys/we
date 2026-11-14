/**
 * The identity window's wording, and that its bundle and policy stay narrow: the window shows the
 * recovery words, so nothing a template or a post can influence may load or run in it.
 */
import { describe, expect, it } from 'vitest';

// The policy as `vite.js` writes it into the built page.
import policy from '../csp.txt?raw';
import indexSource from './index.ts?raw';
import {
  deviceMatchActions,
  deviceMatchNote,
  heading,
  isLast,
  oneAtATime,
  remaining,
  type RevokeTarget,
  type Screen,
  targetLine,
  wordNumber,
} from './screens';
import screensSource from './screens.ts?raw';
import windowSource from './window.ts?raw';

const IDENTITY_CSP = policy.trim();

describe('the identity window', () => {
  it('says what a revocation does, and promises nothing about earlier signatures', () => {
    const confirm = { screen: 'revoke-confirm' as const, keyId: 'd2', passphrase: false, error: null };
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
      passphrase: false,
      error: null,
    }).lead;
    expect(lead).toContain('may still have your master key');
    expect(lead).toContain('Replace your master key');
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
    expect(send.title).toBe('Send master key to d2?');
    expect(send.lead).toContain('Listed as “Phone”');
    expect(send.lead).toContain('same code and key');
    expect(send.lead).toContain('add and remove devices');
    // The code and the log's key and fingerprint are drawn under the heading on both cards.
    expect(windowSource).toContain("el('div', { className: 'code', textContent: screen.code }),");
    expect(windowSource).toContain('textContent: `${screen.keyId} · key ${screen.fingerprint}`');
    expect(windowSource).toMatch(/case 'request': \{[\s\S]*?\.\.\.whoAsks\(screen\)/);

    // A record that renamed the target "Old desktop" and said it keeps no master key: the card
    // still says which key goes, by the log's key id and fingerprint, and that it may hold one.
    const targets: RevokeTarget[] = [
      { keyId: 'd3', fingerprint: 'WxYz 5678', recordName: 'Old desktop', mayHoldMaster: true },
      { keyId: 'd4', fingerprint: 'QrSt 9012', recordName: null, mayHoldMaster: false },
    ];
    const revoke = heading({ ...request, kind: 'confirm-revoke', device: 'Laptop', targets });
    expect(revoke.title).toBe('Remove d3, d4?');
    expect(revoke.title).not.toContain('Old desktop');
    expect(revoke.lead).toContain('Asked by d2, listed as “Laptop”');
    expect(revoke.lead).toContain('same code and key');
    expect(revoke.lead).toContain('d3 may still have your master key');
    expect(revoke.lead).toContain('Replace your master key');
    expect(revoke.lead).not.toContain('d4 may');
    expect(targetLine(targets[0])).toBe('d3 · key WxYz 5678 · listed as “Old desktop” · may have master key');
    expect(targetLine(targets[1])).toBe('d4 · key QrSt 9012');

    const none = heading({ ...request, kind: 'confirm-revoke', device: 'Laptop', targets: [targets[1]] });
    expect(none.lead).not.toContain('master key');
  });

  it('says on a linked device what it can and cannot do, and what is still on its way', () => {
    expect(heading({ screen: 'joined', did: 'did:scid:coasys:1:Qm', keyId: 'd2' }).lead).toContain(
      "doesn't have the master key",
    );
    const linked = heading({ screen: 'linked', seq: 3, masterSent: true, note: 'Its name is not saved yet.' }).lead;
    expect(linked).toContain('entry #3');
    expect(linked).toContain('It gets the master key the next time it unlocks.');
    expect(linked).toContain('Its name is not saved yet.');
    expect(heading({ screen: 'linked', seq: 3, masterSent: false, note: null }).lead).toBe(
      'Your key log records it as entry #3.',
    );
  });

  it('titles the device steps as the Devices page names them', () => {
    expect(heading({ screen: 'enter-code', error: null }).title).toBe('Enter code');
    expect(heading({ screen: 'device-code', code: 'coasys:device:1:x', qrSvg: '', expires: 0 }).lead).toContain(
      'choose Enter code',
    );
    const asked = heading({ screen: 'asked', keyId: 'd2', fingerprint: 'AbCd 1234', code: 'R7K Q2M' }).lead;
    expect(asked).toContain('Accept master key');
    // The holder's card shows the same key and code: this one draws them under its heading.
    expect(asked).toContain('Check that it shows this code');
    expect(windowSource).toMatch(/case 'asked':\s+return whoAsks\(screen\);/);
    expect(heading({ screen: 'renamed', keyId: 'd2', name: 'Laptop' }).title).toBe('Renamed to Laptop');
  });

  it('on a first run, asks whether the identity is yours before this computer joins it', () => {
    const card = (needsAccept: boolean, accepted: boolean, confirmed: boolean) =>
      ({
        screen: 'device-match',
        code: 'R7K Q2M',
        did: 'did:scid:coasys:1:Qm',
        needsAccept,
        accepted,
        confirmed,
      }) satisfies Screen;

    // Not a first run: the other device confirms, and nothing is asked here.
    expect(heading(card(false, false, false))).toEqual({
      title: 'Check the code',
      lead: 'If it matches the code on your other device, confirm there.',
    });
    expect(deviceMatchNote(card(false, false, false))).toBe('Waiting for your other device…');

    const ask = heading(card(true, false, false));
    expect(ask.title).toBe('Is this your identity?');
    expect(ask.lead).toBe('If the code matches your other device, confirm on both.');
    expect(deviceMatchNote(card(true, false, false))).toBe('Waiting for both devices…');

    // The other device confirmed first: still asked here, and told what is left.
    const confirmed = heading(card(true, false, true));
    expect(confirmed.title).toBe('Is this your identity?');
    expect(confirmed.lead).toContain('Your other device confirmed.');
    expect(confirmed.lead).toContain('confirm here too');
    expect(deviceMatchNote(card(true, false, true))).toBeNull();

    // Accepted here: it waits for the other device.
    const accepted = heading(card(true, true, false));
    expect(accepted.title).toBe('Confirm on your other device');
    expect(accepted.lead).toBe('This computer is linked once you confirm there too.');
    expect(deviceMatchNote(card(true, true, false))).toBe('Waiting for your other device…');
  });

  it('offers “Confirm” only while the accept is still asked, and waits once', () => {
    const card = (needsAccept: boolean, accepted: boolean, confirmed: boolean) =>
      ({ screen: 'device-match', code: 'R7K Q2M', did: 'did:scid:x', needsAccept, accepted, confirmed }) as const;
    expect(deviceMatchActions(card(false, false, false))).toEqual({ wait: true, accept: false });
    expect(deviceMatchActions(card(true, false, false))).toEqual({ wait: true, accept: true });
    // The other device confirmed (`awaiting-accept`): the button stays.
    expect(deviceMatchActions(card(true, false, true))).toEqual({ wait: true, accept: true });
    // After the accept, the accept is the wait: the window asks for no second one.
    expect(deviceMatchActions(card(true, true, false))).toEqual({ wait: false, accept: false });
    expect(windowSource).toContain("button('Confirm', () => step({ kind: 'accept' }), 'primary')");
  });

  it('sends one cancel for a double click, and answers both clicks with its screen', async () => {
    const joined = { screen: 'joined' as const, did: 'did:scid:x', keyId: 'd2' };
    let sent = 0;
    let answer: (screen: Screen | null) => void = () => {};
    const cancel = oneAtATime(() => {
      sent += 1;
      return new Promise<Screen | null>((resolve) => (answer = resolve));
    });
    const first = cancel();
    const second = cancel();
    expect(sent).toBe(1);
    answer(joined);
    expect(await first).toEqual(joined);
    expect(await second).toEqual(joined);
    // Answered, the next click is a cancel of its own.
    void cancel();
    expect(sent).toBe(2);
    expect(windowSource).toContain('const cancel = oneAtATime(');
  });

  it('says what the words do today, and promises no restore or replacement this app cannot run', () => {
    const lead = heading({ screen: 'show-words', words: [] }).lead;
    expect(lead).toContain('adds and removes your devices');
    expect(lead).not.toMatch(/stolen|replace|restore everything/);
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
    ]) {
      expect(isLast(last), last.screen).toBe(true);
    }
    // The waits draw a screen and ask for the next; the person ends them only by cancelling.
    for (const waiting of [
      { screen: 'code-sent' as const, expires: 0 },
      { screen: 'device-code' as const, code: '', qrSvg: '', expires: 0 },
      { screen: 'device-match' as const, code: '', did: '', needsAccept: false, accepted: false, confirmed: false },
      { screen: 'device-match' as const, code: '', did: '', needsAccept: true, accepted: true, confirmed: false },
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
