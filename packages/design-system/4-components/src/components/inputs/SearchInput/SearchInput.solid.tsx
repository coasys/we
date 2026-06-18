import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createMemo, createSignal, onCleanup, splitProps } from 'solid-js';

import type { SearchInputProps as SearchInputOwnProps } from './SearchInput.types';

// Extends the base props with full Design System layout support.
// All layout/visual/flex/typography/styles props apply to the wrapper div;
// component-specific props route to the inner we-input.
export type SearchInputProps = Omit<LayoutProps, 'children'> & Omit<SearchInputOwnProps, 'styles'>;

const ownKeys = ['placeholder', 'value', 'onSearch', 'debounce', 'class'] as const;

export function SearchInput(allProps: SearchInputProps) {
  const [props, layoutProps] = splitProps(allProps, ownKeys);

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles({ ...layoutProps, display: layoutProps.display ?? 'block' } as LayoutProps, 'column'),
  );

  const [localValue, setLocalValue] = createSignal(props.value ?? '');
  let debounceId: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (debounceId !== undefined) clearTimeout(debounceId);
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
