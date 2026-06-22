import { Column } from '@we/components/solid';
import { Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { CodeViewer } from './CodeViewer';

export function EditorOverlay() {
  const aiStore = useAiStore();

  return (
    <>
      {/* Code editor — full-width overlay over the template preview */}
      <Show when={aiStore.contentMode() === 'code'}>
        <Column
          position="absolute"
          top="0"
          left="0"
          width="100%"
          height="100%"
          zIndex={5}
          overflow="hidden"
          onKeyDown={(e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
              e.preventDefault();
              if (e.shiftKey) aiStore.redo();
              else aiStore.undo();
            }
          }}
          tabIndex={0}
        >
          <CodeViewer
            json={aiStore.schemaJson()}
            onSave={(json) => aiStore.onSchemaEdit(json)}
            readOnly={aiStore.isReadOnly()}
          />
        </Column>
      </Show>

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
