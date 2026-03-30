import {
  AudioBlock,
  CalloutBlock,
  CodeBlock,
  CollectionBlock,
  DividerBlock,
  EmbedBlock,
  EventBlock,
  FileBlock,
  ImageBlock,
  LinkBlock,
  LocationBlock,
  TagBlock,
  TaskBlock,
  TextBlock,
  VideoBlock,
} from '@we/models';

import { registerBlock } from './registry';

let registered = false;

/**
 * Register all core block types.
 * Safe to call multiple times — registrations only happen once.
 */
export function registerCoreBlocks(): void {
  if (registered) return;
  registered = true;
  registerBlock({
    nodeTypes: ['root'],
    model: CollectionBlock,
  });

  registerBlock({
    nodeTypes: ['paragraph', 'heading', 'quote', 'list', 'listitem', 'text'],
    model: TextBlock,
  });

  registerBlock({
    nodeTypes: ['image'],
    model: ImageBlock,
  });

  registerBlock({
    nodeTypes: ['audio'],
    model: AudioBlock,
  });

  registerBlock({
    nodeTypes: ['video'],
    model: VideoBlock,
  });

  registerBlock({
    nodeTypes: ['file'],
    model: FileBlock,
  });

  registerBlock({
    nodeTypes: ['event'],
    model: EventBlock,
  });

  registerBlock({
    nodeTypes: ['task'],
    model: TaskBlock,
  });

  registerBlock({
    nodeTypes: ['location'],
    model: LocationBlock,
  });

  registerBlock({
    nodeTypes: ['link'],
    model: LinkBlock,
  });

  registerBlock({
    nodeTypes: ['code'],
    model: CodeBlock,
  });

  registerBlock({
    nodeTypes: ['tag'],
    model: TagBlock,
  });

  registerBlock({
    nodeTypes: ['embed'],
    model: EmbedBlock,
  });

  registerBlock({
    nodeTypes: ['callout'],
    model: CalloutBlock,
  });

  registerBlock({
    nodeTypes: ['divider'],
    model: DividerBlock,
  });
}
