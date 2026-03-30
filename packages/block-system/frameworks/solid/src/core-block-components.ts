import { updateBlockRegistration } from '@we/block-shared';

import { ImageDisplay } from './components/ImageBlock/ImageDisplay';
import { ImageInput } from './components/ImageBlock/ImageInput';

let registered = false;

/**
 * Register display and input components for core block types.
 * Call after `registerCoreBlocks()` has registered the models.
 * Safe to call multiple times.
 */
export function registerCoreBlockComponents(): void {
  if (registered) return;
  registered = true;

  updateBlockRegistration('image', {
    display: ImageDisplay,
    input: ImageInput,
  });
}
