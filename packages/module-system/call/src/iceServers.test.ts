/**
 * Reading a settings string into ICE servers.
 *
 * Worth testing thoroughly for a reason the code says and this restates: a mistake in this field
 * must degrade to "the default servers" and never to "nobody can call anybody". Most of what is
 * below is therefore about what happens to input that is wrong.
 */
import { describe, expect, it } from 'vitest';

import { parseIceServers } from './iceServers';

describe('ICE servers from a settings string', () => {
  it('reads one URL per line', () => {
    const { servers, problems } = parseIceServers('stun:stun.example.org:3478\nstun:stun2.example.org:3478');
    expect(servers).toEqual([{ urls: 'stun:stun.example.org:3478' }, { urls: 'stun:stun2.example.org:3478' }]);
    expect(problems).toEqual([]);
  });

  it('pulls credentials out of a turn URL', () => {
    /*
      `turn:user:pass@host` is not a real URI — RFC 7065 gives the turn scheme no userinfo, and
      handing that string to `RTCPeerConnection` throws. It is also exactly what a person writes when
      asked for a relay with a username and password, and what every relay's quick-start prints.
    */
    const { servers } = parseIceServers('turn:alice:s3cret@turn.example.org:3478');
    expect(servers).toEqual([{ urls: 'turn:turn.example.org:3478', username: 'alice', credential: 's3cret' }]);
  });

  it('keeps a password containing a colon or an at-sign intact', () => {
    // The username is split at the FIRST colon and the host at the LAST at-sign, which is what makes
    // both of these survive. A generated relay credential is base64 and routinely contains neither
    // by luck alone.
    const { servers } = parseIceServers('turns:bob:p@ss:word@turn.example.org:5349');
    expect(servers).toEqual([{ urls: 'turns:turn.example.org:5349', username: 'bob', credential: 'p@ss:word' }]);
  });

  it('accepts the JSON a relay provider hands you', () => {
    const value = JSON.stringify([
      { urls: 'turn:relay.example.org:443', username: 'u', credential: 'p' },
      { urls: ['stun:a.example.org:3478', 'stun:b.example.org:3478'] },
    ]);
    const { servers, problems } = parseIceServers(value);
    expect(servers).toEqual([
      { urls: 'turn:relay.example.org:443', username: 'u', credential: 'p' },
      { urls: ['stun:a.example.org:3478', 'stun:b.example.org:3478'] },
    ]);
    expect(problems).toEqual([]);
  });

  it('accepts commas and semicolons, because that is what a paste looks like', () => {
    const { servers } = parseIceServers('stun:a.example.org:3478, stun:b.example.org:3478');
    expect(servers).toHaveLength(2);
  });

  it('answers with nothing for an empty or absent value', () => {
    for (const value of ['', '   ', undefined, null, 42]) {
      expect(parseIceServers(value)).toEqual({ servers: [], problems: [] });
    }
  });

  it('skips a line it cannot read, and keeps the ones it can', () => {
    // The whole point: one typo costs one server, never the call.
    const { servers, problems } = parseIceServers('stun:good.example.org:3478\nhttps://not-a-stun-server\nnonsense');
    expect(servers).toEqual([{ urls: 'stun:good.example.org:3478' }]);
    expect(problems).toEqual(['https://not-a-stun-server', 'nonsense']);
  });

  it('refuses a scheme that is not an ICE scheme', () => {
    // `RTCPeerConnection` throws on one of these rather than ignoring it, which would take down the
    // whole call — the one case where being lenient here prevents an exception there.
    expect(parseIceServers('http://turn.example.org').servers).toEqual([]);
    expect(parseIceServers('turn.example.org:3478').servers).toEqual([]);
  });

  it('says so when JSON does not parse, rather than silently reading it as URLs', () => {
    const { servers, problems } = parseIceServers('[{ "urls": ');
    expect(servers).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it('drops a JSON entry with no usable url but keeps its siblings', () => {
    const value = JSON.stringify([{ username: 'u' }, { urls: 'stun:ok.example.org:3478' }]);
    const { servers, problems } = parseIceServers(value);
    expect(servers).toEqual([{ urls: 'stun:ok.example.org:3478' }]);
    expect(problems).toHaveLength(1);
  });

  it('leaves out blank credentials rather than sending empty strings', () => {
    // `{ username: '' }` is not the same as no username to a browser, and a STUN entry has neither.
    const { servers } = parseIceServers(JSON.stringify([{ urls: 'stun:a.example.org:3478', username: '' }]));
    expect(servers[0]).not.toHaveProperty('username');
  });

  it('reads the shape Flux actually shipped', () => {
    /*
      The regression this is really guarding: Flux's `defaultIceServers` is the one real-world value
      anybody is likely to paste in, because it is what a WE deployment migrating from Flux already
      has. (Its relay is decommissioned, which is why WE ships no default of its own — see the
      `iceServers` setting.)
    */
    const flux = JSON.stringify([
      { urls: 'stun:relay.ad4m.dev:3478', username: 'openrelay', credential: 'openrelay' },
      { urls: 'turn:relay.ad4m.dev:443', username: 'openrelay', credential: 'openrelay' },
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
    const { servers, problems } = parseIceServers(flux);
    expect(servers).toHaveLength(3);
    expect(servers[1]).toEqual({ urls: 'turn:relay.ad4m.dev:443', username: 'openrelay', credential: 'openrelay' });
    expect(problems).toEqual([]);
  });
});
