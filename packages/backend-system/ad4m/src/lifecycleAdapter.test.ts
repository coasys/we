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

    expect(await lifecycle.linkLanguageTemplates?.()).toEqual([{ address: HOLOCHAIN.address, name: HOLOCHAIN.name }]);
  });

  it('offers it once a link server is configured, after the peer-to-peer templates', async () => {
    // AD4M sorts known templates by address, so a server template can come first. It must not
    // become the default for that.
    const client = mockClient([SERVER, HOLOCHAIN]);
    const lifecycle = createAd4mDatasetLifecycle(client as unknown as Ad4mClient, {
      linkServerUrl: 'https://links.example.org',
    });

    expect((await lifecycle.linkLanguageTemplates?.())?.map((t) => t.address)).toEqual([
      HOLOCHAIN.address,
      SERVER.address,
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
