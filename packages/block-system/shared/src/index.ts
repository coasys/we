export type {
  BlockComposerProps,
  BlockDataset,
  BlockRendererProps,
  EditorStateInput,
  MentionCandidate,
  SerializedBlockNode,
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
export type { Decorator, LinkMark, MentionMark, NodeLinkMark, StandoffMark } from './marks';
export {
  cpLength,
  cpSlice,
  cpToUtf16,
  DECORATORS,
  isDecorator,
  mentionedDids,
  normalizeMarks,
  parseMarks,
  serializeMarks,
  shiftMarks,
  utf16ToCp,
} from './marks';
export { isLegacyLexicalRoot, lexicalRootToContent } from './legacyLexical';
export type { BlockRegistration } from './registry';
export {
  getBlockModel,
  getBlockRegistration,
  getRegisteredBlockModels,
  registerBlock,
  updateBlockRegistration,
} from './registry';
export { registerCoreBlocks } from './core-blocks';
export type { CollectionMode } from './modes';
export { isCollectionMode, isReconcilable } from './modes';
export type { BlockAnchor, ContentInput, CreateBlocksOptions } from './serialization';
export {
  childrenToBlocks,
  createBlocks,
  deleteBlocks,
  encodeEditorState,
  extractBlockData,
  extractMentions,
  extractTextContent,
  loadBlocks,
  reconcileBlocks,
  recordToTextBlock,
  resolveExpressionAddresses,
  textBlockToRecord,
} from './serialization';
export { contentFromValue, decodeEditorState, encodeBase64Utf8 } from './utils';

// Back-compat: consumers importing blocks from @we/block-shared still work
export { CollectionBlock, ImageBlock, TextBlock } from '@we/models';
