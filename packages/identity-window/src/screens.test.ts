/**
 * The identity window's wording, and that its bundle and policy stay narrow: the window shows the
 * recovery words, so nothing a template or a post can influence may load or run in it.
 */
import { describe, expect, it } from 'vitest';

// The policy as `vite.js` writes it into the built page.
import policy from '../csp.txt?raw';
import css from './identity.css?raw';
import indexSource from './index.ts?raw';
import {
  actionsLine,
  BOT_ACTIONS,
  deviceMatchActions,
  deviceMatchNote,
  heading,
  isLast,
  oneAtATime,
  refusedField,
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

  it('says what the words do: add and remove devices, restore the identity, replace the master key', () => {
    const lead = heading({ screen: 'show-words', words: [] }).lead;
    expect(lead).toContain('restore your identity');
    expect(lead).toContain('replace your master key');
    // Nothing this app cannot do: the words bring back no stolen data and no other keys.
    expect(lead).not.toMatch(/stolen|restore everything/);
  });

  it('titles the words entry by what the words are for', () => {
    const entry = { screen: 'enter-words' as const, error: null, position: null };
    expect(heading({ ...entry, purpose: 'replace' }).title).toBe('Replace master key');
    expect(heading({ ...entry, purpose: 'restore' }).title).toBe('Restore with recovery phrase');
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
    expect(replaced.title).toBe('Master key replaced');
    expect(replaced.lead).toContain('The old one no longer works on any device.');
    expect(replaced.lead).toContain('Also removed: d2.');
    expect(heading({ screen: 'master-replaced', index: 2, revoked: [], note: 'Late.' }).lead).not.toContain('removed');
    const restored = heading({
      screen: 'restored',
      did: 'did:scid:coasys:1:Qm',
      name: 'Laptop',
      keyId: 'd3',
      revoked: ['d1'],
      note: null,
    });
    expect(restored.title).toBe('Identity restored');
    expect(restored.lead).toContain('linked as Laptop');
    expect(restored.lead).toContain('Removed: d1.');
    expect(heading({ screen: 'master-removed' }).title).toBe('Master key removed');
    expect(heading({ screen: 'remove-master', error: null }).lead).toContain(
      'your recovery phrase, can still add and remove',
    );
    const devices = heading({
      screen: 'restore-devices',
      did: 'did:scid:coasys:1:Qm',
      devices: [],
      note: "Couldn't read your device list, so devices show without names.",
    }).lead;
    expect(devices).toContain('Select each device you lost');
    expect(devices).toContain("Couldn't read your device list, so devices show without names.");
  });

  it('says the key is replaced even when this computer could not keep it, and offers to try again', () => {
    const notKept: Screen = {
      screen: 'master-not-kept',
      index: 2,
      revoked: ['d2'],
      reason: 'The unlock was cancelled.',
      note: null,
    };
    const { title, lead } = heading(notKept);
    expect(title).toBe('New master key not saved');
    expect(lead).toContain('the old one no longer works');
    expect(lead).toContain('The unlock was cancelled.');
    expect(lead).toContain('Also removed: d2.');
    expect(lead).toContain('Enter your recovery phrase again');
    const notLinked: Screen = {
      screen: 'restore-not-linked',
      did: 'did:scid:coasys:1:Qm',
      revoked: ['d1'],
      reason: 'Key storage error: locked.',
    };
    expect(heading(notLinked).title).toBe("This computer isn't linked yet");
    expect(heading(notLinked).lead).toContain('Removed: d1.');
    expect(heading(notLinked).lead).toContain('Key storage error: locked.');
    // After a publish, never "Nothing changed".
    for (const screen of [notKept, notLinked]) {
      expect(`${heading(screen).title} ${heading(screen).lead}`).not.toMatch(/nothing (was )?changed/i);
      // Not a last screen: Done would end the step as done, and closing would not cancel the wait.
      expect(isLast(screen), screen.screen).toBe(false);
    }
    // Each offers its try-again, and Close cancels the step that waits for it.
    expect(windowSource).toMatch(
      /case 'master-not-kept':[\s\S]*?step\(\{ kind: 'try-again' \}\)[\s\S]*?button\('Close', cancel\)/,
    );
    expect(windowSource).toMatch(
      /case 'restore-not-linked':[\s\S]*?step\(\{ kind: 'try-again' \}\)[\s\S]*?button\('Close', cancel\)/,
    );
  });

  it('marks only the refused word field invalid, with a token value, and draws it', () => {
    expect(Array.from({ length: 12 }, (_, i) => refusedField(3, i))).toEqual(
      Array.from({ length: 12 }, (_, i) => i === 2),
    );
    expect(Array.from({ length: 12 }, (_, i) => refusedField(null, i)).some(Boolean)).toBe(false);
    // `aria-invalid` is set to "true" or removed, never toggled empty; focus and style read "true".
    expect(windowSource).not.toMatch(/toggleAttribute\('aria-invalid'/);
    expect(windowSource).toContain("input.setAttribute('aria-invalid', 'true')");
    expect(windowSource).toContain("input.removeAttribute('aria-invalid')");
    expect(windowSource).toContain(`root.querySelector<HTMLInputElement>('input[aria-invalid="true"]')`);
    expect(css).toMatch(
      /input\[aria-invalid='true'\] \{[^}]*border-color: var\(--danger\)[^}]*outline: 2px solid var\(--danger\)/,
    );
  });

  it('fits three word fields to a row however narrow the window', () => {
    expect(css).toMatch(/\.words \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.word input \{[^}]*min-width: 0;[^}]*width: 100%;/);
  });

  it('keeps each field inside its box: padding and border count in its width', () => {
    // A word field at `width: 100%` without it is its padding and border wider than its card, and
    // runs over the next one.
    expect(css).toMatch(/\.word input \{[^}]*box-sizing: border-box;/);
    expect(css).toMatch(/input\[type='text'\],\s*input\[type='password'\] \{[^}]*box-sizing: border-box;/);
  });

  it('puts a word field beside its number, so the twelve fit the 640 px window', () => {
    expect(css).toMatch(/label\.word \{[^}]*flex-direction: row;/);
  });

  it('never draws the 12 words on a screen after the words entry', () => {
    // The window draws only what a screen carries: none of the later screens has a field for words.
    const later: Screen[] = [
      {
        screen: 'enter-words',
        purpose: 'restore',
        error: "Word 3 isn't a recovery phrase word. Check its spelling.",
        position: 3,
      },
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
      { screen: 'device-match' as const, code: '', did: '', needsAccept: false, accepted: false, confirmed: false },
      { screen: 'device-match' as const, code: '', did: '', needsAccept: true, accepted: true, confirmed: false },
      { screen: 'restore-devices' as const, did: '', devices: [], note: null },
      { screen: 'remove-master' as const, error: null },
    ]) {
      expect(isLast(waiting), waiting.screen).toBe(false);
    }
  });

  it('adds a bot in four screens: its scope, the offer to paste, the match code, and what is next', () => {
    expect(heading({ screen: 'bot-scope', error: null }).title).toBe('Add a bot');
    expect(heading({ screen: 'bot-scope', error: null }).lead).toContain('pause or remove it');
    expect(BOT_ACTIONS.map((a) => a.action)).toEqual(['read', 'write', 'join']);
    expect(actionsLine(['read'])).toBe('read');
    expect(actionsLine(['read', 'write', 'join'])).toBe('read, write and join');
    const offer: Screen = {
      screen: 'bot-offer',
      offer: 'coasys:offer:1:x',
      can: ['read', 'write'],
      keyExpires: 1_800_000_000,
      expires: 1_700_000_300,
    };
    expect(heading(offer).lead).toContain('Settings → Bots');
    expect(heading(offer).lead).toContain('can read and write until');
    expect(heading({ screen: 'bot-match', code: '123456', name: 'Test bot' }).title).toBe('Add Test bot?');
    expect(heading({ screen: 'bot-match', code: '123456', name: null }).title).toBe('Add this bot?');
    const added: Screen = { screen: 'bot-added', seq: 4, keyId: 'd3', name: 'Test bot', note: null };
    expect(heading(added)).toEqual({
      title: 'Test bot added',
      lead: "It can't do anything yet. Choose its spaces in Settings → Bots.",
    });
    expect(heading({ ...added, note: 'Its name was not saved.' }).lead).toContain('Its name was not saved.');
    expect(isLast(added)).toBe(true);
    for (const open of [offer, { screen: 'bot-scope', error: null } as Screen]) expect(isLast(open)).toBe(false);
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
