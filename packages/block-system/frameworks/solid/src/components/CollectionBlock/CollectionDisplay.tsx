import type { SerializedBlockNode } from '@we/block-shared';
import { For } from 'solid-js';

import { BlockRenderer } from '../BlockRenderer';

interface CollectionDisplayProps {
  layout?: string;
  columnCount?: number;
  gap?: string;
  childEditorStates?: SerializedBlockNode[];
}

function containerStyle(layout?: string, columnCount?: number, gap?: string): Record<string, string> {
  const g = gap ? `var(--we-spacing-${gap}, 1rem)` : '1rem';
  if (layout === 'grid') {
    return {
      display: 'grid',
      'grid-template-columns': `repeat(${columnCount ?? 2}, 1fr)`,
      gap: g,
    };
  }
  if (layout === 'rows') {
    return { display: 'flex', 'flex-direction': 'column', gap: g };
  }
  // 'columns' (default)
  return {
    display: 'flex',
    'flex-direction': 'row',
    gap: g,
    'align-items': 'flex-start',
  };
}

export function CollectionDisplay(props: CollectionDisplayProps) {
  const states = () => props.childEditorStates ?? [];

  return (
    <div style={containerStyle(props.layout, props.columnCount, props.gap)} class="we-collection-block">
      <For each={states()}>
        {(state) => (
          <div style={{ flex: '1', 'min-width': '0' }}>
            <BlockRenderer editorState={state} />
          </div>
        )}
      </For>
    </div>
  );
}
