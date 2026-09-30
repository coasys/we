import type { ContentBlock } from '@we/block-shared';

import { Blocks } from '../BlockRenderer';

interface CollectionDisplayProps {
  layout?: string;
  columnCount?: number;
  gap?: string;
  content?: ContentBlock[];
}

/**
 * A nested composition, read-only. The wrapper's classes and custom properties match the
 * collection node's `toDOM` in the editor schema, so one stylesheet lays out both.
 */
export function CollectionDisplay(props: CollectionDisplayProps) {
  const colCount = () => props.columnCount ?? 2;
  const layout = () => props.layout ?? 'grid';

  return (
    <div
      class="we-block we-collection-block"
      data-block-type="collection"
      data-layout={layout()}
      style={{
        '--we-cols': String(colCount()),
        '--we-gap': props.gap ? `var(--we-space-${props.gap}, 1rem)` : '1rem',
      }}
    >
      <div class="we-collection-content we-block-content">
        <Blocks blocks={props.content ?? []} />
      </div>
    </div>
  );
}
