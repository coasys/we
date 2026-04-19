export type { BlockComposerProps, SerializedBlockNode } from './types';
export type { BlockRegistration } from './registry';
export { registerBlock, getBlockRegistration, getBlockModel, updateBlockRegistration } from './registry';
export { registerCoreBlocks } from './core-blocks';
export { createBlocks, loadBlocks, blocksToLexicalJSON } from './serialization';

// Back-compat: consumers importing blocks from @we/block-shared still work
export { CollectionBlock, ImageBlock, TextBlock } from '@we/models';
