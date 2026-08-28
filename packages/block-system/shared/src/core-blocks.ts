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
 *
 * The node type is what a content block carries as `_type`: `'block'` for text (Portable Text's
 * name for it), `'collection'` for a nested composition, and the block's own name for everything
 * else. `'root'` is the composition itself — the collection the composer saves into.
 */
export function registerCoreBlocks(): void {
  if (registered) return;
  registered = true;
  registerBlock({ nodeTypes: ['root', 'collection'], model: CollectionBlock, entity: 'CollectionBlock' });
  registerBlock({ nodeTypes: ['block'], model: TextBlock, entity: 'TextBlock' });
  registerBlock({ nodeTypes: ['image'], model: ImageBlock, entity: 'ImageBlock' });
  registerBlock({ nodeTypes: ['audio'], model: AudioBlock, entity: 'AudioBlock' });
  registerBlock({ nodeTypes: ['video'], model: VideoBlock, entity: 'VideoBlock' });
  registerBlock({ nodeTypes: ['file'], model: FileBlock, entity: 'FileBlock' });
  registerBlock({ nodeTypes: ['event'], model: EventBlock, entity: 'EventBlock' });
  registerBlock({ nodeTypes: ['task'], model: TaskBlock, entity: 'TaskBlock' });
  registerBlock({ nodeTypes: ['location'], model: LocationBlock, entity: 'LocationBlock' });
  registerBlock({ nodeTypes: ['link'], model: LinkBlock, entity: 'LinkBlock' });
  registerBlock({ nodeTypes: ['tag'], model: TagBlock, entity: 'TagBlock' });
  registerBlock({ nodeTypes: ['code'], model: CodeBlock, entity: 'CodeBlock' });
  registerBlock({ nodeTypes: ['callout'], model: CalloutBlock, entity: 'CalloutBlock' });
  registerBlock({ nodeTypes: ['divider'], model: DividerBlock, entity: 'DividerBlock' });
  registerBlock({ nodeTypes: ['embed'], model: EmbedBlock, entity: 'EmbedBlock' });
}
