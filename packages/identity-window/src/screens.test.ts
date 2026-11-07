/**
 * The identity window's wording, and that its bundle and policy stay narrow: the window shows the
 * recovery words, so nothing a template or a post can influence may load or run in it.
 */
import { describe, expect, it } from 'vitest';

// The policy as `vite.js` writes it into the built page.
import policy from '../csp.txt?raw';
import indexSource from './index.ts?raw';
import { heading, isLast, remaining, wordNumber } from './screens';
import screensSource from './screens.ts?raw';
import windowSource from './window.ts?raw';

const IDENTITY_CSP = policy.trim();

describe('the identity window', () => {
  it('says what a revocation does, and promises nothing about earlier signatures', () => {
    const lead = heading({ screen: 'revoke-confirm', keyId: 'd2', passphrase: false, error: null }).lead;
    expect(lead).toContain('when they next read your key log');
    expect(lead).toContain('can also stop counting as yours');
    expect(lead).not.toContain('stays valid');
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

  it('asks the holder by name whether to send the master key, and the revoke request names each device', () => {
    const request = { screen: 'request' as const, id: 'r1', passphrase: false, error: null };
    const send = heading({ ...request, kind: 'send-master', device: 'Phone', devices: [] });
    expect(send.title).toBe('Phone asks for the master key — send it?');
    expect(send.lead).toContain('add and remove your devices');
    const revoke = heading({ ...request, kind: 'confirm-revoke', device: 'Laptop', devices: ['Old desktop', 'd4'] });
    expect(revoke.title).toBe('Laptop asks to revoke Old desktop, d4');
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
    expect(heading({ screen: 'asked' }).lead).toContain('Take the master key');
    expect(heading({ screen: 'renamed', keyId: 'd2', name: 'Laptop' }).title).toBe('Named Laptop');
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
      { screen: 'asked' as const },
      { screen: 'renamed' as const, keyId: 'd2', name: 'Laptop' },
    ]) {
      expect(isLast(last), last.screen).toBe(true);
    }
    // The waits draw a screen and ask for the next; the person ends them only by cancelling.
    for (const waiting of [
      { screen: 'code-sent' as const, expires: 0 },
      { screen: 'device-code' as const, code: '', qrSvg: '', expires: 0 },
      { screen: 'device-match' as const, code: '', did: '' },
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
