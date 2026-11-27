/**
 * The panels opened more than once — each an *instance* of a panel an interface declared, with the
 * inputs it was opened with: an inspector per record, a transcript per call.
 *
 * A declaration says what a panel is and where it starts; an instance is one of it on screen. Each
 * instance is a dock of its own (`template:<panel>~<key>`) with the declaration's placement, frame
 * and lane, so it opens where the declared panel would — beside it as a tab, where the declaration
 * names an `order` — and moves, folds and closes on its own. Its node reads which instance it is and
 * its inputs as `panel` (`{ $: 'panel.inputs.recordId' }`).
 *
 * Held by the shell store, which keeps them per interface across reloads; published here so the body
 * that renders an instance (`TemplatePanelBody`) can read its inputs without reaching for the store.
 */
import type { ReactivityPort } from '@we/reactivity';

export interface PanelInstance {
  /** Its dock id — `template:<panel>~<key>`. */
  id: string;
  /** The declared panel it is an instance of. */
  panel: string;
  /** What it was opened with, as its node reads them (`panel.inputs`). Plain data, kept across reloads. */
  inputs: Record<string, unknown>;
  /** What its tab and its header call it, where the declaration's title would not tell two apart. */
  title?: string;
  /** When it was first opened, in milliseconds — the order its tab takes after the declared panel's. */
  opened: number;
}

export type PanelInstances = ReturnType<typeof createPanelInstances>;

/** One app's panel instances. The app keeps one (`frameworks/solid/stores/hostState.ts`). */
export function createPanelInstances({ signal, untrack }: Pick<ReactivityPort, 'signal' | 'untrack'>) {
  const [instances, setInstances] = signal<Record<string, PanelInstance>>({});
  return {
    /** Every instance open in the interface on screen, by dock id. */
    panelInstances: instances,
    /**
     * Replace the instances on screen — the shell store's to call.
     *
     * Nothing is published when the records themselves are unchanged: `openPanel` rewriting one
     * instance's inputs also republishes the whole map a beat later (the store's memo reacts to its
     * own write), and a second signal would make `TemplatePanelBody` render the instance's node again
     * — remounting the chat that just consumed the draft, orphaning the ask it was mid-flight on.
     * Records are only ever replaced whole (`writeInstances` builds them fresh), never edited in
     * place, so identity says whether anything a reader sees changed.
     */
    publishPanelInstances: (next: Record<string, PanelInstance>): void => {
      const prev = untrack(instances);
      const ids = Object.keys(next);
      if (ids.length === Object.keys(prev).length && ids.every((id) => prev[id] === next[id])) return;
      setInstances(next);
    },
  };
}

/** The dock an instance of `panel` opened under `key` is. */
export const instanceDockId = (panel: string, key: string): string => `template:${panel}~${key}`;

/** The declared panel a dock is, or is an instance of: `inspector` for `template:inspector~a1`. */
export const declaredPanelOf = (dockId: string): string => dockId.replace(/^template:/, '').replace(/~.*$/, '');

/**
 * A key for inputs that names the same inputs the same way, whatever order their fields were written
 * in — so opening the same record twice brings its instance forward rather than making a second.
 */
export function instanceKeyOf(inputs: Record<string, unknown>): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value as Record<string, unknown>)
              .sort()
              .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
          )
        : value;
  const text = JSON.stringify(canonical(inputs));
  // FNV-1a, as hex: short, stable, and only ever compared with itself.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
