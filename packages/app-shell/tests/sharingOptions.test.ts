/**
 * The create-space picker for how a shared space syncs. What matters is that a person can tell the
 * choices apart by what they mean, that the default stays first, and that a server they would not
 * recognise by URL is named by its host in the second picker, the one for which server.
 */
import { describe, expect, it } from 'vitest';

import { CUSTOM_SERVER, sharingPickerOptions } from '../src/shared/sharingOptions';

const P2P = { id: 'Qm-p2p', name: 'perspectiveDiffSync', kind: 'peer-to-peer' as const };
const SERVER = {
  id: 'Qm-server',
  name: 'server-link-language',
  kind: 'server' as const,
  servers: ['https://links.example.org:8443/sync', 'https://link-staging.ad4m.dev'],
};

describe('sharingPickerOptions', () => {
  it('labels by how a space syncs, keeping the backend’s order', () => {
    const options = sharingPickerOptions([P2P, SERVER]);

    expect(options.map((o) => [o.value, o.label, o.icon])).toEqual([
      ['Qm-p2p', 'Peer-to-peer', 'share-network'],
      ['Qm-server', 'Server', 'hard-drives'],
    ]);
  });

  it('describes each choice', () => {
    const [p2p, server] = sharingPickerOptions([P2P, SERVER]);

    expect(p2p.description).toMatch(/directly with each other/);
    expect(server.description).toMatch(/through a server/);
    expect(server.description).toMatch(/encrypted/);
  });

  it('offers a server option’s servers by host, default first, then a custom one', () => {
    const [p2p, server] = sharingPickerOptions([P2P, SERVER]);

    expect(server.servers).toEqual([
      { label: 'links.example.org:8443', value: 'https://links.example.org:8443/sync' },
      { label: 'link-staging.ad4m.dev', value: 'https://link-staging.ad4m.dev' },
      { label: 'Custom…', value: CUSTOM_SERVER },
    ]);
    expect(p2p.servers).toEqual([]);
  });

  it('adds the technical name only when two choices would read the same', () => {
    const other = { ...P2P, address: 'Qm-p2p-2', name: 'otherSync' };

    expect(sharingPickerOptions([P2P, other, SERVER]).map((o) => o.label)).toEqual([
      'Peer-to-peer · perspectiveDiffSync',
      'Peer-to-peer · otherSync',
      'Server',
    ]);
  });

  it('still offers a custom server when the backend suggests none, and shows one it cannot parse as is', () => {
    expect(sharingPickerOptions([{ ...SERVER, servers: undefined }])[0].servers).toEqual([
      { label: 'Custom…', value: CUSTOM_SERVER },
    ]);
    expect(sharingPickerOptions([{ ...SERVER, servers: ['not a url'] }])[0].servers[0].label).toBe('not a url');
  });
});
