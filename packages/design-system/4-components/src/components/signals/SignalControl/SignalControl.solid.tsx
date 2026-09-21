export type * from './SignalControl.types';

import { createSignal, For, Match, Show, Switch } from 'solid-js';

import { Row } from '../../../frameworks/solid';
import { GLYPH_SIZE, SIGNAL_GLYPH_WEIGHT, tallySignals } from '../aggregate';
import { CountMark } from '../CountMark/CountMark.solid';
import type { SignalControlProps } from './SignalControl.types';

/**
 * The count's type size for each control size — one step behind the glyph, as a caption is.
 *
 * For the modes that still draw their own count. The toggle's went with it to {@link CountMark},
 * which holds the same table for the same reason: `100` is 12px against a 16px mark, the caption
 * ratio.
 *
 * **Passed as `prop:fontSize`, and that prefix is load-bearing** — a camelCase prop with a computed
 * value on a `we-*` element compiles to a lowercased property assignment Lit never reads.
 */
const COUNT_SIZE: Record<NonNullable<SignalControlProps['size']>, string> = { xs: '100', sm: '200', md: '' };

export function SignalControl(props: SignalControlProps) {
  const size = () => props.size ?? 'md';
  /**
   * The gap between the glyph and its count, closed up as the control shrinks.
   *
   * `100` below `md`, not `200`: the two are one thing being read — a mark and how many — and at a
   * thread's weight a wider gap set them apart as a glyph and then a number.
   */
  const gap = () => (size() === 'md' ? '300' : '100');
  /**
   * The size a pressable half of a control is drawn at — one step below the control itself.
   *
   * A `square` button takes its height from its component size alone, so a mode built from two or
   * three of them came out taller than one built from a glyph and a number. Stepping them down puts
   * every mode on one line at a given size, which is what lets a column of them line up with the
   * names beside them.
   */
  const pressSize = () => (size() === 'md' ? 'sm' : 'xs');
  const [previewValue, setPreviewValue] = createSignal<number | null>(null);
  /** Draft value while the slider thumb is being dragged — not persisted until release */
  const [sliderDraft, setSliderDraft] = createSignal<number | null>(null);

  /** The current user's signal value derived from the signals array */
  const myValue = () => {
    if (props.preview) return previewValue();
    const mine = props.signals?.find((s) => s.author === props.myDid);
    return mine !== undefined ? mine.value : null;
  };

  /** Unified reactive value */
  const value = () => myValue();

  /**
   * Whether this agent's own reaction satisfies a test — the vote's "is this arrow mine".
   *
   * One helper because the answer is read three times per arrow (the colour, the hover colour and
   * what the press should write) and a fourth spelling of `value() !== null && value()! > 0` is a
   * fourth chance for one of them to disagree with the others.
   */
  const mineIs = (test: (v: number) => boolean) => {
    const v = value();
    return v !== null && test(v);
  };

  /**
   * Unified signal emitter. `null` withdraws — see `upsertSignal` for why that is not a zero.
   */
  const signal = (v: number | null) => {
    if (props.preview) setPreviewValue(v);
    else props.onSignal?.(v);
  };

  /** Disabled: never in preview mode */
  const isDisabled = () => !props.preview && (props.disabled ?? false);

  /**
   * The score under the pointer while a rating is being dragged — not written until release.
   *
   * The rating's counterpart to `sliderDraft`, and it exists for the reason that one does: a value
   * chosen by moving has to be *shown* while it moves, or the person is choosing blind. Null between
   * drags, so `value()` is what the stars are drawn from the rest of the time.
   */
  const [ratingDraft, setRatingDraft] = createSignal<number | null>(null);
  /** What the stars draw: the drag if there is one, otherwise what is stored. */
  const ratingShown = () => ratingDraft() ?? value();

  /** The icon row, for turning a pointer position into a score. */
  let ratingRow: HTMLDivElement | undefined;

  /**
   * The score at a point along the icon row, snapped to the type's own step.
   *
   * Measured against the row rather than counted per icon, which is what makes a *drag* work at all:
   * the pointer is captured by the element the gesture began on, so every move after the first
   * arrives on that one icon and asking which icon is under the cursor answers the same thing all
   * the way across. The row's box is the only thing that knows where the pointer actually is.
   *
   * Clamped to at least one step, so dragging to the far left is the lowest score rather than
   * nothing — taking a rating back is the Clear, and a gesture that silently withdrew at one end
   * would be the `rangeMin`-means-delete trap wearing a different coat.
   */
  const scoreAt = (clientX: number): number => {
    const box = ratingRow?.getBoundingClientRect();
    const { rangeMin, rangeMax } = props.signalType;
    const span = rangeMax - rangeMin;
    if (!box || !box.width || span <= 0) return rangeMax;
    const step = props.signalType.step && props.signalType.step > 0 ? props.signalType.step : 1;
    const along = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const raw = rangeMin + along * span;
    const snapped = rangeMin + Math.round((raw - rangeMin) / step) * step;
    // Rounding can land a hair outside on either end, and a float can carry a tail — both matter
    // because the value is compared against a stored one.
    const bounded = Math.min(rangeMax, Math.max(rangeMin + step, snapped));
    return Number(bounded.toFixed(4));
  };

  /**
   * The signals read as one number, by whichever aggregate {@link aggregateFor} settles on.
   *
   * - `count`: how many people reacted — a zero is a withdrawn signal, not a reaction.
   * - `sum`:   the net score, where +1s and -1s cancel.
   * - `mean` / `median`: the middle of what was given, to one decimal place.
   *
   * 0 with nothing to read, which is what an untouched control shows.
   */
  const aggregate = () => (props.preview ? (previewValue() ?? 0) : tallySignals(props.signalType, props.signals ?? []));

  /**
   * Taking a reaction back, as a control of its own.
   *
   * ## Why it is not the press that gave it
   *
   * Two of the four modes have a natural undo — press the heart again, press the arrow again —
   * because there are two states and the control holds both. A rating and a slider do not: setting
   * a value and having no value are genuinely different acts, and the rating only APPEARED to have
   * an undo because pressing your own star wrote `rangeMin`, which was 0, which used to mean
   * delete. On a 1–5 rating that same press wrote 1 and there was no way back at all; on a slider
   * there was never one.
   *
   * ## Why it is visible rather than a gesture on the glyph
   *
   * The glyph is the tempting place — it is already lit to say the reaction is yours, so pressing
   * it to un-light it reads well. But it is decorative in three of the four modes and the control
   * itself in the fourth, so the same press would mean two things, and an affordance nobody can see
   * is one nobody finds. A visible control costs one element and needs no guessing.
   *
   * ## Shown only when there is something to withdraw
   *
   * Absent until this agent has reacted, which is what keeps it from being noise on every untouched
   * row and what makes it self-explanatory when it appears. Present in every mode, including the
   * two that also undo by press: removing a learned gesture would cost more than the redundancy.
   */
  const clearControl = () => (
    <Show when={value() !== null && !isDisabled()}>
      <we-tooltip content="Remove your reaction">
        <we-button
          class="signal-control__clear"
          variant="bare"
          size={size() === 'md' ? 'sm' : 'xs'}
          square
          color="neutral-300"
          prop:hoverProps={{ color: 'danger-text' }}
          label="Remove your reaction"
          onClick={() => signal(null)}
        >
          <we-icon name="x" size={size() === 'md' ? '16px' : '12px'} />
        </we-button>
      </we-tooltip>
    </Show>
  );

  return (
    <div class={`signal-control ${props.class || ''}`} style={props.styles}>
      <Switch>
        {/*
          Toggle — a mark and how many, which is `CountMark`.

          Delegated rather than drawn here, because the cards feed draws the same thing beside it in
          a schema and the two drifted twice: different sizes, different colours, a different answer
          to the pointer. See `CountMark` for why a template cannot simply match this.
        */}
        <Match when={props.signalType.mode === 'toggle'}>
          <Row class="signal-control__toggle-row" ay="center" gap={gap()}>
            <CountMark
              /*
                The number leads, as the rating's and the slider's aggregates do.

                A full display is a COLUMN of controls, and a reader scans down it: with the count
                on the far side of the glyph, the toggle's figure was the one number not in line
                with the rest. On a card — where `CountMark` is a mark on its own — the count still
                follows, which is what reads left to right as "this thing, that many".
              */
              countFirst
              class="signal-control__toggle"
              icon={props.signalType.icon}
              count={aggregate()}
              mine={Boolean(value())}
              size={size()}
              // A control's reading, beside the vote's net score and the rating's mean — not a
              // mark's own quiet number, which is what the compact row draws. See `countTone`.
              countTone="text"
              disabled={isDisabled()}
              onPress={() => signal(value() ? null : props.signalType.rangeMax)}
            />
            {clearControl()}
          </Row>
        </Match>

        {/*
          Vote — an arrow each way, and the GLYPH is what says which one is yours.

          It used to be the button: `primary` when yours and `ghost` otherwise, which paints a solid
          accent rectangle around the arrow. That is a different language from every other mode here
          — a like is a filled heart, a rating is filled stars — so one vocabulary said "mine" three
          ways on one card, and the loudest of the three was the one on the control nobody had
          pressed most recently.

          `bare` is the appearance-free variant and inherits its colour, so the same pair
          `CountMark` uses reaches the icon: accent when it is yours, a quiet neutral when it is not,
          one step more present under the pointer. A scale position rather than a role for the
          reason `CountMark` records — `text-faint` is tuned for the strokes of text and reads loud
          as solid ink.
        */}
        <Match when={props.signalType.mode === 'vote'}>
          <Row class="signal-control__vote" ay="center" gap={gap()}>
            <we-button
              variant="bare"
              /*
                A step below the control's own size, as the clear button is.

                `square` sizes a button purely by its component height, so at `sm` two of them made
                the vote 32px tall where a toggle and a slider are 24 — and in a list that reads as
                one type's row sitting lower than its neighbours. The glyph inside keeps the
                control's size, so what shrinks is the press target's padding, not the mark.
              */
              size={pressSize()}
              square
              color={mineIs((v) => v > 0) ? 'primary-500' : 'neutral-300'}
              prop:hoverProps={{ color: mineIs((v) => v > 0) ? 'primary-500' : 'neutral-400' }}
              disabled={isDisabled()}
              label="Vote up"
              onClick={() => signal(mineIs((v) => v > 0) ? null : 1)}
            >
              <we-icon name={props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} size={GLYPH_SIZE[size()]} />
            </we-button>
            {/* The community's net score, which is nobody's in particular — so it stays text. */}
            <we-number class="signal-control__count" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
            <we-button
              variant="bare"
              size={pressSize()}
              square
              color={mineIs((v) => v < 0) ? 'primary-500' : 'neutral-300'}
              prop:hoverProps={{ color: mineIs((v) => v < 0) ? 'primary-500' : 'neutral-400' }}
              disabled={isDisabled()}
              label="Vote down"
              onClick={() => signal(mineIs((v) => v < 0) ? null : -1)}
            >
              <we-icon
                name={props.signalType.iconSecondary || props.signalType.icon}
                weight={SIGNAL_GLYPH_WEIGHT}
                size={GLYPH_SIZE[size()]}
              />
            </we-button>
            {clearControl()}
          </Row>
        </Match>

        {/* ── rating ─────────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'rating'}>
          <Row class="signal-control__rating" ay="center" gap="400">
            {/* Community mean */}
            <we-number class="signal-control__agg" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
            {/*
              The stars ARE the input — dragged across, not clicked one at a time.

              The number input that used to sit beside them is gone. It was the widest thing on the
              row by some way, which is what crushed a type's name into a column of single letters
              in the sheet, and it asked somebody to type a figure at a control whose whole point is
              that you can see the answer.

              A drag reads better and is the same gesture as the slider's one mode along: the stars
              fill as the pointer moves and a bubble above says the number, so the score is legible
              while it is being chosen rather than after. A click still works — it is a drag that
              travelled no distance, and it goes through the same path rather than a second one.

              The tooltip is opened rather than hovered, which `we-tooltip` supports through its own
              `open` property, and it never takes the pointer — that was fixed when an open bubble
              blocked clicks on its own trigger, and it is what lets this one sit over the stars
              while they are being dragged.
            */}
            {/*
              The bubble says the score only while it is being CHOSEN.

              `ratingShown()` was in here, which is the draft OR the stored value — so a rated
              control had something to say at rest and hovering it popped a number nobody asked
              for. What the bubble is for is the value under the pointer during a drag; at rest the
              stars already say it.
            */}
            <we-tooltip
              open={ratingDraft() !== null}
              content={ratingDraft() === null ? '' : String(ratingDraft())}
              placement="top"
            >
              <Row
                class="signal-control__rating-icons"
                ay="center"
                gap="100"
                ref={(el: HTMLDivElement) => (ratingRow = el)}
                /*
                  One control, so it is reachable without a pointer.

                  The stars were spans with a click each, which no keyboard could reach — the number
                  input was the only way in, and it has just been removed. `role="slider"` is what
                  this is: a value in a range, set by moving along it.
                */
                role="slider"
                tabindex={isDisabled() ? undefined : 0}
                aria-valuemin={props.signalType.rangeMin}
                aria-valuemax={props.signalType.rangeMax}
                aria-valuenow={value() ?? props.signalType.rangeMin}
                aria-label="Rating"
                onPointerDown={(e: PointerEvent) => {
                  if (isDisabled()) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setRatingDraft(scoreAt(e.clientX));
                }}
                onPointerMove={(e: PointerEvent) => {
                  if (ratingDraft() === null) return;
                  setRatingDraft(scoreAt(e.clientX));
                }}
                onPointerUp={(e: PointerEvent) => {
                  const chosen = ratingDraft();
                  setRatingDraft(null);
                  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                  // Pressing the score you are already on is the no-op it looks like; withdrawing is
                  // the Clear.
                  if (chosen !== null && chosen !== value()) signal(chosen);
                }}
                // A drag that leaves the window, or is taken by something else, writes nothing.
                onPointerCancel={() => setRatingDraft(null)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (isDisabled()) return;
                  const step = props.signalType.step && props.signalType.step > 0 ? props.signalType.step : 1;
                  const { rangeMin, rangeMax } = props.signalType;
                  const from = value() ?? rangeMin;
                  const move =
                    e.key === 'ArrowRight' || e.key === 'ArrowUp'
                      ? step
                      : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
                        ? -step
                        : 0;
                  if (!move) return;
                  e.preventDefault();
                  const next = Math.min(rangeMax, Math.max(rangeMin + step, from + move));
                  if (next !== value()) signal(Number(next.toFixed(4)));
                }}
              >
                <For
                  each={Array.from({ length: props.signalType.rangeMax - props.signalType.rangeMin }, (_, i) => i + 1)}
                >
                  {(i) => {
                    /**
                     * Fraction of this icon that should appear "filled".
                     * Icon i (1-indexed) is fully filled when value >= rangeMin + i,
                     * partially filled for fractional values in between.
                     */
                    const fraction = () => {
                      const v = ratingShown();
                      if (v === null) return 0;
                      return Math.min(1, Math.max(0, v - (props.signalType.rangeMin + i - 1)));
                    };

                    return (
                      // No handler of its own: the row above owns the gesture, so a press on any star
                      // is a drag that began there. See the row's pointer handlers.
                      <span class={`signal-icon-stack${isDisabled() ? ' is-disabled' : ''}`}>
                        {/* Background (empty) icon — muted colour via CSS */}
                        <we-icon name={props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} size={GLYPH_SIZE[size()]} />
                        {/* Foreground (filled) icon — primary colour via CSS, clipped to fraction */}
                        <span
                          class="signal-icon-stack__fill"
                          style={{ 'clip-path': `inset(0 ${(1 - fraction()) * 100}% 0 0)` }}
                        >
                          <we-icon
                            name={props.signalType.icon}
                            weight={SIGNAL_GLYPH_WEIGHT}
                            size={GLYPH_SIZE[size()]}
                          />
                        </span>
                      </span>
                    );
                  }}
                </For>
              </Row>
            </we-tooltip>
            {clearControl()}
          </Row>
        </Match>

        {/* ── slider ───────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'slider'}>
          <Row class="signal-control__slider" ay="center" gap={gap()}>
            {/* Community mean shown on the left */}
            <we-number class="signal-control__agg" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
            {/*
              And the glyph says whether the reading is yours, as it does in every other mode.

              It inherited its colour, so on a dark theme it was white whether you had touched the
              slider or not — the one mode where a reaction gave no sign of being yours. `color` on
              a `we-icon` is a Layout-tier prop and lands on the element itself, so no wrapper is
              needed.
            */}
            <we-icon
              name={props.signalType.icon}
              weight={SIGNAL_GLYPH_WEIGHT}
              size={GLYPH_SIZE[size()]}
              color={value() !== null ? 'primary-500' : 'neutral-300'}
            />
            {/*
              The reading is a bubble over the thumb while it moves, not a figure parked at the end.

              The same shape the rating now has, and for the same reason: a value chosen by moving
              wants to be legible *where the eye already is*, which is the thumb. A number at the far
              end of the track asked somebody to look away from what they were dragging to read what
              they were setting — and it sat there permanently for a value that is only in question
              while a drag is happening.

              `sliderDraft` already tracked exactly this: `we-slider` emits `input` as it moves and
              `change` on release, so the draft is non-null for precisely the length of a drag. The
              bubble needed no new state, only somewhere to be shown.
            */}
            <we-tooltip open={sliderDraft() !== null} content={String(sliderDraft() ?? '')} placement="top">
              <we-slider
                min={props.signalType.rangeMin}
                max={props.signalType.rangeMax}
                step={props.signalType.step ?? 1}
                value={sliderDraft() ?? value() ?? props.signalType.rangeMin}
                disabled={isDisabled()}
                onInput={(e: Event) => setSliderDraft((e as CustomEvent<number>).detail)}
                onChange={(e: Event) => {
                  const v = (e as CustomEvent<number>).detail;
                  signal(v);
                  setSliderDraft(null);
                }}
              />
            </we-tooltip>
            {clearControl()}
          </Row>
        </Match>
      </Switch>
    </div>
  );
}
