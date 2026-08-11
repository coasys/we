# Hover flicker probe

```sh
pnpm --filter @we/playground-flicker-probe dev   # http://localhost:3310
```

Sweep your pointer down the columns. **The instant you see a flicker, press <kbd>space</kbd>.**

---

## Why this exists

Four rounds of instrumentation in the graph explorer all came back clean — zero dropped frames, zero
long tasks, transition sequences that read as textbook — while the flicker stayed plainly visible.
That is not a hard bug, it is the wrong instrument, in two ways.

**It listened to transition events.** A `transitionrun`/`cancel` pair describes an animation the
browser agreed to run. A flicker can be a single frame painted the wrong colour with no animation
involved: a style recalculation landing between frames, an element repainting at its base state for
one tick, a rule briefly losing the cascade. None of those emit anything. The instrument was
structurally incapable of seeing the class of bug it was pointed at, so its silence meant nothing.

**It ran in one app.** Every measurement so far came from the graph explorer, which is Solid, plus
the design system, plus a scroll rail, plus a resizing panel. Nothing separated those, so "the design
system has a hover bug" was never actually established — only assumed.

This page fixes both.

## How to read it

Six columns, identical in size, spacing and layout. They differ in exactly one thing each:

| Column | What it adds | What it means if the flicker is here |
|---|---|---|
| `we-button` ghost | Lit, shadow DOM, DS state rules | The explorer's scenario buttons exactly — the bug is in the design system |
| `we-button` + `hoverProps` | The hover colour as a DS prop rather than from the variant | The DS prop path specifically, not the variant styling |
| plain `<button>`, 50ms ease-out | Nothing. Bare CSS, same metrics, same transition | The browser, the compositor or the display — nothing WE can fix |
| plain `<button>`, `all 150ms ease` | The design system's behaviour before this week, in bare CSS | Duration/curve, independent of everything WE |
| plain `<button>`, `transition: none` | Nothing — the hover colour is simply on or off | **Not a transition artefact at all**, since there is no transition. The repaint itself, or the pointer losing and regaining the button |
| plain `<button>`, opaque rest colour | A fade between two solid colours instead of out of `transparent` | Rules transparency in or out: fading from `transparent` interpolates alpha and composites every frame against what is behind it, and this column is the only one that does not |

Wherever it appears, every layer absent from that column is eliminated. And there is no framework on
this page at all — so if the flicker reproduces here, Solid is not involved; if it reproduces only in
the explorer, Solid or the explorer's own chrome is precisely where to look next.

That one bit of information is the whole reason this is a separate app rather than another panel.

## What has been established

**Round one.** It reproduces on the plain `<button>` columns — no Lit, no shadow DOM, no design
system, no framework, just a CSS `:hover` rule. That eliminates the entire stack the earlier rounds
were spent changing, and the design system was never the right place to be looking.

**Round two**, from the columns added after it:

| Column | Flicker | What that rules out |
|---|---|---|
| 50ms ease-out (three variants) | frequent | — |
| 150ms ease | very rare | Shorter transitions are *worse*, which is the opposite of the interruption theory |
| `transition: none` | **never** | It requires a transition. Not repaint, not the pointer losing and regaining the button, not layout shift, not compositing the hover state |
| opaque → opaque | frequent | Transparency and alpha compositing |

That leaves two candidates, and they are distinguishable by whether a list is needed:

- **The trailing fade** — with any transition, a button you have left keeps fading behind you, so a
  fast sweep down a tight list leaves two or three partial highlights trailing the cursor. At 50ms
  the trail is short and sharp; at 150ms `ease` each button only reaches a fraction of the way before
  reversing, so it is a faint wash; with `none` there is no trail. Fits every observation.
- **A single-transition artefact** — dithering or compositing noise as the colour crosses values
  between two near-identical shades, more visible the faster it is crossed. Also fits every
  observation.

The `fades in, snaps out` / `snaps in, fades out` pair separates the two directions of the hover, and
the lone button at the bottom of the page settles the larger question: nothing is near it, so nothing
else can be mid-fade at the same time. A flicker there is one transition misbehaving; no flicker
there while the lists flicker constantly means no individual transition is wrong at all.

The `50ms ease` column exists because the `150ms ease` one changed duration *and* easing together,
leaving the two confounded.

The same run also found a bug in this probe, worth recording because it is the same mistake as the
transition-event instrument in a different disguise. The first version compared rgb only. These
buttons rest at `transparent` and hover to an opaque colour, so the entire fade is in the alpha
channel — `getComputedStyle` returns the *target* rgb with a fractional alpha throughout. Every fade
therefore looked like an instantaneous one-frame jump, calibration collapsed to `rest == hover`, and
the resulting divide-by-nothing printed a confident `396.7 off-axis` on every frame. Measuring in
premultiplied alpha, which is where the spec says interpolation happens, fixes all three.

## Retired columns

Five columns were removed once their question was answered. Their findings, so they are not
re-litigated:

| Retired column | What it established |
|---|---|
| plain, 50ms ease-out | Reproduces outside WE entirely — no Lit, no shadow DOM, no framework |
| plain, `all 150ms ease` | Shorter transitions are *worse*, which killed the interrupted-transition theory |
| plain, 50ms `ease` | Curve is not the variable; the 150ms column had confounded it with duration |
| snaps in, fades out | Isolated the trailing fade-out as the mechanism behind the plain-CSS flicker |
| opaque → opaque | Transparency and alpha compositing are not involved |

They all carried a *symmetric* transition, so after the departure fix they would trail for a reason
already understood, and would say nothing about what remains.

## Keys

| Key | What it does |
|---|---|
| <kbd>space</kbd> | Dump the capture window, with your keypress at `0` |
| <kbd>d</kbd> | While pointing at a button, list every computed property hovering it changes |

## What it measures

`getComputedStyle` on each painted surface, **once per frame inside rAF** — after style and layout,
before paint. Whatever number comes back is what is about to be on screen, whether or not a
transition is attached to it.

Two detectors run continuously, and results appear on the page — no devtools needed.

**Reversal** — the colour moved toward the hover state, then back, with no pointer event within
~3 frames. Cheap, catches the obvious case.

**Off-axis excursion** — the one that matters. Every legitimate colour during a fade lies on the
straight line between the resting colour and the hovered colour: `sample = rest + t·(peak − rest)`.
That is what interpolation *is*. Both endpoints are calibrated automatically from whatever the
surface settles on while still. Any sample off that line is a colour the fade could not have
produced, and its distance off it is a number rather than an impression. A `t` outside `[0, 1]` is
the same claim pointing the other way: a colour past either end of the fade.

## The space key

Previous rounds produced a wall of events with an invitation to find the anomaly in it. This inverts
that: your eye is the oracle, and the data is aligned to it. Pressing space dumps the preceding 500ms
of every surface that moved — colour per frame, its position along the fade, its distance off the
line — with your keypress at `0`, plus the pointer events and any dropped frames in the same window.

## What a null result means

If you press space on a flicker you definitely saw and the dump says

> No colour movement on any watched surface in this window.

that is a real finding, not a failure. It means the flicker is **not** a background-colour change on
these buttons, and the search moves to what else could repaint there: the `::before` gradient
overlay, the focus ring, a layout shift moving the button under the cursor, or the surrounding chrome
rather than the button at all.

The probe is built to be able to come back empty. That is what makes a positive result worth
believing.
