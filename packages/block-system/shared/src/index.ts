export type {
  BlockComposerProps,
  BlockDataset,
  BlockDragSource,
  BlockRendererProps,
  EditorStateInput,
  MentionCandidate,
} from './types';
export type {
  BlockStyle,
  CollectionContentBlock,
  ContentBlock,
  ContentDocument,
  CustomContentBlock,
  ListItemKind,
  PortableTextMarkDef,
  PortableTextSpan,
  TextContentBlock,
} from './content';
export {
  collectKeys,
  contentToLine,
  contentHash,
  emptyContent,
  fromPortableText,
  isCollectionBlock,
  isContentBlockArray,
  isContentDocument,
  isTextBlock,
  mapBlocks,
  plainText,
  spansFromStandoff,
  standoffFromSpans,
  toPortableText,
  walkBlocks,
} from './content';
export { type BlockNode, type FlatBlock, flattenBlocks } from './kernels/flattenBlocks';
export type { Decorator, LinkMark, MentionMark, NodeLinkMark, StandoffMark } from './marks';
export {
  cpLength,
  cpSlice,
  cpToUtf16,
  DECORATORS,
  isDecorator,
  marksField,
  marksOf,
  mentionChanges,
  mentionedDids,
  normalizeMarks,
  rebaseMarks,
  shiftMarks,
  utf16ToCp,
} from './marks';
export type { FoundUrl } from './links';
export { findUrls, isUrl, withFoundLinks } from './links';
export { markdownToBlocks } from './markdown';
export type { BlockEntityStatic, BlockRegistration } from './registry';
export {
  getBlockRecord,
  getBlockRegistration,
  getRegisteredBlockEntities,
  registerBlock,
  unregisterBlock,
  updateBlockRegistration,
} from './registry';
export { registerCoreBlocks } from './core-blocks';
export type { CollectionMode } from './modes';
export { isCollectionMode, isReconcilable } from './modes';
export type { BlockAnchor, ContentInput, PlanPostOptions, WritePostOptions } from './serialization';
export {
  childrenToBlocks,
  copyableContent,
  createBlock,
  deleteBlocks,
  encodeEditorState,
  extractBlockData,
  extractMentions,
  extractTextContent,
  loadBlocks,
  planPost,
  reconcileBlocks,
  refreshComposition,
  recordToTextBlock,
  rowsToBlocks,
  resolveExpressionAddresses,
  textBlockToRecord,
  writePost,
} from './serialization';
export { contentFromValue, decodeEditorState, encodeBase64Utf8 } from './utils';

// Back-compat: consumers importing blocks from @we/block-shared still work
export { CollectionBlock, ImageBlock, TextBlock } from '@we/entities';
