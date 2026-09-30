/**
 * The editor's panels register, whichever end of the import cycle you come in from.
 *
 * `slotRegistry` imports `registerEditorDocks`, and `editorDocks` imports `slotRegistry` — a cycle,
 * which is survivable on its own. What was not survivable was `slotRegistry` *calling* into it at
 * module scope: entered from `editorDocks` first, that call fired while this file's `PANELS` list
 * was still uninitialised and threw `Cannot access 'PANELS' before initialization` from a file
 * neither module names. In the app it never happened, because `slotRegistry` was always reached
 * first; the first test to import `editorDocks` directly hit it immediately.
 *
 * So the *import* is the test, not the assertion under it — and what it needs is to be the first
 * thing in this file that enters the cycle. `dockRegistry` sorts above it and does not, which is the
 * only reason the order the linter imposes is survivable.
 *
 * That is the fragile part, and it is why this is its own file rather than a case in
 * `dockRegistry.test.ts`: an import added here that reaches `slotRegistry` first would enter from
 * the safe end and quietly make this vacuous. Verified the other way round — restoring the
 * module-scope call makes it fail — so if you change the imports, check it still can.
 */
import { describe, expect, it } from 'vitest';

import { dockRegistry } from '../src/shared/registries/dockRegistry';
import { registerEditorDocks } from '../src/shared/registries/editorDocks';

describe('registering the editor panels first', () => {
  it('does not depend on something else having been imported before it', () => {
    expect(() => registerEditorDocks()).not.toThrow();
    expect(dockRegistry.get('editor:code')).toBeDefined();
  });
});
