/**
 * Where the app's toast box sits.
 *
 * Mounting the whole `App` — StoreProvider, TemplateProvider and everything they
 * need — to assert one prop on one element is an entire shell for one word, so
 * this guards the mount the cheap way: the JSX has to say `bottom-right`,
 * because that is the only thing standing between an error toast and the view
 * tabs it used to cover.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('the app-level toast container', () => {
  it('is mounted bottom-right — off the view tabs errors used to cover', () => {
    const appPath = fileURLToPath(new URL('../src/frameworks/solid/App.tsx', import.meta.url));
    const source = readFileSync(appPath, 'utf8');
    expect(source).toMatch(/<ToastContainer[^>]*position="bottom-right"/);
  });
});
