import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createSignal, Show } from 'solid-js';

export interface CodeViewerProps {
  json: string;
  onSave?: (json: string) => void;
  readOnly?: boolean;
}

export function CodeViewer(props: CodeViewerProps) {
  const [editing, setEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal('');
  const [error, setError] = createSignal('');

  function startEdit() {
    setEditValue(props.json);
    setError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError('');
  }

  function saveEdit() {
    try {
      JSON.parse(editValue());
      props.onSave?.(editValue());
      setEditing(false);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  return (
    <Column flex="1" overflow="hidden">
      {/* Toolbar */}
      <Row
        ay="center"
        bg="neutral-50"
        gap="200"
        px="400"
        py="200"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
      >
        <Show
          when={editing()}
          fallback={
            <Show when={!props.readOnly && props.onSave}>
              <we-button size="xs" variant="ghost" onClick={startEdit}>
                <we-icon name="pencil-simple" size="xs" />
                Edit
              </we-button>
            </Show>
          }
        >
          <Show when={error()}>
            <we-text fontSize="200" color="danger-500">
              {error()}
            </we-text>
          </Show>
          <we-button size="xs" variant="ghost" onClick={cancelEdit}>
            Cancel
          </we-button>
          <we-button size="xs" onClick={saveEdit}>
            Save
          </we-button>
        </Show>
        <we-button
          size="xs"
          variant="ghost"
          onClick={() => navigator.clipboard.writeText(editing() ? editValue() : props.json)}
        >
          <we-icon name="copy" size="xs" />
          Copy
        </we-button>
      </Row>

      {/* Content */}
      <Show
        when={editing()}
        fallback={
          <pre
            style={{
              flex: '1',
              margin: '0',
              padding: tokenVar('space', '400'),
              'overflow-y': 'auto',
              'font-size': tokenVar('font-size', '200'),
              'line-height': '1.5',
              background: tokenVar('color', 'neutral-50'),
              color: tokenVar('color', 'neutral-800'),
              'white-space': 'pre-wrap',
              'word-break': 'break-all',
              'font-family': 'monospace',
            }}
          >
            {props.json}
          </pre>
        }
      >
        <we-textarea
          value={editValue()}
          resize="none"
          flex="1"
          bg="neutral-50"
          on:input={(e: CustomEvent) => setEditValue(e.detail)}
          styles={{
            'font-family': 'monospace',
            'font-size': tokenVar('font-size', '200'),
            'line-height': '1.5',
            border: 'none',
          }}
        />
      </Show>
    </Column>
  );
}
