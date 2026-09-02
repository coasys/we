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
        {/*
          The two halves of this control are deliberately different materials: the label is
          `surface` and the field beside it is `surface-sunken`.

          The label is a *cap* — it names what the field is and cannot be typed into, so it sits at
          card level. The field is a trough. It was `neutral-100` against the field's `neutral-0`,
          and the gap between those two steps is exactly this distinction, which is the thing a
          scale position could not name and a role can. The role migration read both as the trough,
          which flattened the sort and order controls into one dark slab.
        */}
        <Row slot="trigger" gap="0" ay="stretch">
          <Show when={props.label}>
            <we-text
              variant="label"
              color="text-muted"
              bg="surface"
              border="1px solid var(--we-role-border)"
              borderRight="none"
              rl="control"
              px={TRIGGER_PADDING_X[size()]}
              styles={{ display: 'flex', 'align-items': 'center', 'white-space': 'nowrap' }}
            >
              {props.label}
            </we-text>
          </Show>
          <we-button
            variant="outline"
            bg="surface-sunken"
            size={size()}
            px={TRIGGER_PADDING_X[size()]}
            gap={TRIGGER_GAP[size()]}
            // Square the side that meets the label; the right corners are left unsaid and keep
            // reading the button's own cascade. That used to require restating button's four-deep
            // chain here, because naming one corner sent the other three to a hardcoded 0 — fixed
            // at the source in `getRadiusValues`, so the workaround is gone.
            rl={props.label ? '0' : undefined}
            borderLeft={props.label ? 'none' : undefined}
          >
            <Show when={selectedOption()?.icon}>
              <we-icon name={selectedOption()!.icon!} />
            </Show>
            <we-text>{selectedOption()?.label ?? props.placeholder ?? 'Select…'}</we-text>
            <we-icon name="caret-down" color="text-muted" size="xs" />
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
                <we-text variant="footnote" color="text-faint" px="300" py="200">
                  No results
                </we-text>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <>
                    <Show when={group.label !== null}>
                      <we-menu-item cursor="default" pointerEvents="none" color="text-faint" fontSize="100">
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
                            <we-icon slot="end" name="check" size="xs" weight="bold" color="accent" />
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
