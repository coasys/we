/**
 * Reading a grant out of a token.
 *
 * Worth testing because the failure is silent in both directions and neither shows up as an error: a
 * decoder that under-reports hides working controls, one that over-reports offers controls the
 * executor refuses. The bug that started this returned "unready" for every transcription model and
 * surfaced as "no model is installed" — a confident wrong answer, which is the shape of mistake this
 * whole file is defending against.
 */
import { describe, expect, it } from 'vitest';

import { capabilitiesFromToken, createCapabilityCheck } from '../src/capabilities';

/** A JWT with the given payload. Unsigned — nothing here verifies, by design. */
function token(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${body}.signature`;
}

const AI = 'artificial intelligence';

describe('capabilitiesFromToken', () => {
  it('reads the list the executor nests under claims.capabilities.capabilities', () => {
    const capabilities = capabilitiesFromToken(
      token({
        capabilities: {
          appName: 'WE',
          capabilities: [{ with: { domain: AI, pointers: ['*'] }, can: ['READ'] }],
          userEmail: 'james@weco.io',
        },
      }),
    );

    expect(capabilities).toEqual([{ with: { domain: AI, pointers: ['*'] }, can: ['READ'] }]);
  });

  // Every one of these means "unknown", and every caller must read that as "assume permitted" —
  // see the check tests below. An empty token is the *local* case: the executor answers it with
  // ALL_CAPABILITY when no admin credential is set.
  it.each([
    ['an empty token', ''],
    ['no token at all', undefined],
    ['the admin credential, which is not a JWT', 'some-shared-secret'],
    ['a JWT carrying no capability list', token({ capabilities: { appName: 'WE' } })],
    ['a JWT whose payload is not JSON', 'a.bm90LWpzb24.c'],
  ])('returns null for %s', (_case, value) => {
    expect(capabilitiesFromToken(value)).toBeNull();
  });

  it('decodes base64url padding rather than choking on it', () => {
    // Payload lengths that are not a multiple of four are the common case, and `atob` rejects them
    // unpadded. Getting this wrong would read every real token as "unknown" — which fails open, so
    // it would never be noticed.
    for (const name of ['a', 'ab', 'abc', 'abcd']) {
      const decoded = capabilitiesFromToken(
        token({
          capabilities: { appName: name, capabilities: [{ with: { domain: AI, pointers: ['*'] }, can: ['READ'] }] },
        }),
      );
      expect(decoded).toHaveLength(1);
    }
  });
});

describe('createCapabilityCheck', () => {
  it('assumes permitted when the grant is unknown', () => {
    const granted = createCapabilityCheck(null);
    expect(granted(AI, 'READ')).toBe(true);
    expect(granted(AI, 'DELETE')).toBe(true);
  });

  it('refuses everything for an explicitly empty grant', () => {
    // Distinct from null: the token said, in as many words, that it holds nothing.
    const granted = createCapabilityCheck([]);
    expect(granted(AI, 'READ')).toBe(false);
  });

  it('matches domain and verb exactly', () => {
    const granted = createCapabilityCheck([{ with: { domain: AI, pointers: ['*'] }, can: ['READ', 'PROMPT'] }]);

    expect(granted(AI, 'READ')).toBe(true);
    expect(granted(AI, 'PROMPT')).toBe(true);
    expect(granted(AI, 'UPDATE')).toBe(false);
    expect(granted('language', 'READ')).toBe(false);
  });

  it('honours wildcards on either side', () => {
    expect(createCapabilityCheck([{ with: { domain: '*', pointers: ['*'] }, can: ['READ'] }])(AI, 'READ')).toBe(true);
    expect(createCapabilityCheck([{ with: { domain: AI, pointers: ['*'] }, can: ['*'] }])(AI, 'DELETE')).toBe(true);
  });

  it('does not confuse the AI domain with the word "ai"', () => {
    // The executor's constant is the phrase, not the abbreviation. Spelling it `ai` here would read
    // as "not granted" against every real token and quietly hide the section.
    const granted = createCapabilityCheck([{ with: { domain: AI, pointers: ['*'] }, can: ['READ'] }]);
    expect(granted('ai', 'READ')).toBe(false);
    expect(granted(AI, 'READ')).toBe(true);
  });

  it('reproduces the grant AD4M actually issues a hosted user', () => {
    // Straight from `get_user_default_capabilities`: read and use, never administer.
    const granted = createCapabilityCheck([
      { with: { domain: AI, pointers: ['*'] }, can: ['READ'] },
      { with: { domain: AI, pointers: ['*'] }, can: ['CREATE'] },
      { with: { domain: AI, pointers: ['*'] }, can: ['PROMPT'] },
      { with: { domain: AI, pointers: ['*'] }, can: ['TRANSCRIBE'] },
    ]);

    expect(granted(AI, 'READ')).toBe(true);
    expect(granted(AI, 'TRANSCRIBE')).toBe(true);
    expect(granted(AI, 'UPDATE')).toBe(false);
    expect(granted(AI, 'DELETE')).toBe(false);
  });
});
