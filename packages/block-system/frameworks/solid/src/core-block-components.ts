import { updateBlockRegistration } from '@we/block-shared';

import {
  AudioDisplay,
  AudioInput,
  CalloutDisplay,
  CalloutInput,
  CodeDisplay,
  CodeInput,
  CollectionDisplay,
  CollectionInput,
  DividerDisplay,
  DividerInput,
  EmbedDisplay,
  EmbedInput,
  EventDisplay,
  EventInput,
  FileDisplay,
  FileInput,
  ImageDisplay,
  ImageInput,
  LinkDisplay,
  LinkInput,
  LocationDisplay,
  LocationInput,
  TagDisplay,
  TagInput,
  TaskDisplay,
  TaskInput,
  VideoDisplay,
  VideoInput,
} from './components';

let registered = false;

/**
 * Register display and input components for core block types.
 * Call after `registerCoreBlocks()` has registered the models.
 * Safe to call multiple times.
 */
export function registerCoreBlockComponents(): void {
  if (registered) return;
  registered = true;

  updateBlockRegistration('image', { display: ImageDisplay, input: ImageInput });
  updateBlockRegistration('audio', { display: AudioDisplay, input: AudioInput });
  updateBlockRegistration('video', { display: VideoDisplay, input: VideoInput });
  updateBlockRegistration('file', { display: FileDisplay, input: FileInput });
  updateBlockRegistration('embed', { display: EmbedDisplay, input: EmbedInput });
  updateBlockRegistration('code', { display: CodeDisplay, input: CodeInput });
  updateBlockRegistration('callout', { display: CalloutDisplay, input: CalloutInput });
  updateBlockRegistration('divider', { display: DividerDisplay, input: DividerInput });
  updateBlockRegistration('link', { display: LinkDisplay, input: LinkInput });
  updateBlockRegistration('event', { display: EventDisplay, input: EventInput });
  updateBlockRegistration('task', { display: TaskDisplay, input: TaskInput });
  updateBlockRegistration('location', { display: LocationDisplay, input: LocationInput });
  updateBlockRegistration('tag', { display: TagDisplay, input: TagInput });
  updateBlockRegistration('collection', { display: CollectionDisplay, input: CollectionInput });
}
