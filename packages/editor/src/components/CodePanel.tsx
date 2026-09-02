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
      /*
        No background of its own: the dock frame paints the panel's surface.

        Every dock is wrapped in a frame that sets `page`, precisely so a docked panel does
        not have to decide what it is made of — see the note in dockRegistry.ts. The editor's panels
        painted `surface-raised` over the top of it, ten lightness points above the page, so they read
        as a different material from every module panel docked at the same edge.
      */
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
