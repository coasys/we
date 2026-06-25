import { Column } from '@we/components/solid';
import { Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';

export function EditorOverlay() {
  const aiStore = useAiStore();

  return (
    <>
      {/* Visual editor placeholder */}
      <Show when={aiStore.contentMode() === 'visual'}>
        <Column
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          zIndex={5}
          bg="neutral-50"
          ax="center"
          ay="center"
          gap="300"
        >
          <we-icon name="pencil-ruler" size="xl" color="neutral-300" />
          <we-text variant="heading-sm" color="neutral-400">
            Visual Editor
          </we-text>
          <we-text fontSize="300" color="neutral-300" textAlign="center">
            Coming soon — design your template visually
          </we-text>
        </Column>
      </Show>
    </>
  );
}
