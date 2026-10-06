/**
 * Which clock a globe follows, from its `clock` prop, kept attached to the globe's {@link ClockLink}.
 *
 * Shared by both engines' globes. A name follows the app's clock of that name — the one `clockStore`
 * plays and a scrubber drives — so a globe and the controls beside it agree by construction. Settings
 * without a name give the globe a clock of its own, for an animation nothing else needs to reach.
 *
 * The prop is compared by content. A template's expressions hand the globe a new object whenever
 * anything they read changes, and applying its settings each time would undo whatever a scrubber had
 * just set — a speed changed from the controls would jump back on the next unrelated re-render.
 */
import { type Clock, ClockRegistry, type ClockSettings } from '@we/clock';
import type { ClockLink } from '@we/globe-core';
import { createEffect, createMemo, onCleanup } from 'solid-js';

import type { GlobeClockOptions } from './CesiumGlobe.types';

/** Clocks for a globe placed somewhere with no host to lend the app's: a playground, a test. */
let fallback: ClockRegistry | undefined;

const SETTINGS = ['from', 'to', 'speed', 'duration', 'rate', 'loop'] as const;

function settingsOf(options: GlobeClockOptions): ClockSettings {
  const settings: Record<string, unknown> = {};
  for (const key of SETTINGS) if (options[key] !== undefined) settings[key] = options[key];
  return settings as ClockSettings;
}

export function followClock(
  props: { clock?: string | GlobeClockOptions; clocks?: ClockRegistry },
  link: ClockLink,
  ready: () => boolean,
): void {
  let own: Clock | undefined;
  const autoplayed = new WeakSet<Clock>();
  const options = createMemo<GlobeClockOptions | undefined>(
    () => (typeof props.clock === 'string' ? { id: props.clock } : props.clock),
    undefined,
    { equals: (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) },
  );

  createEffect(() => {
    const chosen = options();
    if (!ready()) return;
    if (!chosen) {
      link.attach(null);
      return;
    }
    const registry = props.clocks ?? (fallback ??= new ClockRegistry());
    const clock = chosen.id ? registry.get(String(chosen.id)) : (own ??= registry.unnamed());
    clock.configure(settingsOf(chosen));
    link.attach(clock);
    // Played once the layers have had a frame to say what span they cover: with no range there is
    // nothing to play through. Once per clock, so a re-render does not restart one somebody paused.
    if (chosen.autoplay && !autoplayed.has(clock)) {
      autoplayed.add(clock);
      requestAnimationFrame(() => requestAnimationFrame(() => clock.play()));
    }
  });
  onCleanup(() => {
    link.dispose();
    own?.dispose();
  });
}
