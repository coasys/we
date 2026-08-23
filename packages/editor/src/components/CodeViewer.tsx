import { CodeEditor, type CodeEditorLanguage, Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createSignal, Show } from 'solid-js';

export interface CodeViewerProps {
  json: string;
  language?: CodeEditorLanguage;
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

  const language = () => props.language ?? 'json';

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
    const value = editValue();
    if (language() === 'json') {
      try {
        JSON.parse(value);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid JSON');
        return;
      }
    }
    props.onSave?.(value);
    setEditing(false);
    setError('');
  }

  return (
    <Column flex="1" overflow="hidden">
      {/* Toolbar */}
      <Row
        ay="center"
        gap="200"
        px="400"
        py="200"
        borderBottom={`1px solid ${tokenVar('color', 'ui-200')}`}
        flexShrink="0"
      >
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
            <we-text fontSize="200" color="danger-text">
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

      {/* Editor */}
      <CodeEditor
        code={editing() ? editValue() : props.json}
        language={language()}
        readOnly={!editing()}
        onChange={setEditValue}
        styles={{ flex: '1', 'min-height': '0' }}
      />
    </Column>
  );
}
