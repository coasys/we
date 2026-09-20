export type * from './SignalControl.types';

import { createSignal, For, Match, Switch } from 'solid-js';

import { Row } from '../../../frameworks/solid';
import { SIGNAL_GLYPH_WEIGHT, tallySignals } from '../aggregate';
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
  const aggregate = () => (props.preview ? (previewValue() ?? 0) : tallySignals(props.signalType, props.signals ?? []));

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
          <CountMark
            class="signal-control__toggle"
            icon={props.signalType.icon}
            count={aggregate()}
            mine={Boolean(value())}
            size={size()}
            disabled={isDisabled()}
            onPress={() => signal(value() ? 0 : props.signalType.rangeMax)}
          />
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
              <we-icon name={props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} />
            </we-button>
            <we-number class="signal-control__count" prop:fontSize={COUNT_SIZE[size()]} value={aggregate()} shorten />
            <we-button
              variant={value() !== null && value()! < 0 ? 'primary' : 'ghost'}
              size={size()}
              square
              disabled={isDisabled()}
              onClick={() => signal(value() !== null && value()! < 0 ? 0 : -1)}
            >
              <we-icon name={props.signalType.iconSecondary || props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} />
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
                      <we-icon
                        name={props.signalType.icon}
                        weight={SIGNAL_GLYPH_WEIGHT}
                        size={size() === 'md' ? 'sm' : 'xs'}
                      />
                      {/* Foreground (filled) icon — primary colour via CSS, clipped to fraction */}
                      <span
                        class="signal-icon-stack__fill"
                        style={{ 'clip-path': `inset(0 ${(1 - fraction()) * 100}% 0 0)` }}
                      >
                        <we-icon
                          name={props.signalType.icon}
                          weight={SIGNAL_GLYPH_WEIGHT}
                          size={size() === 'md' ? 'sm' : 'xs'}
                        />
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
            <we-icon name={props.signalType.icon} weight={SIGNAL_GLYPH_WEIGHT} />
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
