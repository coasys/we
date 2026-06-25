import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show, splitProps } from 'solid-js';

import { Column } from '../../layout/Column/Column.solid';
import { Row } from '../../layout/Row/Row.solid';
import { SearchInput } from '../SearchInput/SearchInput.solid';

export type GroupedSelectOption = {
  label: string;
  value: string;
  icon?: string;
  group?: string;
};

type OwnProps = {
  options: GroupedSelectOption[];
  value?: string;
  placeholder?: string;
  searchable?: boolean;
  onChange?: (value: string) => void;
};

const ownKeys = ['options', 'value', 'placeholder', 'searchable', 'onChange'] as const;

export type GroupedSelectProps = OwnProps & Omit<LayoutProps, 'children'>;

export function GroupedSelect(allProps: GroupedSelectProps) {
  const [props, layoutProps] = splitProps(allProps, ownKeys);

  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal('');
  let containerRef: HTMLDivElement | undefined;

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles(
      { ...layoutProps, position: 'relative', display: layoutProps.display ?? 'inline-block' } as LayoutProps,
      'column',
    ),
  );

  const selectedOption = createMemo(() => props.options.find((o) => o.value === props.value));

  const groups = createMemo(() => {
    const q = search().toLowerCase();
    const filtered = q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options;

    const groupMap = new Map<string, GroupedSelectOption[]>();
    const ungrouped: GroupedSelectOption[] = [];

    for (const opt of filtered) {
      if (opt.group) {
        if (!groupMap.has(opt.group)) groupMap.set(opt.group, []);
        groupMap.get(opt.group)!.push(opt);
      } else {
        ungrouped.push(opt);
      }
    }

    const result: { label: string | null; items: GroupedSelectOption[] }[] = [];
    if (ungrouped.length) result.push({ label: null, items: ungrouped });
    for (const [label, items] of groupMap) result.push({ label, items });
    return result;
  });

  const hasResults = createMemo(() => groups().some((g) => g.items.length > 0));

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  createEffect(() => {
    if (!open()) return;
    const onOutside = (e: MouseEvent) => {
      if (!containerRef?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onOutside);
    onCleanup(() => document.removeEventListener('mousedown', onOutside));
  });

  const handleSelect = (opt: GroupedSelectOption) => {
    props.onChange?.(opt.value);
    close();
  };

  return (
    <div ref={containerRef} style={wrapperStyle()}>
      {/* Trigger */}
      <we-button variant="outline" bg="neutral-0" px="300" onClick={() => setOpen((o) => !o)}>
        <Show when={selectedOption()?.icon}>
          <we-icon name={selectedOption()!.icon!} />
        </Show>
        <we-text>{selectedOption()?.label ?? props.placeholder ?? 'Select…'}</we-text>
        <we-icon name={open() ? 'caret-up' : 'caret-down'} color="neutral-500" size="xs" />
      </we-button>

      {/* Dropdown */}
      <Show when={open()}>
        <Column
          position="absolute"
          top="100%"
          left="0"
          mt="300"
          bg="neutral-0"
          border="1px solid neutral-300"
          r="400"
          shadow="md"
          minWidth="220px"
          zIndex="dropdown"
        >
          <Show when={props.searchable !== false}>
            <SearchInput value={search()} placeholder="Search…" m="200" onSearch={setSearch} />
            <we-divider />
          </Show>
          <Column py="200" maxHeight="280px" overflowY="auto">
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
                  <Column>
                    <Show when={group.label !== null}>
                      <we-text variant="footnote" color="neutral-400" px="300" pt="300" pb="100">
                        {group.label}
                      </we-text>
                    </Show>
                    <For each={group.items}>
                      {(opt) => (
                        <Row
                          ay="center"
                          gap="300"
                          px="300"
                          py="200"
                          cursor="pointer"
                          bg={opt.value === props.value ? 'primary-100' : 'neutral-0'}
                          color="neutral-600"
                          hoverProps={{ bg: 'neutral-100', color: 'neutral-900' }}
                          onClick={() => handleSelect(opt)}
                        >
                          <Show when={opt.icon}>
                            <we-icon name={opt.icon!} size="sm" />
                          </Show>
                          <we-text>{opt.label}</we-text>
                        </Row>
                      )}
                    </For>
                  </Column>
                )}
              </For>
            </Show>
          </Column>
        </Column>
      </Show>
    </div>
  );
}
