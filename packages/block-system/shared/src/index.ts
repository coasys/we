export type { BlockComposerProps, BlockDataset, BlockRendererProps, SerializedBlockNode } from './types';
export type { BlockRegistration } from './registry';
export { registerBlock, getBlockRegistration, getBlockModel, updateBlockRegistration } from './registry';
export { registerCoreBlocks } from './core-blocks';
export type { CollectionMode } from './modes';
export { isCollectionMode, isReconcilable } from './modes';
export type { BlockAnchor, CreateBlocksOptions } from './serialization';
export { createBlocks, loadBlocks, deleteBlocks, reconcileBlocks, resolveExpressionAddresses } from './serialization';
export { decodeEditorState } from './utils';

// Back-compat: consumers importing blocks from @we/block-shared still work
export { CollectionBlock, ImageBlock, TextBlock } from '@we/models';
