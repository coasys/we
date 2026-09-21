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
              class="signal-control__toggle"
              icon={props.signalType.icon}
              count={aggregate()}
              mine={Boolean(value())}
              size={size()}
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
              size={size()}
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
              size={size()}
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
            {/* Icon row: one icon per integer step between rangeMin and rangeMax */}
            <Row class="signal-control__rating-icons" ay="center" gap="100">
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
                    const v = value();
                    if (v === null) return 0;
                    return Math.min(1, Math.max(0, v - (props.signalType.rangeMin + i - 1)));
                  };

                  /*
                    Pressing a star sets that score, and pressing the one you are already on does
                    nothing.

                    It used to write `rangeMin`, which withdrew the rating — but only because
                    `rangeMin` happened to be 0 and 0 happened to mean "delete". On a 1–5 rating the
                    same press wrote 1, so half the communities that could make a rating had no way
                    to take one back at all. Withdrawing is the Clear beside the control now, and
                    pressing your own score is the no-op it looks like.
                  */
                  const handleClick = () => {
                    const target = props.signalType.rangeMin + i;
                    if (value() !== target) signal(target);
                  };

                  return (
                    <span
                      class={`signal-icon-stack${isDisabled() ? ' is-disabled' : ''}`}
                      onClick={isDisabled() ? undefined : handleClick}
                    >
                      {/* Background (empty) icon — muted colour via CSS */}
                      <we-icon name={props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} size={GLYPH_SIZE[size()]} />
                      {/* Foreground (filled) icon — primary colour via CSS, clipped to fraction */}
                      <span
                        class="signal-icon-stack__fill"
                        style={{ 'clip-path': `inset(0 ${(1 - fraction()) * 100}% 0 0)` }}
                      >
                        <we-icon name={props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} size={GLYPH_SIZE[size()]} />
                      </span>
                    </span>
                  );
                }}
              </For>
            </Row>
            {/* Number input for precise value entry */}
            <we-number-input
              class="signal-control__rating-input"
              min={props.signalType.rangeMin}
              max={props.signalType.rangeMax}
              step={props.signalType.step ?? 1}
              value={value() ?? props.signalType.rangeMin}
              disabled={isDisabled()}
              onChange={(e: Event) => signal((e as CustomEvent<number>).detail)}
            />
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
            {/* Live position during drag, settled value after */}
            <we-number
              class="signal-control__slider-value"
              value={sliderDraft() ?? value() ?? props.signalType.rangeMin}
            />
            {clearControl()}
          </Row>
        </Match>
      </Switch>
    </div>
  );
}
