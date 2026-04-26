export type * from './SignalControl.types';

import type { IconWeight } from '@we/primitives/types';
import type { JSX } from 'solid-js';
import { createSignal, For, Match, Switch } from 'solid-js';

import { Row } from '../../../frameworks/solid';
import type { SignalControlProps } from './SignalControl.types';

/** Renders an emoji inline or a design-system icon by name */
function renderIcon(icon: string, weight?: IconWeight): JSX.Element {
  return /^[a-z0-9-]+$/i.test(icon) ? (
    ((<we-icon name={icon} {...(weight !== undefined ? { weight } : {})} />) as JSX.Element)
  ) : (
    <span class="signal-icon-emoji">{icon}</span>
  );
}

export function SignalControl(props: SignalControlProps) {
  const [previewValue, setPreviewValue] = createSignal<number | null>(null);

  /** Unified reactive value: internal in preview mode, external otherwise */
  const value = () => (props.preview ? previewValue() : (props.myValue ?? null));

  /** Unified signal emitter */
  const signal = (v: number) => {
    if (props.preview) setPreviewValue(v);
    else props.onSignal?.(v);
  };

  /** Disabled: never in preview mode */
  const isDisabled = () => !props.preview && (props.disabled ?? false);

  /** In preview mode derive a sensible aggregate from the internal value */
  const aggregate = () => (props.preview ? (previewValue() ?? 0) : (props.aggregate ?? 0));

  return (
    <div class={`signal-control ${props.class || ''}`} style={props.styles}>
      <Switch>
        {/* Toggle */}
        <Match when={props.signalType.mode === 'toggle'}>
          <Row class="signal-control__toggle" ay="center" gap="300">
            <we-button
              variant={value() ? 'primary' : 'ghost'}
              disabled={isDisabled()}
              onClick={() => signal(value() ? 0 : props.signalType.rangeMax)}
            >
              {renderIcon(props.signalType.icon)}
            </we-button>
            <we-number class="signal-control__count" value={aggregate()} shorten />
          </Row>
        </Match>

        {/* Vote */}
        <Match when={props.signalType.mode === 'vote'}>
          <Row class="signal-control__vote" ay="center" gap="300">
            <we-button
              variant={value() !== null && value()! > 0 ? 'primary' : 'ghost'}
              disabled={isDisabled()}
              onClick={() => signal(value() !== null && value()! > 0 ? 0 : props.signalType.rangeMax)}
            >
              {renderIcon(props.signalType.icon)}
            </we-button>
            <we-number class="signal-control__count" value={aggregate()} shorten />
            <we-button
              variant={value() !== null && value()! < 0 ? 'primary' : 'ghost'}
              disabled={isDisabled()}
              onClick={() => signal(value() !== null && value()! < 0 ? 0 : props.signalType.rangeMin)}
            >
              {renderIcon(props.signalType.iconSecondary || props.signalType.icon)}
            </we-button>
          </Row>
        </Match>

        {/* ── rating ─────────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'rating'}>
          <div class="signal-control__rating">
            {/* Icon row: one icon per integer step between rangeMin and rangeMax */}
            <div class="signal-control__rating-icons">
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
                      {/* Background (empty) icon */}
                      {renderIcon(props.signalType.icon, 'regular')}
                      {/* Foreground (filled) icon, clipped to show only the filled fraction */}
                      <span
                        class="signal-icon-stack__fill"
                        style={{ 'clip-path': `inset(0 ${(1 - fraction()) * 100}% 0 0)` }}
                      >
                        {renderIcon(props.signalType.icon, 'fill')}
                      </span>
                    </span>
                  );
                }}
              </For>
            </div>
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
          </div>
        </Match>

        {/* ── slider ───────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'slider'}>
          <Row class="signal-control__slider" ay="center" gap="300">
            {renderIcon(props.signalType.icon)}
            <we-slider
              min={props.signalType.rangeMin}
              max={props.signalType.rangeMax}
              step={props.signalType.step ?? 1}
              value={value() ?? props.signalType.rangeMin}
              disabled={isDisabled()}
              onChange={(e: Event) => signal((e as CustomEvent<number>).detail)}
            />
            <we-number class="signal-control__count" value={aggregate()} shorten />
          </Row>
        </Match>
      </Switch>
    </div>
  );
}
