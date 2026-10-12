import type { Ad4mClient } from '@coasys/ad4m';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mDatasetLifecycle } from './lifecycleAdapter';

// ── Helpers ──────────────────────────────────────────────────────────────────

const HOLOCHAIN = { address: 'Qm-holochain', name: 'perspectiveDiffSync', params: ['uid', 'name', 'description'] };
const SERVER = { address: 'Qm-server', name: 'server-link-language', params: ['SERVER_URL', 'ROOM_ID', 'name'] };
const UNDECLARED = { address: 'Qm-undeclared', name: 'legacy', params: null };

type Template = { address: string; name: string; params: string[] | null };

function mockClient(templates: Template[]) {
  const known = templates.map((t) => t.address);
  const client = {
    runtime: {
      knownLinkLanguageTemplates: vi.fn(async () => [...known]),
      addKnownLinkLanguageTemplates: vi.fn(async (addresses: string[]) => {
        known.push(...addresses);
        return known;
      }),
    },
    languages: {
      meta: vi.fn(async (address: string) => {
        const t = templates.find((x) => x.address === address);
        if (!t) throw new Error('unknown language');
        return { name: t.name, possibleTemplateParams: t.params ?? undefined };
      }),
      publish: vi.fn(async (_path: string, meta: { possibleTemplateParams: string[] }) => {
        templates.push({ ...SERVER, address: 'Qm-dev-server' });
        return { address: 'Qm-dev-server', possibleTemplateParams: meta.possibleTemplateParams };
      }),
      applyTemplateAndPublish: vi.fn(async (_address: string, _templateData: string) => ({ address: 'Qm-applied' })),
    },
    perspective: { byUUID: vi.fn(async () => ({ name: 'Garden' })) },
    neighbourhood: { publishFromPerspective: vi.fn(async () => 'neighbourhood://Qm-hood') },
  };
  return client;
}

const templateData = (client: ReturnType<typeof mockClient>) =>
  JSON.parse(client.languages.applyTemplateAndPublish.mock.calls[0][1]);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('linkLanguageTemplates', () => {
  it('hides a template needing a server when no link server is configured', async () => {
    const client = mockClient([HOLOCHAIN, SERVER]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    expect(await lifecycle.linkLanguageTemplates?.()).toEqual([
      { address: HOLOCHAIN.address, name: HOLOCHAIN.name, kind: 'peer-to-peer' },
    ]);
  });

  it('offers it once a link server is configured, after the peer-to-peer templates', async () => {
    // AD4M sorts known templates by address, so a server template can come first. It must not
    // become the default for that.
    const client = mockClient([SERVER, HOLOCHAIN]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, {
      linkServerUrl: 'https://links.example.org',
    });

    expect(await lifecycle.linkLanguageTemplates?.()).toEqual([
      { address: HOLOCHAIN.address, name: HOLOCHAIN.name, kind: 'peer-to-peer' },
      { address: SERVER.address, name: SERVER.name, kind: 'server', serverUrl: 'https://links.example.org' },
    ]);
  });

  it('keeps a template that declares no parameters', async () => {
    const client = mockClient([UNDECLARED]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    expect(await lifecycle.linkLanguageTemplates?.()).toHaveLength(1);
  });
});

describe('publish', () => {
  it('gives a Holochain template only the parameters it declares', async () => {
    const client = mockClient([HOLOCHAIN, SERVER]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, {
      linkServerUrl: 'https://links.example.org',
    });

    await lifecycle.publish?.('dataset-1', HOLOCHAIN.address);

    const data = templateData(client);
    expect(Object.keys(data).sort()).toEqual(['name', 'uid']);
    expect(data.name).toBe('Garden-link-language');
  });

  it('gives a server template the configured URL and a fresh room', async () => {
    const client = mockClient([HOLOCHAIN, SERVER]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, {
      linkServerUrl: 'https://links.example.org',
    });

    await lifecycle.publish?.('dataset-1', SERVER.address);
    await lifecycle.publish?.('dataset-2', SERVER.address);

    const [first, second] = client.languages.applyTemplateAndPublish.mock.calls.map(
      (call) => JSON.parse(call[1]) as Record<string, string>,
    );
    expect(Object.keys(first).sort()).toEqual(['ROOM_ID', 'SERVER_URL', 'name']);
    expect(first.SERVER_URL).toBe('https://links.example.org');
    expect(first.ROOM_ID).not.toBe(second.ROOM_ID);
  });

  it('refuses a server template when no link server is configured', async () => {
    const client = mockClient([HOLOCHAIN, SERVER]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    await expect(lifecycle.publish?.('dataset-1', SERVER.address)).rejects.toThrow(/SERVER_URL, ROOM_ID/);
    expect(client.languages.applyTemplateAndPublish).not.toHaveBeenCalled();
  });

  it('uses the first publishable template when none is chosen', async () => {
    const client = mockClient([SERVER, HOLOCHAIN]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    await lifecycle.publish?.('dataset-1', '');

    expect(client.languages.applyTemplateAndPublish.mock.calls[0][0]).toBe(HOLOCHAIN.address);
  });

  it('gives a template declaring no parameters the uid and name it always had', async () => {
    const client = mockClient([UNDECLARED]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, {
      linkServerUrl: 'https://links.example.org',
    });

    await lifecycle.publish?.('dataset-1');

    expect(Object.keys(templateData(client)).sort()).toEqual(['name', 'uid']);
  });
});

describe('development registration', () => {
  const devOptions = (bundle: string | null) => ({
    linkServerUrl: 'https://links.example.org',
    devLinkLanguageBundle: async () => bundle,
  });

  it('publishes the local build and adds it to the known templates, once', async () => {
    const client = mockClient([HOLOCHAIN]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, devOptions('/ad4m/bundle.js'));

    const templates = await lifecycle.linkLanguageTemplates?.();
    await lifecycle.linkLanguageTemplates?.();

    expect(client.languages.publish).toHaveBeenCalledTimes(1);
    expect(client.languages.publish.mock.calls[0]).toEqual([
      '/ad4m/bundle.js',
      expect.objectContaining({ possibleTemplateParams: expect.arrayContaining(['SERVER_URL', 'ROOM_ID']) }),
    ]);
    expect(client.runtime.addKnownLinkLanguageTemplates).toHaveBeenCalledWith(['Qm-dev-server']);
    expect(templates?.map((t) => t.address)).toEqual([HOLOCHAIN.address, 'Qm-dev-server']);
  });

  it('does not register a build the language store holds under other parameters', async () => {
    // A repeat publish of identical bytes returns the meta stored first, whatever was sent.
    const client = mockClient([HOLOCHAIN]);
    client.languages.publish.mockResolvedValueOnce({
      address: 'Qm-stale',
      possibleTemplateParams: ['uid', 'name', 'linkServerUrl'],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, devOptions('/ad4m/bundle.js'));

    await lifecycle.linkLanguageTemplates?.();

    expect(client.runtime.addKnownLinkLanguageTemplates).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('linkServerUrl'));
    warn.mockRestore();
  });

  it('does nothing when the node already knows a server template', async () => {
    const client = mockClient([HOLOCHAIN, SERVER]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, devOptions('/ad4m/bundle.js'));

    await lifecycle.linkLanguageTemplates?.();

    expect(client.languages.publish).not.toHaveBeenCalled();
  });

  it('does nothing without a bundle or without a link server', async () => {
    const noBundle = mockClient([HOLOCHAIN]);
    await createAd4mDatasetLifecycle(noBundle as unknown as Ad4mClient, devOptions(null)).linkLanguageTemplates?.();

    const noServer = mockClient([HOLOCHAIN]);
    await createAd4mDatasetLifecycle(noServer as unknown as Ad4mClient, {
      devLinkLanguageBundle: async () => '/ad4m/bundle.js',
    }).linkLanguageTemplates?.();

    expect(noBundle.languages.publish).not.toHaveBeenCalled();
    expect(noServer.languages.publish).not.toHaveBeenCalled();
  });

  it('still lists templates when registration fails, and tries again next time', async () => {
    const client = mockClient([HOLOCHAIN]);
    client.languages.publish.mockRejectedValueOnce(new Error('agent locked'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, devOptions('/ad4m/bundle.js'));

    expect(await lifecycle.linkLanguageTemplates?.()).toHaveLength(1);
    await lifecycle.linkLanguageTemplates?.();

    expect(client.languages.publish).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('one handle per dataset', () => {
  /**
   * Every proxy the SDK builds registers four socket subscriptions it can never release on its own,
   * so a handle built and dropped keeps running for the life of the session. The trace this was
   * found in held 27 proxies for 8 datasets after one load, each filtering every socket message.
   */
  function perspectiveClient() {
    const constructed: { uuid: string; name: string; sharedUrl?: string | null }[] = [];
    const listeners: Record<string, (handle: unknown) => unknown> = {};
    const build = (uuid: string, name = uuid, sharedUrl: string | null = null) => {
      const p = { uuid, name, sharedUrl, state: 'Private', neighbourhood: null };
      constructed.push(p);
      return p;
    };
    // The executor's payloads: added/updated carry the handle, removed carries the uuid.
    const client = {
      on: vi.fn((type: string, cb: (event: never) => void) => {
        const name = type.replace('perspective-', '');
        listeners[name] = (arg: unknown) =>
          (cb as (event: unknown) => void)(
            name === 'removed'
              ? { perspectiveUuid: arg, uuid: arg, owner: 'did:me' }
              : { perspective: arg, perspectiveUuid: (arg as { uuid: string }).uuid, owner: 'did:me' },
          );
        return () => delete listeners[name];
      }),
      agent: { me: vi.fn(async () => ({ did: 'did:me', perspective: null })) },
      perspective: {
        all: vi.fn(async () => [build('a', 'Alpha'), build('b', 'Beta')]),
        byUUID: vi.fn(async (uuid: string) => build(uuid)),
        add: vi.fn(async (name: string) => build(`new-${name}`, name)),
        remove: vi.fn(async () => undefined),
        onReconnect: vi.fn((cb) => (listeners.reconnected = cb)),
      },
    };
    return { client, constructed, listeners };
  }

  it('hands out the same handle for a dataset however it is read', async () => {
    const { client } = perspectiveClient();
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    const [first] = await lifecycle.list();
    const [again] = await lifecycle.list();
    const got = await lifecycle.get('a');

    expect(again.handle).toBe(first.handle);
    expect(got?.handle).toBe(first.handle);
    // Answered from what is held: a switch into a listed dataset costs no round trip.
    expect(client.perspective.byUUID).not.toHaveBeenCalled();
  });

  it('refreshes what the held handle says from later reads and events, without reading again', async () => {
    const { client, listeners } = perspectiveClient();
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);
    const updated: unknown[] = [];
    lifecycle.subscribe({ onUpdated: (ref) => updated.push(ref) });
    const [held] = await lifecycle.list();

    listeners.updated({ uuid: 'a', name: 'Alpha, renamed', sharedUrl: 'neighbourhood://Qm-a', state: 'Synced' });

    expect(updated).toEqual([expect.objectContaining({ id: 'a', name: 'Alpha, renamed', handle: held.handle })]);
    expect((await lifecycle.get('a'))?.sharedUri).toBe('neighbourhood://Qm-a');
    expect(client.perspective.byUUID).not.toHaveBeenCalled();
  });

  it('answers the list from what it holds once it is listening and has read everything once', async () => {
    const { client, listeners } = perspectiveClient();
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    await lifecycle.list(); // before listening: cannot be trusted complete
    lifecycle.subscribe({});
    await lifecycle.list(); // the one full read made while listening
    listeners.removed('b');
    listeners.updated({ uuid: 'a', name: 'Alpha, renamed' });
    const names = (await lifecycle.list()).map((d) => d.name);

    expect(client.perspective.all).toHaveBeenCalledTimes(2);
    expect(names).toEqual(['Alpha, renamed']);
  });

  it('reads the list without waiting for the own-profile lookup first', async () => {
    // The lookup only feeds the filter; on a boot it was a round trip of its own ahead of the read.
    const { client } = perspectiveClient();
    let releaseMe!: () => void;
    client.agent.me = vi.fn(
      () =>
        new Promise<{ did: string; perspective: null }>(
          (resolve) => (releaseMe = () => resolve({ did: 'did:me', perspective: null })),
        ),
    );
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);

    const listed = lifecycle.list();
    await vi.waitFor(() => expect(client.perspective.all).toHaveBeenCalled());
    releaseMe();

    expect((await listed).map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('reads a dataset it does not hold, once, and lets a removed one go', async () => {
    const { client, listeners } = perspectiveClient();
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);
    lifecycle.subscribe({});

    const first = await lifecycle.get('c');
    expect((await lifecycle.get('c'))?.handle).toBe(first?.handle);
    expect(client.perspective.byUUID).toHaveBeenCalledTimes(1);

    listeners.removed('c');
    await lifecycle.get('c');
    expect(client.perspective.byUUID).toHaveBeenCalledTimes(2);
  });

  /*
    Once complete, the registry is kept true by events alone — and the events that matter most are
    the ones most likely to be missed: a join the transport gave up on is announced over the same
    socket that just failed. So a caller can ask again, and a reconnect stops the registry vouching
    for itself.
  */
  it('reads again when asked for a fresh list, finding what no event announced', async () => {
    const { client } = perspectiveClient();
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);
    lifecycle.subscribe({});
    await lifecycle.list();

    client.perspective.all.mockResolvedValueOnce([
      { uuid: 'a', name: 'Alpha' },
      { uuid: 'j', name: 'Joined, unannounced' },
    ] as never);
    const cached = (await lifecycle.list()).map((d) => d.id);
    const fresh = (await lifecycle.list({ fresh: true })).map((d) => d.id);

    expect(cached).toEqual(['a', 'b']);
    // `b` went without an event, and `j` arrived without one: the fresh read corrects both.
    expect(fresh).toEqual(['a', 'j']);
  });

  it('keeps a perspective removed during the read out of the registry', async () => {
    const { client, listeners } = perspectiveClient();
    let answer!: (rows: unknown[]) => void;
    client.perspective.all.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve as never)));
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);
    lifecycle.subscribe({});

    const listed = lifecycle.list();
    await vi.waitFor(() => expect(client.perspective.all).toHaveBeenCalled());
    listeners.removed('b');
    answer([
      { uuid: 'a', name: 'Alpha' },
      { uuid: 'b', name: 'Beta, already gone' },
    ]);

    expect((await listed).map((d) => d.id)).toEqual(['a']);
    expect((await lifecycle.list()).map((d) => d.id)).toEqual(['a']);
  });

  it('stops answering from the registry after the socket reconnects', async () => {
    const { client, listeners } = perspectiveClient();
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient);
    lifecycle.subscribe({});
    await lifecycle.list();
    await lifecycle.list();
    expect(client.perspective.all).toHaveBeenCalledTimes(1);

    listeners.reconnected(undefined);
    await lifecycle.list();

    expect(client.perspective.all).toHaveBeenCalledTimes(2);
  });
});
