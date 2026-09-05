import { For, Show } from 'solid-js';

import { BlockToolbar } from '../BlockToolbar';

interface CollectionInputProps {
  layout?: string;
  columnCount?: number;
  gap?: string;
  /** Used by the settings toolbar to update layout and columnCount on the node. */
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

const LAYOUT_OPTIONS = [
  { value: 'grid', icon: 'squares-four', title: 'Grid' },
  { value: 'row', icon: 'columns-plus-right', title: 'Row' },
  { value: 'column', icon: 'rows-plus-bottom', title: 'Column' },
] as const;

const COL_COUNTS = [2, 3, 4] as const;

/**
 * The layout toolbar of a collection block. The nested content is edited in place by the
 * composer's own document — a collection is a node with children, not a second editor — so this
 * component only owns the controls that float above it while it is selected.
 */
export function CollectionInput(props: CollectionInputProps) {
  const layout = () => props.layout ?? 'grid';
  const colCount = () => props.columnCount ?? 2;
  const hasColumns = () => layout() === 'grid';

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <Show when={props.isSelected()}>
      <BlockToolbar placement="above">
        <For each={LAYOUT_OPTIONS}>
          {(opt) => (
            <we-button
              square
              variant={layout() === opt.value ? 'secondary' : 'ghost'}
              title={opt.title}
              onClick={(e: MouseEvent) => {
                stop(e);
                props.onChange('layout', opt.value);
              }}
            >
              <we-icon name={opt.icon} size="xs" />
            </we-button>
          )}
        </For>

        <Show when={hasColumns()}>
          <we-divider orientation="vertical" my="300" mx="100" color="text-faint" />
          <For each={COL_COUNTS}>
            {(n) => (
              <we-button
                square
                variant={colCount() === n ? 'secondary' : 'ghost'}
                onClick={(e: MouseEvent) => {
                  stop(e);
                  props.onChange('columnCount', n);
                }}
              >
                {n}
              </we-button>
            )}
          </For>
        </Show>
      </BlockToolbar>
    </Show>
  );
}
