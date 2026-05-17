export type * from './SearchInput.types';

import { createSignal, onCleanup } from 'solid-js';

import type { SearchInputProps } from './SearchInput.types';

export function SearchInput(props: SearchInputProps) {
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
    <we-input
      class={props.class}
      style={props.styles}
      value={localValue()}
      placeholder={props.placeholder ?? 'Search…'}
      on:input={handleInput}
    >
      <we-icon slot="start" name="magnifying-glass" mr="300" />
    </we-input>
  );
}
