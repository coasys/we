import type { SerializedBlockNode } from '@we/block-shared';

import { BlockRenderer } from '../BlockRenderer';

interface CollectionDisplayProps {
  layout?: string;
  columnCount?: number;
  gap?: string;
  childEditorState?: SerializedBlockNode;
}

/** Returns the Lexical root class that applies the grid layout. */
function layoutRootClass(layout?: string): string {
  if (layout === 'columns' || layout === 'grid') return 'we-collection-layout';
  return ''; // 'rows' — default stacking, no grid needed
}

export function CollectionDisplay(props: CollectionDisplayProps) {
  const colCount = props.columnCount ?? 2;
  const rootClass = layoutRootClass(props.layout);

  return (
    <div
      // CSS custom properties cascade into the Lexical editor root so that
      // we-collection-layout can reference --we-cols / --we-gap.
      style={{
        '--we-cols': String(colCount),
        '--we-gap': props.gap ? `var(--we-spacing-${props.gap}, 1rem)` : '1rem',
      }}
      class="we-collection-block"
    >
      <BlockRenderer editorState={props.childEditorState} rootClass={rootClass} />
    </div>
  );
}
