import type { SerializedBlockNode } from '@we/block-shared';

import { BlockRenderer } from '../BlockRenderer';

interface CollectionDisplayProps {
  layout?: string;
  columnCount?: number;
  gap?: string;
  childEditorState?: SerializedBlockNode;
}

export function CollectionDisplay(props: CollectionDisplayProps) {
  const colCount = () => props.columnCount ?? 2;
  const layout = () => props.layout ?? 'grid';

  return (
    <div
      class="we-collection-block"
      data-layout={layout()}
      style={{
        '--we-cols': String(colCount()),
        '--we-gap': props.gap ? `var(--we-spacing-${props.gap}, 1rem)` : '1rem',
      }}
    >
      <BlockRenderer editorState={props.childEditorState} />
    </div>
  );
}
