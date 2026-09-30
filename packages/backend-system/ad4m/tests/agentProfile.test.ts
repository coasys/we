/**
 * Reading a profile that somebody else's app wrote.
 *
 * An AD4M agent is not created by WE. Somebody reaching WE Web through ad4m-connect brought an
 * identity made in the ADAM Launcher, in Flux, or on a hosted node, and whatever named them there is
 * the only name they have. Three formats, none of which agree on the link source, the predicates, or
 * even how a string is encoded into a target.
 *
 * Both failures this covers were silent and neither looked like a parse error. Flux's envelope
 * rendered every one of its users as the string `[object Object]` throughout WE — bylines, call
 * tiles, member lists — and the launcher's format missed on both source and predicate at once, so
 * its users read as a completely blank profile rather than a partly-parsed one.
 */
import { Literal } from '@coasys/ad4m';
import { describe, expect, it } from 'vitest';

import { getProfile } from '../src/agentHelpers';

const DID = 'did:key:zTestAgent';

function link(source: string, predicate: string, target: string) {
  return { data: { source, predicate, target } };
}

/** A client that answers `agent.byDID` with these links and nothing else. */
function clientWith(links: ReturnType<typeof link>[]) {
  return { agent: { byDID: async () => ({ perspective: { links } }) } };
}

/**
 * What `expression.create(value, 'literal')` produces — the executor signs the content and encodes
 * the whole signed-expression envelope as the literal, rather than the value on its own. This is the
 * shape Flux's profile writer stores a name in.
 */
function signedLiteral(value: unknown): string {
  return Literal.from({
    author: DID,
    timestamp: '2026-01-01T00:00:00.000Z',
    data: value,
    proof: { signature: 'deadbeef', key: `${DID}#primary` },
  }).toUrl();
}

describe('getProfile — WE format', () => {
  it('reads a plain string literal', async () => {
    const profile = await getProfile(
      DID,
      clientWith([
        link('we://profile', 'we://first_name', Literal.from('James').toUrl()),
        link('we://profile', 'we://last_name', Literal.from('Brechin').toUrl()),
        link('we://profile', 'we://handle', Literal.from('james').toUrl()),
      ]),
    );

    expect(profile).toMatchObject({ firstName: 'James', lastName: 'Brechin', handle: 'james' });
  });

  it('strips a did:// scheme from the id it reports', async () => {
    const profile = await getProfile(`did://${DID}`, clientWith([]));
    expect(profile.did).toBe(DID);
  });
});

describe('getProfile — Flux format', () => {
  // The bug this file was opened for. `String(envelope)` is `"[object Object]"`, and that is what
  // every Flux-origin peer was called.
  it('unwraps the signed-expression envelope that expression.create writes', async () => {
    const profile = await getProfile(
      DID,
      clientWith([
        link('flux://profile', 'sioc://has_given_name', signedLiteral('James')),
        link('flux://profile', 'sioc://has_family_name', signedLiteral('Brechin')),
        link('flux://profile', 'sioc://has_username', signedLiteral('james')),
        link('flux://profile', 'sioc://has_bio', signedLiteral('Building WE.')),
      ]),
    );

    expect(profile).toMatchObject({
      firstName: 'James',
      lastName: 'Brechin',
      handle: 'james',
      bio: 'Building WE.',
    });
  });

  it('still reads a plain literal from the same source', async () => {
    const profile = await getProfile(
      DID,
      clientWith([link('flux://profile', 'sioc://has_given_name', Literal.from('James').toUrl())]),
    );
    expect(profile.firstName).toBe('James');
  });

  it('yields to the WE format when both are present', async () => {
    const profile = await getProfile(
      DID,
      clientWith([
        link('flux://profile', 'sioc://has_given_name', signedLiteral('Old')),
        link('we://profile', 'we://first_name', Literal.from('New').toUrl()),
      ]),
    );
    expect(profile.firstName).toBe('New');
  });
});

describe('getProfile — ADAM Launcher format', () => {
  // Two near-misses at once: the source is the agent's own DID rather than a `*://profile` string,
  // and the predicates are has_firstname/has_lastname rather than Flux's has_given_name/has_family_name.
  it('reads links whose source is the agent DID', async () => {
    const profile = await getProfile(
      DID,
      clientWith([
        link(DID, 'sioc://has_firstname', Literal.from('James').toUrl()),
        link(DID, 'sioc://has_lastname', Literal.from('Brechin').toUrl()),
        link(DID, 'sioc://has_username', Literal.from('james').toUrl()),
      ]),
    );

    expect(profile).toMatchObject({ firstName: 'James', lastName: 'Brechin', handle: 'james' });
  });

  it('reads the ad4m://profile source the launcher declares beside those predicates', async () => {
    const profile = await getProfile(
      DID,
      clientWith([link('ad4m://profile', 'sioc://has_firstname', Literal.from('James').toUrl())]),
    );
    expect(profile.firstName).toBe('James');
  });

  it('matches the DID source after the did:// scheme is stripped', async () => {
    const profile = await getProfile(
      `did://${DID}`,
      clientWith([link(DID, 'sioc://has_firstname', Literal.from('James').toUrl())]),
    );
    expect(profile.firstName).toBe('James');
  });
});

describe('getProfile — literal decoding', () => {
  it('accepts the pre-0.9 literal:// spelling, which Literal.fromUrl refuses outright', async () => {
    const profile = await getProfile(
      DID,
      clientWith([link('we://profile', 'we://first_name', 'literal://string:James')]),
    );
    expect(profile.firstName).toBe('James');
  });

  it('never returns a non-string, whatever the target decodes to', async () => {
    const profile = await getProfile(
      DID,
      clientWith([
        // Not an envelope — no author, no proof, no timestamp — so `data` must NOT be taken off it.
        link('we://profile', 'we://first_name', Literal.from({ data: 'James' }).toUrl()),
      ]),
    );

    expect(typeof profile.firstName).toBe('string');
    expect(profile.firstName).not.toBe('[object Object]');
  });

  it('leaves a non-literal target alone', async () => {
    const profile = await getProfile(
      DID,
      clientWith([link('we://profile', 'we://first_name', 'https://example.com/name')]),
    );
    expect(profile.firstName).toBe('https://example.com/name');
  });

  it('reads a number or boolean literal as text rather than dropping it', async () => {
    const profile = await getProfile(DID, clientWith([link('we://profile', 'we://handle', Literal.from(42).toUrl())]));
    expect(profile.handle).toBe('42');
  });
});

describe('getProfile — nothing published', () => {
  it('reports empty strings rather than throwing', async () => {
    const profile = await getProfile(DID, clientWith([]));
    expect(profile).toEqual({ did: DID, firstName: '', lastName: '', handle: '', bio: '' });
  });

  it('survives a byDID that rejects', async () => {
    const profile = await getProfile(DID, {
      agent: {
        byDID: async () => {
          throw new Error('offline');
        },
      },
    });
    expect(profile).toEqual({ did: DID, firstName: '', lastName: '', handle: '', bio: '' });
  });
});
