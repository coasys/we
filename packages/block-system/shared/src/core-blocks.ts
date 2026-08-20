// The entity proxies, not the AD4M classes: every fact the persistence layer needs beyond the
// call surface — which fields exist, which hold files — now comes from the manifest, so the
// stand-ins resolve everything and the block layer stops caring which backend is connected.
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
  registerBlock({ nodeTypes: ['root'], model: CollectionBlock, entity: 'CollectionBlock' });
  registerBlock({ nodeTypes: ['collection'], model: CollectionBlock, entity: 'CollectionBlock' });
  registerBlock({
    nodeTypes: ['paragraph', 'heading', 'quote', 'list', 'listitem', 'text'],
    model: TextBlock,
    entity: 'TextBlock',
  });
  registerBlock({ nodeTypes: ['image'], model: ImageBlock, entity: 'ImageBlock' });
  registerBlock({ nodeTypes: ['audio'], model: AudioBlock, entity: 'AudioBlock' });
  registerBlock({ nodeTypes: ['video'], model: VideoBlock, entity: 'VideoBlock' });
  registerBlock({ nodeTypes: ['file'], model: FileBlock, entity: 'FileBlock' });
  registerBlock({ nodeTypes: ['event'], model: EventBlock, entity: 'EventBlock' });
  registerBlock({ nodeTypes: ['task'], model: TaskBlock, entity: 'TaskBlock' });
  registerBlock({ nodeTypes: ['location'], model: LocationBlock, entity: 'LocationBlock' });
  registerBlock({ nodeTypes: ['link'], model: LinkBlock, entity: 'LinkBlock' });
  registerBlock({ nodeTypes: ['code'], model: CodeBlock, entity: 'CodeBlock' });
  registerBlock({ nodeTypes: ['tag'], model: TagBlock, entity: 'TagBlock' });
  registerBlock({ nodeTypes: ['embed'], model: EmbedBlock, entity: 'EmbedBlock' });
  registerBlock({ nodeTypes: ['callout'], model: CalloutBlock, entity: 'CalloutBlock' });
  registerBlock({ nodeTypes: ['divider'], model: DividerBlock, entity: 'DividerBlock' });
}
