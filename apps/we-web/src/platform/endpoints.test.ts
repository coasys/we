import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_ENDPOINTS, parseEndpoints } from './endpoints';

const config = (env: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'config', `${env}.json`), 'utf8'));

describe('the build endpoints', () => {
  it('has a valid file for each environment, and staging shares nothing with production', () => {
    const production = parseEndpoints(config('production'));
    const staging = parseEndpoints(config('staging'));
    for (const key of Object.keys(production) as Array<keyof typeof production>) {
      expect(staging[key], key).not.toBe(production[key]);
    }
    expect(production.appOrigin).toBe('https://coasys.app');
    expect(staging.appOrigin).toBe('https://staging.coasys.app');
  });

  it('compiles in an environment of its own, staging when COASYS_ENV is unset', () => {
    expect(APP_ENDPOINTS).toEqual(config(process.env.COASYS_ENV ?? 'staging'));
  });

  it('refuses anything that is not a bare https origin, and names the field', () => {
    const good = config('production');
    for (const bad of ['http://coasys.id', 'https://coasys.id/path', 'coasys.id', 'https://coasys.id/', 7, undefined]) {
      expect(() => parseEndpoints({ ...good, identityOrigin: bad }), String(bad)).toThrow(/endpoints\.identityOrigin/);
    }
    expect(() => parseEndpoints(undefined)).toThrow(/endpoints\.appOrigin/);
  });
});
