import { describe, expect, it } from 'vitest';

import { formatNetworkMetrics } from '../src/networkMetrics';

/** A 39-byte hash of the given type: `[0x84, type, 0x24]`, a core, and a location. */
function hashBytes(type: number, fill = 7): number[] {
  return [0x84, type, 0x24, ...Array.from({ length: 36 }, (_, i) => (fill + i * 13) % 256)];
}

/** What `@holochain/client`'s `encodeHashToBase64` writes, computed independently. */
function expected(bytes: number[]): string {
  return `u${Buffer.from(bytes).toString('base64url')}`;
}

describe('formatNetworkMetrics', () => {
  it('writes a hash that arrived as bytes as its string form', () => {
    const agent = hashBytes(0x20);
    const dna = hashBytes(0x2d, 99);
    const out = JSON.parse(formatNetworkMetrics(JSON.stringify({ local_agents: [{ agent }], dna })));

    expect(out.local_agents[0].agent).toBe(expected(agent));
    expect(out.dna).toBe(expected(dna));
    expect(out.dna.startsWith('uhC0k')).toBe(true);
  });

  it('leaves a byte array that is not a hash as numbers, on one line', () => {
    // 39 bytes with no Holochain prefix, and a short key: neither is decodable, and neither should
    // be spread one number per line.
    const unprefixed = Array.from({ length: 39 }, (_, i) => i);
    const out = formatNetworkMetrics(JSON.stringify({ unprefixed, key: [1, 2, 3] }));

    expect(out).toContain(`"unprefixed": [${unprefixed.join(', ')}]`);
    expect(out).toContain('"key": [1, 2, 3]');
    expect(JSON.parse(out).unprefixed).toEqual(unprefixed);
  });

  it('does not take a 39-number array with a hash prefix but non-byte values for a hash', () => {
    const notBytes = [...hashBytes(0x20).slice(0, 38), 256];
    expect(JSON.parse(formatNetworkMetrics(JSON.stringify({ notBytes }))).notBytes).toEqual(notBytes);
  });

  it('indents structure so the viewer has something to fold', () => {
    const out = formatNetworkMetrics('{"metrics":{"a":{"b":[{"c":1}]}},"stats":{}}');

    expect(out).toBe(
      [
        '{',
        '  "metrics": {',
        '    "a": {',
        '      "b": [',
        '        {',
        '          "c": 1',
        '        }',
        '      ]',
        '    }',
        '  },',
        '  "stats": {}',
        '}',
      ].join('\n'),
    );
  });

  it('returns text that is not JSON exactly as it came', () => {
    expect(formatNetworkMetrics('conductor not running')).toBe('conductor not running');
  });
});
