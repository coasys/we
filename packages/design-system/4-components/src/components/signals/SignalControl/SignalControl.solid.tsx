export type * from './SignalControl.types';

import type { JSX } from 'solid-js';
import { For, Match, Switch } from 'solid-js';

import { Row } from '../../../frameworks/solid';
import type { SignalControlProps } from './SignalControl.types';

/** Renders an emoji inline or a design-system icon by name */
function renderIcon(icon: string): JSX.Element {
  return /^[a-z0-9-]+$/i.test(icon) ? (
    ((<we-icon name={icon} />) as JSX.Element)
  ) : (
    <span class="signal-icon-emoji">{icon}</span>
  );
}

export function SignalControl(props: SignalControlProps) {
  return (
    <div class={`signal-control ${props.class || ''}`} style={props.styles}>
      <Switch>
        {/* Toggle */}
        <Match when={props.signalType.mode === 'toggle'}>
          <Row class="signal-control__toggle" ay="center" gap="300">
            <we-button
              class={props.myValue ? 'is-active' : ''}
              variant="ghost"
              disabled={props.disabled}
              onClick={() => props.onSignal(props.myValue ? 0 : props.signalType.rangeMax)}
            >
              {renderIcon(props.signalType.icon)}
            </we-button>
            <we-text class="signal-control__count">{props.aggregate}</we-text>
          </Row>
        </Match>

        {/* Vote */}
        <Match when={props.signalType.mode === 'vote'}>
          <Row class="signal-control__vote" ay="center" gap="300">
            <we-button
              class={props.myValue !== null && props.myValue > 0 ? 'is-active' : ''}
              variant="ghost"
              disabled={props.disabled}
              onClick={() =>
                props.onSignal(props.myValue !== null && props.myValue > 0 ? 0 : props.signalType.rangeMax)
              }
            >
              {renderIcon(props.signalType.icon)}
            </we-button>
            <we-text class="signal-control__count">{props.aggregate}</we-text>
            <we-button
              class={props.myValue !== null && props.myValue < 0 ? 'is-active' : ''}
              variant="ghost"
              disabled={props.disabled}
              onClick={() =>
                props.onSignal(props.myValue !== null && props.myValue < 0 ? 0 : props.signalType.rangeMin)
              }
            >
              {renderIcon(props.signalType.iconSecondary || props.signalType.icon)}
            </we-button>
          </Row>
        </Match>

        {/* ── rating ─────────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'rating'}>
          <Row class="signal-control__rating" ay="center" gap="300">
            <For
              each={Array.from(
                {
                  length: Math.round(
                    (props.signalType.rangeMax - props.signalType.rangeMin) / (props.signalType.step ?? 1),
                  ),
                },
                (_, i) => props.signalType.rangeMin + (i + 1) * (props.signalType.step ?? 1),
              )}
            >
              {(val) => (
                <we-button
                  class={props.myValue !== null && props.myValue >= val ? 'is-active' : ''}
                  variant="ghost"
                  disabled={props.disabled}
                  onClick={() => props.onSignal(val)}
                >
                  {renderIcon(props.signalType.icon)}
                </we-button>
              )}
            </For>
            <we-text class="signal-control__count">{props.aggregate}</we-text>
          </Row>
        </Match>

        {/* ── slider ───────────────────────────────────────────────────────── */}
        <Match when={props.signalType.mode === 'slider'}>
          <Row class="signal-control__slider" ay="center" gap="300">
            {renderIcon(props.signalType.icon)}
            <we-slider
              min={props.signalType.rangeMin}
              max={props.signalType.rangeMax}
              step={props.signalType.step ?? 1}
              value={props.myValue ?? props.signalType.rangeMin}
              disabled={props.disabled}
              onChange={(e: Event) => props.onSignal((e as CustomEvent<number>).detail)}
            />
            <we-text class="signal-control__count">{props.aggregate}</we-text>
          </Row>
        </Match>
      </Switch>
    </div>
  );
}
