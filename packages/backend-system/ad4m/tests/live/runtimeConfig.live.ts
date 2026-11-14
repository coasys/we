/**
 * `EXECUTOR_CONFIG_KINDS`, checked against a real executor.
 *
 * `runtime.config` lists every key `runtime.setConfig` knows, with no type, and the settings page
 * offers a control for a key only when it knows the key's type. A key the executor gains and the
 * map lacks would be shown read-only with nothing failing, so this asks the executor which keys it
 * lists and fails on any the map does not cover.
 *
 * Run with `pnpm verify:ad4m`.
 */
import { Ad4mClient } from '@coasys/ad4m';
import { describe, expect, inject, it } from 'vitest';

import { EXECUTOR_CONFIG_KINDS } from '../../src/runtimeAdminAdapter';

describe('runtime.config', () => {
  it('lists no key whose type the settings page does not know', async () => {
    const { url, token } = inject('ad4mExecutor');
    const client = new Ad4mClient(url, token);
    const config = await client.runtime.config();
    const keys = config.keys.map((info) => info.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !(key in EXECUTOR_CONFIG_KINDS))).toEqual([]);
  });
});
