/**
 * The Electron identity window's page imports the shared window and nothing else: no template, store
 * or module code reaches the window that shows the recovery words.
 */
import { describe, expect, it } from 'vitest';

import source from './main.ts?raw';

describe('the Electron identity window', () => {
  it('imports only the shared window', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['@we/identity-window']);
  });
});
