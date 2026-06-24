import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createEffect, createMemo, createSignal, onCleanup, splitProps } from 'solid-js';

import type { SearchInputProps as SearchInputOwnProps } from './SearchInput.types';

// Extends the base props with full Design System support.
// Container props (sizing, margin, position, flex-item) apply to the wrapper div;
// all other DS props (bg, color, r, border, typography, state, etc.) are forwarded
// to the inner we-input as DOM properties so they override its built-in DS defaults.
export type SearchInputProps = Omit<LayoutProps, 'children'> & Omit<SearchInputOwnProps, 'styles'>;

const ownKeys = ['placeholder', 'value', 'onSearch', 'debounce', 'class'] as const;

// Props that control how the component slots into its parent layout — stay on the wrapper div.
// Everything else (visual, typography, state, padding, height) is forwarded to we-input.
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

export function SearchInput(allProps: SearchInputProps) {
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

  // Set visual DS props directly on we-input as DOM properties so they override its defaults.
  // we-input's DesignSystemMixin registers all DS keys as reactive Lit properties, so property
  // assignment triggers its updated() cycle and applies the new CSS custom vars.
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
