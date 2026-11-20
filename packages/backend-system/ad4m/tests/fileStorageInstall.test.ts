/**
 * A file write never waits on the deferred file-storage install.
 *
 * An unlocked start installs the file-storage language after the first screen. An upload made before
 * then wrote through `expression.create`, which does not install on demand and fails with `NotFound`
 * for a language that is not loaded. So every write installs first, and callers that install at the
 * same time share one `languages.byAddress`.
 */
import { FILE_STORAGE_LANGUAGE } from '@we/entities';
import { describe, expect, it, vi } from 'vitest';

import { createFileExpression, ensureFileStorageLanguage } from '../src/agentHelpers';

function fakeClient() {
  const order: string[] = [];
  let finishInstall!: () => void;
  const installed = new Promise<void>((resolve) => (finishInstall = resolve));
  const client = {
    languages: {
      byAddress: vi.fn(async () => {
        order.push('install');
        await installed;
        return null;
      }),
    },
    expression: {
      create: vi.fn(async () => {
        order.push('create');
        return 'file://expression';
      }),
    },
  };
  return { client, order, finishInstall };
}

describe('file storage install', () => {
  it('installs the language before it writes a file', async () => {
    const { client, order, finishInstall } = fakeClient();
    const written = createFileExpression(client, { base64: 'AA==', name: 'a.png', mimeType: 'image/png' });
    await Promise.resolve();
    expect(client.expression.create).not.toHaveBeenCalled();
    finishInstall();
    await expect(written).resolves.toBe('file://expression');
    expect(order).toEqual(['install', 'create']);
    expect(client.languages.byAddress).toHaveBeenCalledWith(FILE_STORAGE_LANGUAGE);
  });

  it('shares one install between callers in flight together, and asks again after it settles', async () => {
    const { client, finishInstall } = fakeClient();
    const first = ensureFileStorageLanguage(client);
    const second = ensureFileStorageLanguage(client);
    expect(client.languages.byAddress).toHaveBeenCalledTimes(1);
    finishInstall();
    await Promise.all([first, second]);
    await ensureFileStorageLanguage(client);
    expect(client.languages.byAddress).toHaveBeenCalledTimes(2);
  });
});
