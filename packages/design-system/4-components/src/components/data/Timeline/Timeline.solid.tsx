import { For, Show } from 'solid-js';

export type * from './Timeline.types';
import type { JSX } from 'solid-js';

import type { TimelineItem, TimelineProps } from './Timeline.types';

interface SolidTimelineProps extends TimelineProps {
  children?: JSX.Element;
  renderItem?: (item: TimelineItem, index: number) => JSX.Element;
}

export function Timeline(props: SolidTimelineProps) {
  const items = () => props.items || [];

  return (
    <div class="we-timeline" role="list" style={props.styles}>
      <For each={items()}>
        {(item, i) => (
          <div class="we-timeline__item" role="listitem">
            <div class="we-timeline__indicator">
              <div class={`we-timeline__dot${item.icon ? ' we-timeline__dot--icon' : ''}`}>
                {item.icon && <we-icon name={item.icon} size="14px" />}
              </div>
              {i() < items().length - 1 && <div class="we-timeline__line" />}
            </div>
            <div class="we-timeline__content">
              {props.renderItem ? (
                props.renderItem(item, i())
              ) : (
                <>
                  <span class="we-timeline__label">{item.label}</span>
                  <Show when={item.description}>
                    <span class="we-timeline__description">{item.description}</span>
                  </Show>
                  <Show when={item.timestamp}>
                    <span class="we-timeline__timestamp">{item.timestamp}</span>
                  </Show>
                </>
              )}
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
