import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createEffect, createMemo, createSignal, For, Show, splitProps } from 'solid-js';

import type { ComboboxOption, ComboboxProps as ComboboxOwnProps } from './Combobox.types';

export type { ComboboxOption, ComboboxProps } from './Combobox.types';

const ownKeys = ['options', 'value', 'placeholder', 'size', 'onChange'] as const;

export type ComboboxComponentProps = ComboboxOwnProps & Omit<LayoutProps, 'children' | 'onChange'>;

function normalizeOptions(opts: string[] | ComboboxOption[]): ComboboxOption[] {
  return opts.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));
}

export function Combobox(allProps: ComboboxComponentProps) {
  const [props, layoutProps] = splitProps(allProps, ownKeys);

  const [display, setDisplay] = createSignal(props.value ?? '');
  const [open, setOpen] = createSignal(false);
  const [focused, setFocused] = createSignal(false);

  // Prevents the createEffect from resetting display immediately after handleSelect
  // commits a value — needed because the parent may not have updated props.value yet.
  let skipNextSync = false;
  // Prevents handleBlur from re-committing or reverting after handleSelect already ran.
  let selectionHandled = false;

  let inputRef: HTMLElement | undefined;

  // Sync display to external value when not actively editing
  createEffect(() => {
    if (!focused()) {
      if (skipNextSync) { skipNextSync = false; return; }
      setDisplay(props.value ?? '');
    }
  });

  const containerStyle = createMemo(() =>
    buildLayoutStyles(
      { ...layoutProps, position: 'relative', display: layoutProps.display ?? 'block' } as LayoutProps,
      'column',
    ),
  );

  const normalized = createMemo(() => normalizeOptions(props.options ?? []));

  const filtered = createMemo(() => {
    const q = display().toLowerCase();
    if (!focused() || !q) return normalized();
    return normalized().filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  });

  const handleFocus = () => {
    setFocused(true);
    setDisplay('');
    setOpen(true);
  };

  const handleInput = (e: CustomEvent<string>) => {
    const v = e.detail;
    setDisplay(v);
    setOpen(true);
    const match = normalized().find((o) => o.value === v || o.label === v);
    if (match && match.value !== (props.value ?? '')) {
      props.onChange?.(match.value);
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (selectionHandled) { selectionHandled = false; return; }
      const v = display();
      setFocused(false);
      setOpen(false);
      if (v && v !== (props.value ?? '')) {
        props.onChange?.(v);
      } else {
        setDisplay(props.value ?? '');
      }
    }, 150);
  };

  const handleKeyDown = (e: CustomEvent<{ key: string }>) => {
    if (e.detail.key === 'Escape') {
      setDisplay(props.value ?? '');
      setOpen(false);
    }
    if (e.detail.key === 'Enter') {
      const v = display();
      setOpen(false);
      if (v && v !== (props.value ?? '')) props.onChange?.(v);
    }
  };

  const handleSelect = (value: string) => {
    selectionHandled = true;
    skipNextSync = true;
    setDisplay(value);
    setFocused(false);
    setOpen(false);
    if (value !== (props.value ?? '')) props.onChange?.(value);
  };

  const handleCaretClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (open()) {
      setOpen(false);
      setFocused(false);
      setDisplay(props.value ?? '');
      (inputRef as HTMLElement & { blur?: () => void })?.blur?.();
    } else {
      setFocused(true);
      setDisplay('');
      setOpen(true);
      (inputRef as HTMLElement & { focus?: () => void })?.focus?.();
    }
  };

  return (
    <div style={containerStyle()}>
      <we-input
        ref={inputRef}
        style={{ width: '100%' }}
        value={display()}
        placeholder={focused() ? (props.value ?? '') : (props.placeholder ?? '')}
        size={props.size ?? 'sm'}
        on:focus={handleFocus}
        on:input={handleInput}
        on:blur={handleBlur}
        on:keydown={handleKeyDown}
      >
        <div
          slot="end"
          style={{ cursor: 'pointer', display: 'flex', 'align-items': 'center' }}
          onClick={handleCaretClick}
        >
          <we-icon name={open() ? 'caret-up' : 'caret-down'} size="xs" color="neutral-400" />
        </div>
      </we-input>

      <Show when={open() && filtered().length > 0}>
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            'min-width': '100%',
            'margin-top': '4px',
            'z-index': '500',
            'box-sizing': 'border-box',
          }}
        >
          <we-menu>
            <div style={{ 'max-height': '240px', 'overflow-y': 'auto', padding: '4px 0' }}>
              <For each={filtered()}>
                {(opt) => (
                  <we-menu-item
                    value={opt.value}
                    selected={opt.value === (props.value ?? '')}
                    on:select={() => handleSelect(opt.value)}
                  >
                    <we-text>{opt.label}</we-text>
                  </we-menu-item>
                )}
              </For>
            </div>
          </we-menu>
        </div>
      </Show>
    </div>
  );
}
