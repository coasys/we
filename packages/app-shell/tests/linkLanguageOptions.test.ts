/**
 * The create-space picker for how a shared space syncs. What matters is that a person can tell the
 * choices apart by what they mean, that the default stays first, and that a server they would not
 * recognise by URL is named by its host.
 */
import { describe, expect, it } from 'vitest';

import { linkLanguageOptions } from '../src/shared/linkLanguageOptions';

const P2P = { address: 'Qm-p2p', name: 'perspectiveDiffSync', kind: 'peer-to-peer' as const };
const SERVER = {
  address: 'Qm-server',
  name: 'server-link-language',
  kind: 'server' as const,
  serverUrl: 'https://links.example.org:8443/sync',
};

describe('linkLanguageOptions', () => {
  it('labels by how a space syncs, keeping the backend’s order', () => {
    const options = linkLanguageOptions([P2P, SERVER]);

    expect(options.map((o) => [o.value, o.label, o.icon])).toEqual([
      ['Qm-p2p', 'Peer-to-peer', 'share-network'],
      ['Qm-server', 'Server (links.example.org:8443)', 'hard-drives'],
    ]);
  });

  it('describes each choice, naming the server in its own description', () => {
    const [p2p, server] = linkLanguageOptions([P2P, SERVER]);

    expect(p2p.description).toMatch(/directly with each other/);
    expect(server.description).toMatch(/links\.example\.org:8443/);
    expect(server.description).toMatch(/encrypted/);
  });

  it('adds the technical name only when two choices would read the same', () => {
    const other = { ...P2P, address: 'Qm-p2p-2', name: 'otherSync' };

    expect(linkLanguageOptions([P2P, other, SERVER]).map((o) => o.label)).toEqual([
      'Peer-to-peer · perspectiveDiffSync',
      'Peer-to-peer · otherSync',
      'Server (links.example.org:8443)',
    ]);
  });

  it('still labels a server template whose URL is missing or unparseable', () => {
    expect(linkLanguageOptions([{ ...SERVER, serverUrl: undefined }])[0].label).toBe('Server');
    expect(linkLanguageOptions([{ ...SERVER, serverUrl: 'not a url' }])[0].label).toBe('Server (not a url)');
  });
});
