/**
 * A space can hide a module's panel. It cannot hide the host's own.
 *
 * The regression these exist for: `ShellStore.dockRequests` gated *every* dock on
 * `moduleGate` — "is this module active in this space?" — and `DockEntry.moduleId` is a store id,
 * not necessarily a module id. Host chrome registers docks under `hostDockStores` keys (`shell` for
 * the space-settings panel, `editor` for the AI, code, theme and inspector panels), the gate had no
 * true answer for those and returned false, and all five panels lost their edge and their geometry.
 * The buttons that open them did nothing, silently, with no error anywhere.
 *
 * Written against the predicate rather than the memo on purpose: the first attempt at this fix was
 * covered by a test that pinned only the *premise* — that `shell` and `editor` are not module ids —
 * and the suite stayed green with the bug put back.
 */
import { describe, expect, it } from 'vitest';

import { dockIsOffered } from '../src/shared/dockGating';

/** The module registry as this decision sees it: two modules, and nothing else. */
const isModule = (id: string) => id === 'notes' || id === 'call';

describe('dockIsOffered', () => {
  it('hides a module panel the space has turned off', () => {
    // The behaviour the gate was added for: a notes panel must not go on reserving 400px of content
    // width in a space that has not enabled notes.
    expect(dockIsOffered('notes', isModule, () => false)).toBe(false);
  });

  it('shows a module panel the space has turned on', () => {
    expect(dockIsOffered('notes', isModule, () => true)).toBe(true);
  });

  it('shows host chrome whatever the gate says', () => {
    /*
      The regression. `shell` and `editor` are not modules, so a gate built from `activeModules`
      answers no for both — and answering no is not a decision about them at all.

      Asserted with a gate that refuses *everything*, because that is exactly what the real one did:
      `activeModules` never contains `shell`, so the predicate was constant-false for host chrome in
      every space, not just in spaces with modules disabled.
    */
    const refuseEverything = () => false;

    expect(dockIsOffered('shell', isModule, refuseEverything)).toBe(true);
    expect(dockIsOffered('editor', isModule, refuseEverything)).toBe(true);
  });

  it('never asks the gate about something that is not a module', () => {
    // Stronger than the result: the gate should not be *consulted*. A gate that logged, threw on an
    // unknown id, or counted calls would otherwise be reached with a question it cannot answer.
    const asked: string[] = [];
    const recordingGate = (id: string) => {
      asked.push(id);
      return true;
    };

    dockIsOffered('shell', isModule, recordingGate);
    dockIsOffered('editor', isModule, recordingGate);
    expect(asked).toEqual([]);

    dockIsOffered('notes', isModule, recordingGate);
    expect(asked).toEqual(['notes']);
  });

  it('treats an unregistered id as host chrome rather than as a disabled module', () => {
    /*
      The direction to fail in. A dock exists only because something registered it, so an id the
      module registry does not know is host chrome — a new host surface, or one whose registration
      runs after this. Showing it is recoverable and visible; hiding it is the bug above, which is
      invisible.
    */
    expect(dockIsOffered('template-panels', isModule, () => false)).toBe(true);
  });
});
