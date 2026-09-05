/**
 * The guest link rule, in both directions.
 *
 * The cases that matter are the refusals. A guest link is the one URL in the app that makes a
 * browser open a session against a host named in a query string, so what it *declines* is the
 * whole of its security story — and a link the app hands out that it would itself refuse is a
 * bug that only shows up in somebody else's browser.
 */
import {
  buildGuestLink,
  consumeGuestBootTarget,
  isAllowedGuestHost,
  parseGuestLink,
  writeGuestBootTarget,
} from '@shared/guestLink';
import { describe, expect, it } from 'vitest';

const SPACE = 'QmSpaceCid123';

describe('isAllowedGuestHost', () => {
  it('accepts TLS executors anywhere', () => {
    expect(isAllowedGuestHost('https://node.example.com')).toBe(true);
    expect(isAllowedGuestHost('wss://node.example.com:12000')).toBe(true);
  });

  it('accepts plain HTTP only on a network the recipient is already inside', () => {
    // The setup this feature is developed against: a LAN address and a tailnet address.
    expect(isAllowedGuestHost('http://192.168.1.20:12000')).toBe(true);
    expect(isAllowedGuestHost('http://100.101.102.103:12000')).toBe(true);
    expect(isAllowedGuestHost('http://my-box.ts.net:12000')).toBe(true);
    expect(isAllowedGuestHost('http://my-box.local:12000')).toBe(true);
    expect(isAllowedGuestHost('http://localhost:12000')).toBe(true);
    expect(isAllowedGuestHost('http://10.0.0.5:12000')).toBe(true);
    expect(isAllowedGuestHost('http://172.16.0.5:12000')).toBe(true);
  });

  it('refuses plain HTTP to a public address', () => {
    // Being walked into an unauthenticated plaintext session by clicking a link.
    expect(isAllowedGuestHost('http://node.example.com:12000')).toBe(false);
    expect(isAllowedGuestHost('ws://node.example.com:12000')).toBe(false);
  });

  it('refuses a host that is not an executor URL at all', () => {
    expect(isAllowedGuestHost('javascript:alert(1)')).toBe(false);
    expect(isAllowedGuestHost('data:text/html,hi')).toBe(false);
    expect(isAllowedGuestHost('file:///etc/passwd')).toBe(false);
    expect(isAllowedGuestHost('not a url')).toBe(false);
    expect(isAllowedGuestHost('')).toBe(false);
  });

  it('refuses credentials smuggled into the authority', () => {
    // Reads as "node.example.com" to anybody skimming the link; connects to evil.example.
    expect(isAllowedGuestHost('https://node.example.com@evil.example')).toBe(false);
    expect(isAllowedGuestHost('https://user:pass@evil.example')).toBe(false);
  });

  // 172.16–172.31 is private; 172.15 and 172.32 are not, and a regex is easy to get wrong here.
  it('bounds the 172.16/12 range at both ends', () => {
    expect(isAllowedGuestHost('http://172.15.0.1:12000')).toBe(false);
    expect(isAllowedGuestHost('http://172.32.0.1:12000')).toBe(false);
  });
});

describe('parseGuestLink', () => {
  it('reads the canonical link', () => {
    expect(
      parseGuestLink(`https://we.example/join/${SPACE}?host=${encodeURIComponent('https://node.example')}`),
    ).toEqual({
      spaceId: SPACE,
      hostUrl: 'https://node.example',
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseGuestLink(`https://we.example/join/${SPACE}/?host=https%3A%2F%2Fnode.example`)?.spaceId).toBe(SPACE);
  });

  it('is not a guest link without a host', () => {
    expect(parseGuestLink(`https://we.example/join/${SPACE}`)).toBeNull();
  });

  it('is not a guest link on any other path', () => {
    expect(parseGuestLink(`https://we.example/space/${SPACE}?host=https%3A%2F%2Fnode.example`)).toBeNull();
    expect(parseGuestLink('https://we.example/join?host=https%3A%2F%2Fnode.example')).toBeNull();
  });

  it('refuses extra path segments rather than reading them as part of the space id', () => {
    // `(.+)` matched here and produced the space id `a/b`, which is not a refusal and not an id.
    expect(parseGuestLink('https://we.example/join/a/b?host=https%3A%2F%2Fnode.example')).toBeNull();
  });

  it('refuses a host it would not connect to', () => {
    expect(
      parseGuestLink(`https://we.example/join/${SPACE}?host=${encodeURIComponent('http://evil.example')}`),
    ).toBeNull();
    expect(parseGuestLink(`https://we.example/join/${SPACE}?host=javascript%3Aalert(1)`)).toBeNull();
  });

  it('refuses a segment that cannot be decoded', () => {
    expect(parseGuestLink('https://we.example/join/%E0%A4%A?host=https%3A%2F%2Fnode.example')).toBeNull();
  });
});

describe('buildGuestLink', () => {
  const ok = { origin: 'https://we.example', serverUrl: 'https://node.example', sharedId: SPACE };

  it('round-trips through the parser', () => {
    // The property that matters: the app never hands out a link it would itself decline.
    const link = buildGuestLink(ok);
    expect(link).not.toBe('');
    expect(parseGuestLink(link)).toEqual({ spaceId: SPACE, hostUrl: 'https://node.example' });
  });

  it('round-trips a LAN deployment', () => {
    const link = buildGuestLink({
      origin: 'http://192.168.1.20:5173',
      serverUrl: 'http://192.168.1.20:12000',
      sharedId: SPACE,
    });
    expect(parseGuestLink(link)).toEqual({ spaceId: SPACE, hostUrl: 'http://192.168.1.20:12000' });
  });

  it('has nothing to offer without a shared id or a server', () => {
    expect(buildGuestLink({ ...ok, sharedId: undefined })).toBe('');
    expect(buildGuestLink({ ...ok, sharedId: '' })).toBe('');
    expect(buildGuestLink({ ...ok, serverUrl: undefined })).toBe('');
    expect(buildGuestLink({ ...ok, origin: undefined })).toBe('');
  });

  it('refuses a loopback address on either half', () => {
    // Both resolve to the *recipient's* machine, so the link works for its author and nobody else.
    expect(buildGuestLink({ ...ok, serverUrl: 'http://localhost:12000' })).toBe('');
    expect(buildGuestLink({ ...ok, serverUrl: 'http://127.0.0.1:12000' })).toBe('');
    expect(buildGuestLink({ ...ok, origin: 'http://localhost:5173' })).toBe('');
  });

  it('refuses to build what it would refuse to read', () => {
    expect(buildGuestLink({ ...ok, serverUrl: 'http://node.example:12000' })).toBe('');
  });

  it('encodes the shared id, and reads back an id that is one', () => {
    // A CID is the ordinary case and needs no escaping, but the encode has to be there: the id goes
    // into a path segment, and a builder that assumed the safe alphabet would be wrong the day one
    // arrives that is not.
    const link = buildGuestLink({ ...ok, sharedId: 'Qm-Space.1_2' });
    expect(link).toContain('/join/Qm-Space.1_2');
    expect(parseGuestLink(link)?.spaceId).toBe('Qm-Space.1_2');
  });

  it('refuses a link whose id decodes to something that is not an id', () => {
    /*
      `[^/]+` excludes a slash from the *encoded* segment and `%2F` decodes to one, so the path
      match cannot vouch for what comes out — and what comes out is interpolated into
      `navigate('/space/…')` and handed to `joinSpace`.
    */
    const built = buildGuestLink({ ...ok, sharedId: 'a/b' });
    expect(built).toContain('/join/a%2Fb');
    expect(parseGuestLink(built)).toBeNull();
    expect(
      parseGuestLink(`https://we.example/join/${encodeURIComponent('x?y=1')}?host=https://node.example`),
    ).toBeNull();
  });
});

describe('the boot-target handoff', () => {
  it('is consumed exactly once', () => {
    writeGuestBootTarget({ spaceId: SPACE, autoJoin: true });
    expect(consumeGuestBootTarget()).toEqual({ spaceId: SPACE, autoJoin: true });
    // A remount must not join a second time.
    expect(consumeGuestBootTarget()).toBeNull();
  });

  it('is null when no entry point wrote one', () => {
    expect(consumeGuestBootTarget()).toBeNull();
  });
});
