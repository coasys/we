import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';

import { useEditorHost } from '../host';
import { CodeViewer } from './CodeViewer';

export function CodePanel() {
  const session = useEditorHost().session;

  return (
    <Column
      height="100%"
      width="100%"
      bg="neutral-25"
      overflow="hidden"
      onKeyDown={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) session.redo();
          else session.undo();
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
        flexShrink="0"
      >
        <we-text fontSize="500" fontWeight="600">
          Code Editor
        </we-text>
        <we-tooltip title="Close code panel">
          <we-button variant="ghost" size="sm" onClick={() => session.closeCodePanel()}>
            <we-icon name="x" size="sm" />
          </we-button>
        </we-tooltip>
      </Row>

      {/* Code viewer */}
      <CodeViewer
        json={session.schemaJson()}
        onSave={(json) => session.onSchemaEdit(json)}
        readOnly={session.isReadOnly()}
      />
    </Column>
  );
}
