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
    expect(heading({ screen: 'match', code: 'R7K Q2M', hint: 'server b' }).title).toBe('Add server b?');
    expect(heading({ screen: 'match', code: 'R7K Q2M', hint: null }).title).toBe('Add this device?');
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
  });

  it('runs under the strict policy: no remote content, no inline script, no string sinks', () => {
    expect(IDENTITY_CSP).toContain("default-src 'none'");
    expect(IDENTITY_CSP).toContain("script-src 'self'");
    expect(IDENTITY_CSP).not.toMatch(/unsafe-(inline|eval)|https:/);
    expect(IDENTITY_CSP).toContain("require-trusted-types-for 'script'");
  });

  it('imports nothing of WE: no template, store or module code reaches the window', () => {
    for (const source of [indexSource, windowSource, screensSource]) {
      const imports = [...source.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1]);
      for (const name of imports) expect(name.startsWith('./')).toBe(true);
      expect(source).not.toMatch(/\.(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\(/);
    }
  });
});
