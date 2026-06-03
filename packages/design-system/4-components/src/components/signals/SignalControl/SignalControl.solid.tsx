export type * from './SignalControl.types';

import { createSignal, For, Match, Switch } from 'solid-js';

import { Row } from '../../../frameworks/solid';
import type { SignalControlProps } from './SignalControl.types';

export function SignalControl(props: SignalControlProps) {
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
   * Aggregate computed from the signals array according to SignalType.aggregate.
   * - toggle: count of signals with value !== 0
   * - vote:   net score (sum of all values, +1s and -1s cancel)
   * - rating/slider: mean value (sum / count)
   * Falls back to 0 if no signals.
   */
  const aggregate = () => {
    if (props.preview) return previewValue() ?? 0;
    const sigs = props.signals ?? [];
    if (sigs.length === 0) return 0;
    const mode = props.signalType.mode;
    if (mode === 'toggle') {
      return sigs.filter((s) => s.value !== 0).length;
    }
    if (mode === 'vote') {
      return sigs.reduce((acc, s) => acc + s.value, 0);
    }
    // rating / slider: mean rounded to 1 decimal place
    const sum = sigs.reduce((acc, s) => acc + s.value, 0);
    return Math.round((sum / sigs.length) * 10) / 10;
  };

  return (
    <div class={`signal-control ${props.class || ''}`} style={props.styles}>
      <Switch>
        {/* Toggle */}
        <Match when={props.signalType.mode === 'toggle'}>
          <Row class="signal-control__toggle" ay="center" gap="300">
            <we-button
              variant={value() ? 'primary' : 'ghost'}
              square
              disabled={isDisabled()}
              onClick={() => signal(value() ? 0 : props.signalType.rangeMax)}
            >
              <we-icon name={props.signalType.icon} />
            </we-button>
            <we-number class="signal-control__count" value={aggregate()} shorten />
          </Row>
        </Match>

        {/* Vote */}
        <Match when={props.signalType.mode === 'vote'}>
          <Row class="signal-control__vote" ay="center" gap="300">
            <we-button
              variant={value() !== null && value()! > 0 ? 'primary' : 'ghost'}
              square
              disabled={isDisabled()}
              onClick={() => signal(value() !== null && value()! > 0 ? 0 : 1)}
            >
              <we-icon name={props.signalType.icon} />
            </we-button>
            <we-number class="signal-control__count" value={aggregate()} shorten />
            <we-button
              variant={value() !== null && value()! < 0 ? 'primary' : 'ghost'}
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
            <we-number class="signal-control__agg" value={aggregate()} shorten />
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
                      <we-icon name={props.signalType.icon} size="sm" />
                      {/* Foreground (filled) icon — primary colour via CSS, clipped to fraction */}
                      <span
                        class="signal-icon-stack__fill"
                        style={{ 'clip-path': `inset(0 ${(1 - fraction()) * 100}% 0 0)` }}
                      >
                        <we-icon name={props.signalType.icon} size="sm" />
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
          <Row class="signal-control__slider" ay="center" gap="300">
            {/* Community mean shown on the left */}
            <we-number class="signal-control__agg" value={aggregate()} shorten />
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
