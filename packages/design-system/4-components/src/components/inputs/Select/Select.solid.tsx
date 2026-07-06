import type { LayoutProps } from '@we/design-utils/solid';
import { buildLayoutStyles } from '@we/design-utils/solid';
import { createMemo, createSignal, For, Show, splitProps } from 'solid-js';

import { Row } from '../../layout/Row/Row.solid';
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
  /** Optional label rendered as a fused segment to the left of the trigger, describing what this Select filters. */
  label?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  onChange?: (value: string) => void;
};

const ownKeys = ['options', 'value', 'placeholder', 'searchable', 'label', 'size', 'onChange'] as const;

// Select renders a denser control than a raw we-button at the same size — one spacing step
// down from we-button's own per-size --we-button-size-padding-x/--we-button-size-gap defaults
// (button.ts). Applied explicitly to both the label segment (which can't inherit those host-scoped
// CSS vars) and the trigger button itself, so the two stay padding-matched at the fused seam.
const TRIGGER_PADDING_X: Record<NonNullable<OwnProps['size']>, string> = {
  xs: '100',
  sm: '200',
  md: '300',
  lg: '400',
  xl: '400',
};

const TRIGGER_GAP: Record<NonNullable<OwnProps['size']>, string> = {
  xs: '0',
  sm: '100',
  md: '200',
  lg: '200',
  xl: '200',
};

export type SelectProps = OwnProps & Omit<LayoutProps, 'children' | 'onChange'>;

/** @superclass DesignSystemElement */
export function Select(allProps: SelectProps) {
  const [props, layoutProps] = splitProps(allProps, ownKeys);
  let popoverRef: (HTMLElement & Record<string, unknown>) | undefined;

  const [search, setSearch] = createSignal('');

  const wrapperStyle = createMemo(() =>
    buildLayoutStyles({ ...layoutProps, display: layoutProps.display ?? 'inline-block' } as LayoutProps, 'column'),
  );

  const size = createMemo(() => props.size ?? 'md');

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
        <Row slot="trigger" gap="0" ay="stretch">
          <Show when={props.label}>
            <we-text
              variant="label"
              color="neutral-600"
              bg="neutral-100"
              border="1px solid var(--we-color-neutral-300)"
              borderRight="none"
              rl="var(--we-theme-control-radius, var(--we-radius-400))"
              px={TRIGGER_PADDING_X[size()]}
              styles={{ display: 'flex', 'align-items': 'center', 'white-space': 'nowrap' }}
            >
              {props.label}
            </we-text>
          </Show>
          <we-button
            variant="outline"
            bg="neutral-0"
            size={size()}
            px={TRIGGER_PADDING_X[size()]}
            gap={TRIGGER_GAP[size()]}
            rl={props.label ? '0' : undefined}
            // Explicit rl forces the DS runtime to compute all 4 corners as one instance
            // override — the other corners would otherwise silently drop to a hardcoded 0
            // instead of the theme cascade. Re-declare rr with button's own default chain
            // so the right corners stay theme-responsive.
            rr={
              props.label
                ? 'var(--we-theme-button-radius, var(--we-theme-control-radius, var(--we-button-size-radius, var(--we-radius-400))))'
                : undefined
            }
            borderLeft={props.label ? 'none' : undefined}
          >
            <Show when={selectedOption()?.icon}>
              <we-icon name={selectedOption()!.icon!} />
            </Show>
            <we-text>{selectedOption()?.label ?? props.placeholder ?? 'Select…'}</we-text>
            <we-icon name="caret-down" color="neutral-500" size="xs" />
          </we-button>
        </Row>

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
