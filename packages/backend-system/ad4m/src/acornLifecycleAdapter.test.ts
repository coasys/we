/**
 * The `acornLifecycle` port — delegation tested where it lives.
 *
 * On the a9 pin (`667d43e`) the mount/template calls rode a second, hand-rolled
 * WebSocket because that SDK carried neither the client methods nor their
 * `RpcMethods` entries. The pin now carries `perspective.mount`/`mounts`/
 * `unmount` and `language.applyTemplateLocal` natively, so the port is what it
 * was always meant to collapse into: thin delegates on the session's own
 * `Ad4mClient`, with no second transport to bound, authenticate or dispose of.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAd4mAcornLifecycle } from './acornLifecycleAdapter';

function fakeClient() {
  return {
    perspective: {
      mount: vi.fn(async () => true),
      mounts: vi.fn(async () => ['lang-a']),
      unmount: vi.fn(async () => true),
    },
    languages: {
      applyTemplateLocal: vi.fn(async () => ({ address: 'lang-templated' })),
    },
    expression: {
      interact: vi.fn(async (_url: string, _call: { name: string; parameters?: unknown }) => '{"who":"me"}'),
    },
  };
}

describe('the acorn lifecycle port on the session client', () => {
  it('mounts through client.perspective.mount', async () => {
    const client = fakeClient();
    const port = createAd4mAcornLifecycle(client);
    await expect(port.mount('dataset-1', 'lang-a')).resolves.toBe(true);
    expect(client.perspective.mount).toHaveBeenCalledWith('dataset-1', 'lang-a');
  });

  it('lists through client.perspective.mounts', async () => {
    const client = fakeClient();
    const port = createAd4mAcornLifecycle(client);
    await expect(port.mounts('dataset-1')).resolves.toEqual(['lang-a']);
    expect(client.perspective.mounts).toHaveBeenCalledWith('dataset-1');
  });

  it('unmounts through client.perspective.unmount', async () => {
    const client = fakeClient();
    const port = createAd4mAcornLifecycle(client);
    await expect(port.unmount('dataset-1', 'lang-a')).resolves.toBe(true);
    expect(client.perspective.unmount).toHaveBeenCalledWith('dataset-1', 'lang-a');
  });

  it('templates through client.languages.applyTemplateLocal, object not string', async () => {
    const client = fakeClient();
    const port = createAd4mAcornLifecycle(client);
    const result = await port.applyTemplateLocal('Qm-base', { seed: 'uid-x' });
    expect(result).toEqual({ address: 'lang-templated' });
    // The client method does the JSON.stringify itself — the port hands the record over.
    expect(client.languages.applyTemplateLocal).toHaveBeenCalledWith('Qm-base', { seed: 'uid-x' });
  });

  it('interacts through client.expression.interact and parses a JSON string', async () => {
    const client = fakeClient();
    const port = createAd4mAcornLifecycle(client);
    const result = await port.interact('lang://project', { name: 'whoami', parameters: { a: 1 } });
    expect(result).toEqual({ who: 'me' });
    expect(client.expression.interact).toHaveBeenCalledOnce();
    const [url, call] = client.expression.interact.mock.calls[0];
    expect(url).toBe('lang://project');
    expect(call).toMatchObject({ name: 'whoami', parameters: { a: 1 } });
  });

  it('returns a non-JSON interact result as-is', async () => {
    const client = fakeClient();
    client.expression.interact.mockResolvedValue('plain text');
    const port = createAd4mAcornLifecycle(client);
    await expect(port.interact('lang://x', { name: 'info' })).resolves.toBe('plain text');
  });

  it('opens no transport of its own — dispose is not part of the surface', () => {
    const port = createAd4mAcornLifecycle(fakeClient());
    expect((port as { dispose?: unknown }).dispose).toBeUndefined();
  });
});
