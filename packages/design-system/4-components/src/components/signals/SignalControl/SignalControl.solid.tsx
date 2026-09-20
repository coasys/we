export type * from './SignalControl.types';

import { createSignal, For, Match, Switch } from 'solid-js';

import { Row } from '../../../frameworks/solid';
import type { SignalAggregate, SignalControlProps, SignalTypeData } from './SignalControl.types';

/** The aggregate a mode's control is asking for, where the type names none. */
const AGGREGATE_FOR_MODE: Record<SignalTypeData['mode'], SignalAggregate> = {
  toggle: 'count',
  vote: 'sum',
  rating: 'mean',
  slider: 'mean',
};

/**
 * How this type's signals are read as one number.
 *
 * The type's own choice wins, which is the point — `median` is a real answer to "what do people
 * think of this", and it was silently drawn as a mean for as long as this component decided by mode
 * alone. Two exceptions, both the same shape: **an aggregate that cannot express what the control is
 * drawing is ignored.** A rating drawn as a count is a number of voters where the stars say a score,
 * and a vote drawn as a count is three people agreeing and three disagreeing reported as six.
 *
 * Those two are not hypothetical. `aggregate` defaults to `count` in the manifest and no form has
 * ever asked for it, so every type a community has made so far carries `count` whatever its mode —
 * obeying that literally would turn every existing rating into a headcount on upgrade.
 */
function aggregateFor(type: SignalTypeData): SignalAggregate {
  const fallback = AGGREGATE_FOR_MODE[type.mode] ?? 'count';
  if (!type.aggregate) return fallback;
  if (type.aggregate === 'count' && type.mode !== 'toggle') return fallback;
  return type.aggregate;
}

/**
 * The count's type size for each control size — one step behind the glyph, as a caption is.
 *
 * Tokens, now that the glyph states its own size: `100` is 12px against a 16px heart, which is the
 * caption ratio. It was `10px` — a raw length, chosen when the glyph was whatever an `xs` button
 * drew and the scale's smallest step would have equalled it. That number was never on screen to be
 * judged (see the note on `prop:fontSize` below), and the first time it was, it was too small.
 *
 * **Passed as `prop:fontSize`, and that prefix is load-bearing.**
 */
const COUNT_SIZE: Record<NonNullable<SignalControlProps['size']>, string> = { xs: '100', sm: '200', md: '' };

/**
 * The glyph's size for each control size.
 *
 * Stated rather than inherited from the button. A `we-icon` nested in a sized primitive takes its
 * size from that primitive's `--we-context-icon-size`, which draws an `xs` button's glyph at 12px —
 * right for an icon that labels a button, and too small for a mark that IS the control: at 12px the
 * heart in a comment thread reads as punctuation rather than as something to press. `md` keeps the
 * inherited size, where the button is big enough for the rule to be right.
 */
const GLYPH_SIZE: Record<NonNullable<SignalControlProps['size']>, string> = { xs: '16px', sm: '18px', md: '' };

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

  /** Unified signal emitter */
  const signal = (v: number) => {
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
  const aggregate = () => {
    if (props.preview) return previewValue() ?? 0;
    const sigs = props.signals ?? [];
    if (sigs.length === 0) return 0;
    const values = sigs.map((s) => s.value);
    const round = (n: number) => Math.round(n * 10) / 10;
    switch (aggregateFor(props.signalType)) {
      case 'count':
        return values.filter((v) => v !== 0).length;
      case 'sum':
        return values.reduce((acc, v) => acc + v, 0);
      case 'median': {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return round(sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
      }
      default:
        return round(values.reduce((acc, v) => acc + v, 0) / values.length);
    }
  };

  return (
    <div class={`signal-control ${props.class || ''}`} style={props.styles}>
      <Switch>
        {/* Toggle */}
        <Match when={props.signalType.mode === 'toggle'}>
          <Row class="signal-control__toggle" ay="center" gap={gap()}>
            {/*
              The glyph IS the control — no fill behind it, no padding around it.

              A `primary` button turned a reaction into a pressed key, which reads as heavier than
              the sentence it is about; and a ghost's padding left the icon floating in a box twice
              its size. `bare` takes both off, so what is drawn is the mark itself and it can be
              read at a glance in a row of them.

              Filled at both states, and coloured rather than outlined-then-filled: an outline that
              becomes a fill changes the SHAPE on press, which reads as the icon being swapped. The
              colour carries "mine", and the shape stays put.
            */}
            <we-button
              variant="bare"
              size={size()}
              p="0"
              disabled={isDisabled()}
              /*
                Quiet at rest, and one step MORE present under the pointer.

                The pair used to run the other way — `neutral-400` resting and `neutral-300` on
                hover — which acknowledged the pointer by receding. That is backwards in both
                polarities, not just the one it was noticed in: a lower scale position is nearer the
                background whichever way the ramp runs, because the background moves with it. In a
                dark theme it showed up as a heart that was too bright until you reached for it and
                then went dim.

                A scale position rather than a role, which is the exception the guidance allows: the
                unreacted glyph is a mark on the page rather than a foreground with a meaning, and
                `text-faint` — the quietest role there is, and `neutral-400` exactly — still read as
                something to attend to with the shape filled. Reacted is the accent at full strength:
                `accent-text` is tuned for legible prose, and a 16px glyph wants the saturated step
                rather than a readable one.
              */
              color={value() ? 'primary-500' : 'neutral-300'}
              prop:hoverProps={{ color: value() ? 'primary-500' : 'neutral-400' }}
              onClick={() => signal(value() ? 0 : props.signalType.rangeMax)}
            >
              <we-icon name={props.signalType.icon} weight="fill" size={GLYPH_SIZE[size()]} />
            </we-button>
            {/*
              `prop:fontSize`, not `fontSize` — the prefix is the difference between this working and
              doing nothing, and every `we-number` below carries it for the same reason.

              A camelCase prop with a COMPUTED value compiles to a lowercased property assignment,
              `el.fontsize = …`. Lit's reactive property is `fontSize`, so the value lands on an
              expando nobody reads and the element keeps the size it inherited. A literal
              (`fontSize="400"`) compiles to an attribute instead and works, which is why this fails
              only where the value is worked out — and fails silently, since the generated types are
              satisfied either way and there is nothing to see in the markup.
            */}
            <we-number class="signal-control__count" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
          </Row>
        </Match>

        {/* Vote */}
        <Match when={props.signalType.mode === 'vote'}>
          <Row class="signal-control__vote" ay="center" gap={gap()}>
            <we-button
              variant={value() !== null && value()! > 0 ? 'primary' : 'ghost'}
              size={size()}
              square
              disabled={isDisabled()}
              onClick={() => signal(value() !== null && value()! > 0 ? 0 : 1)}
            >
              <we-icon name={props.signalType.icon} />
            </we-button>
            <we-number class="signal-control__count" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
            <we-button
              variant={value() !== null && value()! < 0 ? 'primary' : 'ghost'}
              size={size()}
              square
              disabled={isDisabled()}
              onClick={() => signal(value() !== null && value()! < 0 ? 0 : -1)}
            >
              <we-icon name={props.signalType.iconSecondary || props.signalType.icon} />
            </we-button>
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

                  /** Clicking the same icon again resets to rangeMin (deselect) */
                  const handleClick = () => {
                    const target = props.signalType.rangeMin + i;
                    signal(value() === target ? props.signalType.rangeMin : target);
                  };

                  return (
                    <span
                      class={`signal-icon-stack${isDisabled() ? ' is-disabled' : ''}`}
                      onClick={isDisabled() ? undefined : handleClick}
                    >
                      {/* Background (empty) icon — muted colour via CSS */}
                      <we-icon name={props.signalType.icon} size={size() === 'md' ? 'sm' : 'xs'} />
                      {/* Foreground (filled) icon — primary colour via CSS, clipped to fraction */}
                      <span
                        class="signal-icon-stack__fill"
                        style={{ 'clip-path': `inset(0 ${(1 - fraction()) * 100}% 0 0)` }}
                      >
                        <we-icon name={props.signalType.icon} size={size() === 'md' ? 'sm' : 'xs'} />
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
          </Row>
        </Match>

        {/* ── slider ───────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'slider'}>
          <Row class="signal-control__slider" ay="center" gap={gap()}>
            {/* Community mean shown on the left */}
            <we-number class="signal-control__agg" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
            <we-icon name={props.signalType.icon} />
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
          </Row>
        </Match>
      </Switch>
    </div>
  );
}
