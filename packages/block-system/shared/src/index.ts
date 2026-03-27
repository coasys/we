export type { BlockComposerProps, SerializedBlockNode } from './types';
export { createBlocks, resolveBlockType } from './serialization';

// Back-compat: consumers importing blocks from @we/block-shared still work
export { CollectionBlock, ImageBlock, TextBlock } from '@we/models';
