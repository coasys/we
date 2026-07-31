/**
 * Factory-created Lexical node classes for all non-text block types.
 * Each is a DecoratorNode produced by createBlockNodeClass().
 * Register these in BlockComposer/BlockRenderer initialConfig.nodes.
 */
import { CollectionBlockNode } from './CollectionBlockNode';
import { createBlockNodeClass } from './createBlockNodeClass';

export { CollectionBlockNode };

export const ImageBlockNode = createBlockNodeClass('image');
export const AudioBlockNode = createBlockNodeClass('audio');
export const VideoBlockNode = createBlockNodeClass('video');
export const FileBlockNode = createBlockNodeClass('file');
export const CodeBlockNode = createBlockNodeClass('code');
export const CalloutBlockNode = createBlockNodeClass('callout');
export const DividerBlockNode = createBlockNodeClass('divider');
export const EmbedBlockNode = createBlockNodeClass('embed');
export const EventBlockNode = createBlockNodeClass('event');
export const TaskBlockNode = createBlockNodeClass('task');
export const LocationBlockNode = createBlockNodeClass('location');
export const LinkBlockNode = createBlockNodeClass('link');
export const TagBlockNode = createBlockNodeClass('tag');

/** All factory block node classes, for registration with Lexical. */
export const blockNodeClasses = [
  CollectionBlockNode as unknown as ReturnType<typeof createBlockNodeClass>,
  ImageBlockNode,
  AudioBlockNode,
  VideoBlockNode,
  FileBlockNode,
  CodeBlockNode,
  CalloutBlockNode,
  DividerBlockNode,
  EmbedBlockNode,
  EventBlockNode,
  TaskBlockNode,
  LocationBlockNode,
  LinkBlockNode,
  TagBlockNode,
];

/** Map from block type string to its factory node class. */
export const blockNodeClassMap: Record<string, ReturnType<typeof createBlockNodeClass>> = {};
for (const cls of blockNodeClasses) {
  blockNodeClassMap[cls.getType()] = cls;
}
