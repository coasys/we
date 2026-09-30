/**
 * A colour probe: what the surface actually was, frame by frame.
 *
 * ## Why not transition events
 *
 * The first instrument listened to `transitionrun`/`start`/`end`/`cancel`, and it kept reporting
 * that everything was fine while the flicker was plainly visible. That is because a transition
 * event describes an *animation the browser agreed to run*. A flicker can be a single frame painted
 * the wrong colour with no animation involved at all — a style recalculation landing between two
 * frames, an element repainting at its base state for one tick, a rule losing the cascade briefly.
 * None of those emit anything to listen to. The instrument was structurally incapable of seeing the
 * bug it was pointed at, which is why four rounds of logs all came back clean.
 *
 * So this samples the *result*: `getComputedStyle` once per frame, inside rAF, which runs after
 * style and layout and before paint. Whatever number comes back is what is about to be on screen.
 *
 * ## What counts as a flicker, numerically
 *
 * Two detectors, and the second is the one that matters.
 *
 * **Reversal** — the colour moved toward the hover state, then moved back, with no pointer event in
 * between. Cheap and catches the obvious case.
 *
 * **Off-axis excursion** — the real prize. Every legitimate colour during a hover fade lies on the
 * straight line between the resting colour and the hovered colour: `sample = rest + t·(peak − rest)`.
 * That is what interpolation *is*. So once both endpoints are calibrated, any sample that does not
 * lie on that line is a colour the fade could never have produced, and its distance off the line is
 * a number rather than an impression. A `t` outside [0,1] is the same claim in the other direction:
 * a colour past either end of the fade.
 *
 * This is what makes the probe able to fail. If it reports nothing while a flicker is being watched,
 * the flicker is not a colour change on this surface, and the search moves elsewhere — which is a
 * genuine result, not a dead end.
 *
 * ## The "I saw it" key
 *
 * Every previous round produced a wall of events with an invitation to find the anomaly. This
 * inverts it: press space at the moment you see the flicker, and the probe dumps the preceding
 * window with your keypress marked. Human perception becomes the oracle and the data is aligned to
 * it, rather than the two being compared by guesswork afterwards.
 */

/** rgba, 0-255 per channel. */
export type Rgba = [number, number, number, number];

export interface Surface {
  /** Shown in reports. */
  label: string;
  /** What the user points at — where pointer events are observed. */
  host: HTMLElement;
  /** What actually paints — for a Lit primitive this is inside the shadow root. */
  painted: Element;
}

export interface Sample {
  t: number;
  bg: Rgba;
  fg: Rgba;
  /** Painted box, to a tenth of a pixel. See the geometry note in the tick loop. */
  box: [number, number, number, number];
  /** How far through its fade this surface was, once calibrated. Undefined before that. */
  progress?: number;
}

export interface ProbeEvent {
  t: number;
  kind: string;
  surface: string;
  detail?: string;
}

export interface Anomaly {
  t: number;
  surface: string;
  kind: 'reversal' | 'off-axis' | 'overshoot' | 'moved';
  detail: string;
}

/**
 * Enough frames to cover the longest capture window on a fast display.
 *
 * The window is chosen at the moment you press the key, so the buffer has to be sized for the largest
 * one on offer — 2s at 144Hz is ~290 frames, and the headroom costs a few hundred small objects per
 * surface.
 */
const RING_FRAMES = 480;

/** Below this, a channel difference is rounding rather than movement. */
const NOISE = 1.5;

/**
 * How far off the rest→peak line a sample may sit before it is called a flicker.
 *
 * Deliberately above `NOISE`: computed styles round to integers and the two calibrated endpoints
 * each carry their own rounding, so a legitimate mid-fade sample can miss the ideal line by a
 * couple of units without anything being wrong.
 */
const OFF_AXIS_LIMIT = 6;

/** How far past either end of the fade a sample may sit. Same rounding argument. */
const OVERSHOOT_LIMIT = 0.06;

function parseColour(value: string): Rgba {
  const nums = value.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return [0, 0, 0, 0];
  return [Number(nums[0]), Number(nums[1]), Number(nums[2]), nums.length > 3 ? Number(nums[3]) : 1];
}

/**
 * Premultiplied alpha — the space CSS actually interpolates colour in, and the space this has to
 * measure in for the same reason.
 *
 * The first version of this file compared rgb only, and it was blind to the exact thing it was
 * pointed at. These buttons rest at `transparent` (`rgba(0,0,0,0)`) and hover to an opaque colour,
 * so the whole fade lives in the alpha channel: `getComputedStyle` mid-fade returns the *target*
 * rgb with a fractional alpha, and the rgb channels therefore appear to snap in a single frame
 * while nothing detectable happens afterwards. Every fade looked instantaneous and every
 * calibration collapsed to rest == hover.
 *
 * Naively adding alpha as a fourth axis does not fix it either: the un-premultiplied midpoint of
 * transparent → `rgb(228,227,232)` is `rgba(228,227,232,0.5)`, which is nowhere near the straight
 * line between `(0,0,0,0)` and `(228,227,232,1)` — a correctly-behaving browser would be flagged as
 * anomalous on every single frame. Premultiplying puts it exactly on that line, because that is
 * where the spec says the interpolation happens.
 *
 * Alpha is scaled to 0–255 so all four axes carry comparable weight in the distance.
 */
function premultiply(c: Rgba): Rgba {
  return [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3] * 255];
}

function distance(a: Rgba, b: Rgba): number {
  const p = premultiply(a);
  const q = premultiply(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2], p[3] - q[3]);
}

function fmt(c: Rgba): string {
  const channel = (n: number) => String(Math.round(n)).padStart(3);
  return `${channel(c[0])},${channel(c[1])},${channel(c[2])} @${c[3].toFixed(2)}`;
}

/**
 * Where a sample sits on the rest→peak line, and how far off it.
 *
 * `t` is the projection (0 at rest, 1 at peak); `residual` is the perpendicular distance. Projecting
 * rather than comparing channel-by-channel is what makes this robust to the fade being anywhere in
 * flight — the question is never "is this the right colour" but "is this colour *on the way*".
 */
function project(sample: Rgba, rest: Rgba, peak: Rgba): { t: number; residual: number } | null {
  const s = premultiply(sample);
  const a = premultiply(rest);
  const b = premultiply(peak);
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2], b[3] - a[3]];
  const lengthSquared = axis.reduce((sum, v) => sum + v * v, 0);
  // Endpoints too close together to define a direction. Returning null rather than a residual keeps
  // a degenerate calibration from being reported as a large excursion — which is precisely what an
  // earlier version did, printing a confident `396.7 off-axis` on every frame of a surface whose
  // rest and hover had been mis-measured as the same colour.
  if (lengthSquared < 4) return null;
  const delta = [s[0] - a[0], s[1] - a[1], s[2] - a[2], s[3] - a[3]];
  const t = delta.reduce((sum, v, i) => sum + v * axis[i], 0) / lengthSquared;
  const residual = Math.hypot(...delta.map((v, i) => v - axis[i] * t));
  return { t, residual };
}

/**
 * Every computed property, as a plain record.
 *
 * Deliberately not a hand-picked list. The whole search so far assumed hovering these buttons changes
 * `background-color` and `color` and nothing else, and that assumption was never once checked — so
 * every instrument built to test it could only ever confirm or deny that pair. Enumerating the lot
 * removes the assumption instead of refining it.
 */
function snapshot(style: CSSStyleDeclaration): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < style.length; i += 1) {
    const prop = style.item(i);
    out[prop] = style.getPropertyValue(prop);
  }
  return out;
}

interface Track {
  surface: Surface;
  samples: Sample[];
  /** Calibrated endpoints of the fade. Undefined until the surface has been seen at rest / hovered. */
  rest?: Rgba;
  peak?: Rgba;
  hovered: boolean;
  /** When the pointer last entered or left — reversals within a frame or two of one are expected. */
  lastPointerAt: number;
  /** How far the furthest hovered sample sat from rest, for peak calibration. */
  peakDistance: number;
  /** Every computed property while at rest, captured once, for the hover diff. */
  restStyle?: Record<string, string>;
  /** Sign of the last movement along the fade axis, for reversal detection. */
  lastDirection: 0 | 1 | -1;
  /** How long the colour has been still, for calibration. */
  stillSince: number;
  /** Most recent fade position, mirrored onto each sample. */
  progress?: number;
}

export interface Probe {
  stop(): void;
  /** Dump the window around `at` (defaults to now) to the console, and return it as text. */
  report(at?: number, reason?: string, windowMs?: number): string;
  /** Every computed property that differs between resting and hovered, for whatever is hovered now. */
  styleDiff(): string;
  /** Every computed property that differs between resting and hovered, for whatever is hovered now. */
  styleDiff(): string;
  anomalies: Anomaly[];
  /** Called whenever a new anomaly is detected, so the page can show it without devtools. */
  onAnomaly?: (anomaly: Anomaly) => void;
  frames: number;
  dropped: number;
}

export function startProbe(surfaces: Surface[]): Probe {
  const tracks: Track[] = surfaces.map((surface) => ({
    surface,
    samples: [],
    hovered: false,
    peakDistance: 0,
    lastPointerAt: -Infinity,
    lastDirection: 0,
    stillSince: 0,
  }));
  const events: ProbeEvent[] = [];
  const anomalies: Anomaly[] = [];
  const cleanups: Array<() => void> = [];
  let running = true;
  let frames = 0;
  let dropped = 0;

  const probe: Probe = {
    anomalies,
    frames: 0,
    dropped: 0,
    styleDiff: () => '',
    stop() {
      running = false;
      cleanups.forEach((fn) => fn());
    },
    report,
  };

  function push(list: ProbeEvent[], event: ProbeEvent) {
    list.push(event);
    if (list.length > 400) list.shift();
  }

  function flag(track: Track, kind: Anomaly['kind'], detail: string, t: number) {
    const anomaly: Anomaly = { t, surface: track.surface.label, kind, detail };
    anomalies.push(anomaly);
    probe.onAnomaly?.(anomaly);
  }

  // Pointer state, so a reversal can be told from an ordinary hover-out.
  for (const track of tracks) {
    const { host, label } = track.surface;
    const over = () => {
      track.hovered = true;
      track.lastPointerAt = performance.now();
      push(events, { t: track.lastPointerAt, kind: 'over', surface: label });
    };
    const out = () => {
      track.hovered = false;
      track.lastPointerAt = performance.now();
      push(events, { t: track.lastPointerAt, kind: 'out', surface: label });
    };
    host.addEventListener('pointerover', over);
    host.addEventListener('pointerout', out);
    cleanups.push(() => {
      host.removeEventListener('pointerover', over);
      host.removeEventListener('pointerout', out);
    });
  }

  let previousFrame = performance.now();
  // Scrolling moves every box at once; only geometry that changes while the page is still is a signal.
  let lastScrollY = scrollY;
  let lastScrollX = scrollX;

  function tick() {
    if (!running) return;
    const now = performance.now();
    const gap = now - previousFrame;
    // Two frames' grace at 60Hz. A dropped frame is worth recording but is not itself an anomaly —
    // the whole point of this round is that the earlier runs had zero of them and flickered anyway.
    if (gap > 32) {
      dropped += 1;
      push(events, { t: now, kind: 'jank', surface: '—', detail: `${Math.round(gap)}ms frame` });
    }
    previousFrame = now;
    frames += 1;

    for (const track of tracks) {
      const style = getComputedStyle(track.surface.painted);
      const rect = track.surface.painted.getBoundingClientRect();
      const sample: Sample = {
        t: now,
        bg: parseColour(style.backgroundColor),
        fg: parseColour(style.color),
        // Rounded to a tenth of a pixel: a box that shifts by a fraction of a pixel re-rasterises its
        // text, and a glyph re-rasterisation is far more visible than the colour change underneath it.
        // Nothing so far has looked for this, because the whole search has been about colour.
        box: [
          Math.round(rect.x * 10) / 10,
          Math.round(rect.y * 10) / 10,
          Math.round(rect.width * 10) / 10,
          Math.round(rect.height * 10) / 10,
        ],
      };
      const previous = track.samples[track.samples.length - 1];
      track.samples.push(sample);
      if (track.samples.length > RING_FRAMES) track.samples.shift();
      if (!previous) continue;

      const moved = distance(sample.bg, previous.bg);

      // Geometry. Scrolling moves every box at once and is not what this is looking for, so only a
      // box that changes while the page is still counts.
      if (scrollY === lastScrollY && scrollX === lastScrollX) {
        const shifted = sample.box.some((v, i) => Math.abs(v - previous.box[i]) > 0.05);
        if (shifted) {
          flag(
            track,
            'moved',
            `box went [${previous.box.join(', ')}] → [${sample.box.join(', ')}] — the text re-rasterises when this happens`,
            now,
          );
        }
      }

      // Calibration. A colour that has been still for a while is an endpoint of the fade, and which
      // endpoint it is depends only on whether the pointer is inside — no need to guess from CSS.
      if (moved < NOISE) {
        // Rest still wants stillness: a resting colour is one that is not going anywhere.
        if (now - track.stillSince > 200 && !track.hovered) {
          track.rest = sample.bg;
          // One full snapshot per surface, taken the first time it is seen settled and unhovered.
          // This is what `styleDiff` compares against, and it is the only way to answer "what does
          // hovering this actually change" without assuming the answer in advance.
          if (!track.restStyle) track.restStyle = snapshot(style);
        }
      } else {
        track.stillSince = now;
      }

      /*
        The hover endpoint is the furthest the colour has ever got from rest, not a colour caught
        sitting still.

        Requiring stillness never calibrated during exactly the runs that matter: a fast sweep never
        holds a button long enough to settle, so `peak` stayed unset and every row printed
        `(uncalibrated)` — no `t`, no residual, the whole detector silent on the fastest passes.
        Tracking the maximum excursion converges from below instead, so a partial hover gives a
        partial estimate that later hovers improve on, and one full hover pins it exactly.
      */
      if (track.rest && track.hovered) {
        const excursion = distance(sample.bg, track.rest);
        if (excursion > track.peakDistance) {
          track.peakDistance = excursion;
          track.peak = sample.bg;
        }
      }

      const projection = track.rest && track.peak ? project(sample.bg, track.rest, track.peak) : null;
      if (projection) {
        const { t, residual } = projection;
        if (residual > OFF_AXIS_LIMIT) {
          flag(
            track,
            'off-axis',
            `painted ${fmt(sample.bg)} — ${residual.toFixed(1)} off the rest(${fmt(track.rest!)})→hover(${fmt(track.peak!)}) line, a colour the fade cannot produce`,
            now,
          );
        } else if (t < -OVERSHOOT_LIMIT || t > 1 + OVERSHOOT_LIMIT) {
          flag(track, 'overshoot', `painted ${fmt(sample.bg)} — t=${t.toFixed(2)}, past the end of the fade`, now);
        }
        // How far through its fade this surface is, so the report can show whether two neighbours
        // were lit at once — the shape a trailing smear down a tight list would take.
        sample.progress = t;
      }

      // Reversal, measured along the fade axis when it is known and by raw distance when it is not.
      if (moved > NOISE) {
        const reference = track.rest ?? previous.bg;
        const direction: 1 | -1 = distance(sample.bg, reference) > distance(previous.bg, reference) ? 1 : -1;
        // A pointer event legitimately reverses the fade; anything within ~3 frames of one is that.
        const explained = now - track.lastPointerAt < 50;
        if (track.lastDirection !== 0 && direction !== track.lastDirection && !explained) {
          flag(
            track,
            'reversal',
            `${fmt(previous.bg)} → ${fmt(sample.bg)} reversed direction with no pointer event for ${Math.round(now - track.lastPointerAt)}ms`,
            now,
          );
        }
        track.lastDirection = direction;
      }
    }

    lastScrollY = scrollY;
    lastScrollX = scrollX;
    probe.frames = frames;
    probe.dropped = dropped;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /**
   * The window around a moment, as a table.
   *
   * Only surfaces that actually moved are printed. A report listing eight motionless buttons buries
   * the one that did something, which is how the previous instrument's output became unreadable.
   */
  /*
    `windowMs` is how far back to look, and it is a choice rather than a constant because the thing
    being captured is a human noticing something. Seeing a flicker, deciding it was one, and finding
    the key is comfortably a second; too short a window and the event is already off the back of the
    report, which looks exactly like nothing having happened.
  */
  function report(at = performance.now(), reason = 'manual', windowMs = 2000): string {
    const from = at - windowMs;
    const to = at + 100;
    const active = tracks.filter((track) => {
      const window = track.samples.filter((s) => s.t >= from && s.t <= to);
      if (window.length < 2) return false;
      // Either channel counts. Text colour was captured from the first version of this file and never
      // reported, which meant a column animating `color` and one animating only `background-color`
      // produced identical-looking output.
      return window.some((s) => distance(s.bg, window[0].bg) > NOISE || distance(s.fg, window[0].fg) > NOISE);
    });

    const lines: string[] = [];
    // The dropped-frame count rides along in the artefact rather than only in an on-page counter:
    // this now samples 130-odd surfaces every frame, and the probe's own cost has to be visible in
    // the thing that gets pasted.
    lines.push(
      `── ${reason} @ ${at.toFixed(0)}ms · ${active.length} surface(s) moved in the last ${windowMs}ms · ${dropped} dropped frame(s) all run ──`,
    );
    if (active.length === 0) {
      lines.push('No colour movement on any watched surface in this window.');
      lines.push('If you saw a flicker here, it was not a background-colour change on these buttons.');
    }

    for (const track of active) {
      const window = track.samples.filter((s) => s.t >= from && s.t <= to);
      lines.push('');
      lines.push(
        `${track.surface.label}  (rest ${track.rest ? fmt(track.rest) : 'uncalibrated'} → hover ${track.peak ? fmt(track.peak) : 'uncalibrated'})`,
      );
      lines.push('    Δt     background              t     off-line   text colour');
      /*
        Consecutive frames holding the same colour collapse to one line with a count.

        A two-second window is well over a hundred frames per surface and nearly all of them are a
        colour sitting perfectly still — printing each one buries the handful of frames where
        something moved, which is the entire content of the report. Movement is never collapsed, so
        nothing that matters is lost; only the waiting is.
      */
      let held: Sample | null = null;
      let heldCount = 0;
      const flush = () => {
        if (held && heldCount > 1) lines.push(`         … ${heldCount - 1} more frames unchanged`);
        held = null;
        heldCount = 0;
      };
      for (const sample of window) {
        if (held && distance(sample.bg, held.bg) <= NOISE && distance(sample.fg, held.fg) <= NOISE) {
          heldCount += 1;
          continue;
        }
        flush();
        const projection = track.rest && track.peak ? project(sample.bg, track.rest, track.peak) : null;
        const marker = projection && projection.residual > OFF_AXIS_LIMIT ? '  ← off-axis' : '';
        lines.push(
          `  ${(sample.t - at).toFixed(0).padStart(6)}  ${fmt(sample.bg)}` +
            (projection
              ? `  ${projection.t.toFixed(2).padStart(6)}  ${projection.residual.toFixed(1).padStart(6)}`
              : '   (uncalibrated)') +
            `   ${fmt(sample.fg)}` +
            marker,
        );
        held = sample;
        heldCount = 1;
      }
      flush();
    }

    /*
      How many surfaces were part-way through a fade at the same moment.

      With the transition shorter than the time it takes to cross a button, a fast sweep down a tight
      list leaves each button still fading up as the next one starts — several partial highlights
      trailing the cursor at once. That is not a defect in any single transition, which is why every
      per-surface check comes back clean, and it is a plausible shape for what reads as a flicker. It
      would also happen identically in plain CSS, which matches where this is being seen.

      Tracks are sampled in the same rAF tick, so their buffers stay index-aligned.
    */
    const depth = tracks[0]?.samples.length ?? 0;
    let overlap = 0;
    let overlapAt = 0;
    for (let i = 0; i < depth; i += 1) {
      const first = tracks[0].samples[i];
      if (!first || first.t < from || first.t > to) continue;
      const lit = tracks.filter((track) => {
        const p = track.samples[i]?.progress;
        return p !== undefined && p > 0.05 && p < 0.95;
      }).length;
      if (lit > overlap) {
        overlap = lit;
        overlapAt = first.t;
      }
    }
    if (overlap > 1) {
      lines.push('');
      lines.push(`  ${overlap} surfaces were mid-fade simultaneously, at ${(overlapAt - at).toFixed(0)}ms.`);
    }

    const inWindow = events.filter((e) => e.t >= from && e.t <= to);
    if (inWindow.length) {
      lines.push('');
      lines.push('  events');
      for (const event of inWindow) {
        lines.push(
          `  ${(event.t - at).toFixed(0).padStart(6)}  ${event.kind} ${event.surface}${event.detail ? ` · ${event.detail}` : ''}`,
        );
      }
    }

    const text = lines.join('\n');
    console.log(text);
    return text;
  }

  /**
   * What hovering actually changes, for whatever is hovered right now.
   *
   * Answers the question the rest of this file cannot. The per-frame sampling watches two properties
   * because two properties were assumed to be the whole story, so a clean result from it only ever
   * means those two are behaving. This compares the full computed style against the resting snapshot,
   * so anything else that moves — a border, a shadow, a filter, a compositing hint, a font setting —
   * shows up by name whether or not anyone thought to look for it.
   */
  probe.styleDiff = function styleDiff(): string {
    const track = tracks.find((candidate) => candidate.hovered);
    if (!track) return 'Nothing is hovered. Point at a button and press D without moving off it.';
    if (!track.restStyle) {
      return `${track.surface.label} has not been seen at rest yet — move away, wait a moment, come back.`;
    }

    const rest = track.restStyle;
    const now = snapshot(getComputedStyle(track.surface.painted));
    const changed = Object.keys(now).filter((prop) => now[prop] !== rest[prop]);

    const lines = [`── what hovering changes on ${track.surface.label} · ${changed.length} propert(ies) ──`];
    if (changed.length === 0) lines.push('Nothing. The hover state is not reaching this element at all.');
    for (const prop of changed) {
      lines.push(`  ${prop}`);
      lines.push(`      rest  ${rest[prop]}`);
      lines.push(`      hover ${now[prop]}`);
    }
    const text = lines.join('\n');
    console.log(text);
    return text;
  };

  return probe;
}
