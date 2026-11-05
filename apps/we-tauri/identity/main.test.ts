/**
 * The Tauri identity window's page imports the shared window and the Tauri bridge, and nothing else
 * of WE: no template, store or module code reaches the window that shows the recovery words.
 */
import { describe, expect, it } from 'vitest';

import source from './main.ts?raw';

describe('the Tauri identity window', () => {
  it('imports only the shared window and the Tauri bridge', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['@tauri-apps/api/core', '@we/identity-window']);
  });
});
