import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createEffect, createMemo, createSignal, onCleanup, splitProps } from 'solid-js';

import type { SearchProps as SearchOwnProps } from './Search.types';

export type { SearchProps } from './Search.types';

// Container props (sizing, margin, position) apply to the wrapper div.
// Everything else (visual, typography, state) is forwarded to we-input.
const containerKeys = [
  'display',
  'flex',
  'alignSelf',
  'width',
  'minWidth',
  'maxWidth',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'overflow',
  'overflowX',
  'overflowY',
  'scrollbarWidth',
  'scrollbarGutter',
] as const;

const ownKeys = ['placeholder', 'value', 'onSearch', 'debounce', 'class'] as const;

export type SearchComponentProps = Omit<LayoutProps, 'children'> & Omit<SearchOwnProps, 'styles'>;

/** @superclass DesignSystemElement */
export function Search(allProps: SearchComponentProps) {
  const [props, rest] = splitProps(allProps, ownKeys);
  const [containerProps, inputProps] = splitProps(rest, containerKeys);

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles({ ...containerProps, display: containerProps.display ?? 'block' } as LayoutProps, 'column'),
  );

  const [localValue, setLocalValue] = createSignal(props.value ?? '');
  let debounceId: ReturnType<typeof setTimeout> | undefined;
  let inputRef: (HTMLElement & Record<string, unknown>) | undefined;

  onCleanup(() => {
    if (debounceId !== undefined) clearTimeout(debounceId);
  });

  createEffect(() => {
    if (!inputRef) return;
    for (const key of Object.keys(inputProps as object)) {
      const val = (inputProps as Record<string, unknown>)[key];
      if (val !== undefined) inputRef[key] = val;
    }
  });

  function handleInput(e: CustomEvent<string>) {
    const val = e.detail;
    setLocalValue(val);
    if (debounceId !== undefined) clearTimeout(debounceId);
    debounceId = setTimeout(() => {
      props.onSearch?.(val);
    }, props.debounce ?? 300);
  }

  return (
    <div style={wrapperStyle()}>
      <we-input
        ref={inputRef}
        class={props.class}
        style={{ width: '100%' }}
        value={localValue()}
        placeholder={props.placeholder ?? 'Search…'}
        on:input={handleInput}
      >
        <we-icon slot="start" name="magnifying-glass" mr="300" />
      </we-input>
    </div>
  );
}
