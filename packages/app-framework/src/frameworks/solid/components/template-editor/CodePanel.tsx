import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';

import { useAiStore } from '../../stores/AiStore';
import { CodeViewer } from './CodeViewer';

export function CodePanel() {
  const aiStore = useAiStore();

  return (
    <Column
      height="100%"
      width="100%"
      bg="neutral-25"
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
      {/* Header */}
      <Row
        ax="between"
        ay="center"
        px="400"
        py="300"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        styles={{ 'flex-shrink': '0' }}
      >
        <we-text fontSize="500" fontWeight="600">
          Code Editor
        </we-text>
        <we-tooltip title="Close code panel">
          <we-button variant="ghost" size="sm" onClick={() => aiStore.closeCodePanel()}>
            <we-icon name="x" size="sm" />
          </we-button>
        </we-tooltip>
      </Row>

      {/* Code viewer */}
      <CodeViewer
        json={aiStore.schemaJson()}
        onSave={(json) => aiStore.onSchemaEdit(json)}
        readOnly={aiStore.isReadOnly()}
      />
    </Column>
  );
}
