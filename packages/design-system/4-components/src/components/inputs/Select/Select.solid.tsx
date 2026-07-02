import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createMemo, createSignal, For, Show, splitProps } from 'solid-js';

import { Search } from '../Search/Search.solid';

export type SelectOption = {
  label: string;
  value: string;
  icon?: string;
  group?: string;
};

type OwnProps = {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  searchable?: boolean;
  onChange?: (value: string) => void;
};

const ownKeys = ['options', 'value', 'placeholder', 'searchable', 'onChange'] as const;

export type SelectProps = OwnProps & Omit<LayoutProps, 'children' | 'onChange'>;

export function Select(allProps: SelectProps) {
  const [props, layoutProps] = splitProps(allProps, ownKeys);
  let popoverRef: (HTMLElement & Record<string, unknown>) | undefined;

  const [search, setSearch] = createSignal('');

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles({ ...layoutProps, display: layoutProps.display ?? 'inline-block' } as LayoutProps, 'column'),
  );

  const selectedOption = createMemo(() => props.options.find((o) => o.value === props.value));

  const groups = createMemo(() => {
    const q = search().toLowerCase();
    const filtered = q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options;

    const groupMap = new Map<string, SelectOption[]>();
    const ungrouped: SelectOption[] = [];

    for (const opt of filtered) {
      if (opt.group) {
        if (!groupMap.has(opt.group)) groupMap.set(opt.group, []);
        groupMap.get(opt.group)!.push(opt);
      } else {
        ungrouped.push(opt);
      }
    }

    const result: { label: string | null; items: SelectOption[] }[] = [];
    if (ungrouped.length) result.push({ label: null, items: ungrouped });
    for (const [label, items] of groupMap) result.push({ label, items });
    return result;
  });

  const hasResults = createMemo(() => groups().some((g) => g.items.length > 0));

  const closeMenu = () => {
    if (popoverRef) (popoverRef as unknown as { open: boolean }).open = false;
    setSearch('');
  };

  const handleSelect = (opt: SelectOption) => {
    props.onChange?.(opt.value);
    closeMenu();
  };

  return (
    <div style={wrapperStyle()}>
      <we-popover ref={popoverRef} placement="bottom-start">
        <we-button slot="trigger" variant="outline" bg="neutral-0" px="300">
          <Show when={selectedOption()?.icon}>
            <we-icon name={selectedOption()!.icon!} />
          </Show>
          <we-text>{selectedOption()?.label ?? props.placeholder ?? 'Select…'}</we-text>
          <we-icon name="caret-down" color="neutral-500" size="xs" />
        </we-button>

        <we-menu slot="content" p="0">
          <Show when={props.searchable !== false}>
            <Search value={search()} placeholder="Search…" m="200" onSearch={setSearch} />
            <we-divider />
          </Show>

          {/* Items are scrollable; search header stays pinned above */}
          <div style={{ 'max-height': '280px', 'overflow-y': 'auto', padding: '4px 0' }}>
            <Show
              when={hasResults()}
              fallback={
                <we-text variant="footnote" color="neutral-400" px="300" py="200">
                  No results
                </we-text>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <>
                    <Show when={group.label !== null}>
                      <we-menu-item cursor="default" pointerEvents="none" color="neutral-400" fontSize="100">
                        <we-text>{group.label}</we-text>
                      </we-menu-item>
                    </Show>
                    <For each={group.items}>
                      {(opt) => (
                        <we-menu-item
                          value={opt.value}
                          selected={opt.value === props.value}
                          on:select={() => handleSelect(opt)}
                        >
                          <Show when={opt.icon}>
                            <we-icon name={opt.icon!} size="sm" />
                          </Show>
                          <we-text>{opt.label}</we-text>
                          <Show when={opt.value === props.value}>
                            <we-icon slot="end" name="check" size="xs" weight="bold" color="primary-500" />
                          </Show>
                        </we-menu-item>
                      )}
                    </For>
                  </>
                )}
              </For>
            </Show>
          </div>
        </we-menu>
      </we-popover>
    </div>
  );
}
