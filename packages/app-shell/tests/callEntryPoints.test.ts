/**
 * What every way into a call does when you are already in one.
 *
 * There are three of them — the module rail's launcher, the Cards header's Call button, and the
 * Continue button on each call card — and until this file existed all three assumed there was no
 * call running. Each one was wrong in its own way, and none of the three failures was visible from
 * the declaration:
 *
 * - `joinSpaceCall` returns early on the call you are already in, so the control was silently dead.
 * - On any *other* call — one anchored to a post, or one in a space you had navigated away from —
 *   the ids differ, so it tore that call down to start a new one. No confirmation.
 * - `resume` does not fail quietly at all. It re-points the live transcript at the record it was
 *   given and announces the claim, and peers adopt an announced record in preference to their own.
 *   A stray click on an old card moved everybody's live transcript into an old meeting.
 *
 * All three now make the same promise once a call is running: go to the call. These assert it on
 * the *serialised* schema, because that is the only thing that would notice someone reasonably
 * "simplifying" a branch back into the unconditional pair it replaced — a typecheck cannot, and the
 * schema validator checks shape rather than meaning.
 */
import { callModule } from '@we/module-call';
import { transcribeModule } from '@we/module-transcribe';
import { cardsView } from '@we/template-views';
import { describe, expect, it } from 'vitest';

import { moduleRegistry, moduleStores } from '../src/shared/registries/moduleRegistry';

/*
  Asserted on the composed view rather than on the two fragments, which the package does not export
  — and which is the better subject anyway: this is the tree that actually ships, so a fragment
  fixed but left unwired would still fail here. The same reason `role-audit` walks the composed tree
  instead of grepping source.
*/
const view = JSON.stringify(cardsView);

/** The reactivity a host lends a module, reduced to the smallest thing that satisfies it. */
const storeDeps = {
  signal: <T>(initial: T): [() => T, (next: T) => void] => {
    let value = initial;
    return [() => value, (next: T) => (value = next)];
  },
  effect: (fn: () => void) => fn(),
};

/** Every action token a fragment fires, in order, so a pair can be asserted as a pair. */
function actionsIn(node: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.$action === 'string') found.push(record.$action);
    Object.values(record).forEach(walk);
  };
  walk(node);
  return found;
}

describe('the rail launcher', () => {
  it('goes to the call rather than joining one', () => {
    // The declaration is the whole of the coupling — the host calls whatever method this names.
    expect(callModule.launcher!.action).toBe('goToCall');
  });
});

describe('the Cards header Call button', () => {
  it('does not create a call record while a call is running', () => {
    /*
      The specific bug: the create fired on the click and the join afterwards, so pressing this
      mid-call wrote an empty CollectionBlock and then no-opped the join it was created for —
      leaving an orphaned card on the very list below it.

      Asserted as "the create is behind a condition" rather than by naming the condition's shape,
      so a differently-spelled guard still passes and no guard at all does not.
    */
    expect(view).toContain('model.create');
    expect(view).not.toContain('"onClick":{"$action":"model.create"');
  });

  it('offers the way back to a running call, and says so', () => {
    expect(actionsIn(cardsView)).toContain('modules.call.goToCall');
    // The label is the button's whole name here — it has no icon to fall back on.
    expect(view).toContain('Go to call');
  });

  it('branches at click time rather than at render time', () => {
    // A `$if` in an action's *args* resolves when the header paints and freezes whichever answer
    // was true then. Handler arrays resolve lazily, which is why the branch is two entries in one
    // array rather than one conditional action.
    expect(view).toContain('"onClick":[');
  });
});

describe('the Continue button on a call card', () => {
  it('never reassigns a live transcript', () => {
    /*
      The worst of the three, and the reason this file leads with `resume`. It is not a no-op
      mid-call — it moves the record the words are going into, for everyone, because announcing a
      claim is how peers converge. So `resume` must never be reachable from a click that happens
      while a call is running.
    */
    expect(view).toContain('modules.transcribe.resume');
    // Both of the old unconditional pair, adjacent, is exactly the shape that had the bug.
    expect(view).not.toContain(
      '"onClick":[{"$action":"modules.call.joinSpaceCall"},{"$action":"modules.transcribe.resume"',
    );
  });

  it('still continues a finished call', () => {
    // The other half: none of this should have made the feature the button exists for harder.
    const actions = actionsIn(cardsView);
    expect(actions).toContain('modules.call.joinSpaceCall');
    expect(actions).toContain('modules.transcribe.resume');
  });

  it('goes to the call instead, while one is running', () => {
    expect(actionsIn(cardsView)).toContain('modules.call.goToCall');
    expect(view).toContain('Go to the call');
    // And keeps naming the other case, so the tooltip is not one label doing two jobs.
    expect(view).toContain('Continue this call');
  });

  it('marks the card that is the running call', () => {
    /*
      Without it every card looks finished, and the one whose button behaves differently is
      indistinguishable from the rest — which reads as the button behaving at random.

      Compared against the transcript's live *record*, not against `modules.call.active`: a
      space-wide call publishes one id derived from the space, so "am I in a call" cannot tell this
      morning's meeting from this afternoon's, and every card would light up at once.
    */
    expect(view).toContain('modules.transcribe.liveCollectionId');
    expect(view).not.toContain('"condition":{"$store":"modules.call.active"},"then":{"type":"we-badge"');
  });

  it('reads a store key the transcribe module actually publishes', () => {
    /*
      A `$store` path is a string resolved at render time, and a reference to a key nothing provides
      resolves to nothing rather than raising — so a rename would leave the badge permanently absent
      and the card permanently indistinguishable, with no error anywhere. The same failure mode the
      launcher-key tests in `callModule.test.ts` exist for.
    */
    moduleRegistry.register(transcribeModule, { backend: 'ad4m', framework: 'solid' }, storeDeps);
    const store = moduleStores.transcribe as Record<string, unknown>;

    expect(typeof store.liveCollectionId).toBe('function');
    // Empty rather than null with no call, so `$eq` against a record id can never accidentally match
    // an absent one — two falsy values would otherwise read as equal enough.
    expect((store.liveCollectionId as () => unknown)()).toBe('');
  });
});
