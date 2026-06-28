import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createSignal, Show } from 'solid-js';

export interface CodeViewerProps {
  json: string;
  onSave?: (json: string) => void;
  readOnly?: boolean;
}

function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => copyViaExecCommand(text));
  } else {
    copyViaExecCommand(text);
  }
}

function copyViaExecCommand(text: string) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
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
      <Row ay="center" gap="200" px="400" py="200" borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}>
        <Show
          when={editing()}
          fallback={
            <Show when={!props.readOnly && props.onSave}>
              <we-button size="sm" variant="ghost" onClick={startEdit}>
                <we-icon name="pencil-simple" size="sm" />
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
          <we-button size="sm" variant="ghost" onClick={cancelEdit}>
            Cancel
          </we-button>
          <we-button size="sm" onClick={saveEdit}>
            Save
          </we-button>
        </Show>
        <we-button size="sm" variant="ghost" onClick={() => copyToClipboard(editing() ? editValue() : props.json)}>
          <we-icon name="copy" size="sm" />
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
              margin: tokenVar('space', '300'),
              padding: tokenVar('space', '400'),
              'overflow-y': 'auto',
              'font-size': tokenVar('font-size', '100'),
              'line-height': '1.5',
              background: tokenVar('color', 'neutral-50'),
              color: tokenVar('color', 'neutral-800'),
              'white-space': 'pre-wrap',
              'word-break': 'break-all',
              // 'font-family': 'monospace',
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
          bg="neutral-75"
          m="300"
          on:input={(e: CustomEvent) => setEditValue(e.detail)}
          styles={{
            'font-family': 'monospace',
            'font-size': tokenVar('font-size', '100'),
            'line-height': '1.5',
            border: 'none',
            padding: tokenVar('space', '400'),
          }}
        />
      </Show>
    </Column>
  );
}
