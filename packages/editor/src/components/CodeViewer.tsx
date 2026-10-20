import { CodeEditor, type CodeEditorLanguage, Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createMemo, createSignal, Show } from 'solid-js';

import { readJson } from '../jsonText';

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
  const [find, setFind] = createSignal<(() => void) | undefined>();
  const [goTo, setGoTo] = createSignal<((offset: number) => void) | undefined>();
  const [matches, setMatches] = createSignal({ query: '', matches: 0, capped: false });
  const [editing, setEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal('');
  const [error, setError] = createSignal('');
  /*
    What was shown when editing began. The text being edited is a copy, so if what it was copied
    from changes meanwhile — somebody saved the template elsewhere, or an AI edit landed — saving the
    copy would put the old version back over the new one without a word. So the panel says so, and
    offers to start again from what is there now.
  */
  const [editBase, setEditBase] = createSignal('');
  const sourceMoved = createMemo(() => editing() && props.json !== editBase());

  const language = () => props.language ?? 'json';

  function startEdit() {
    setEditValue(props.json);
    setEditBase(props.json);
    setError('');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError('');
  }

  function saveEdit() {
    let value = editValue();
    if (language() === 'json') {
      // Trailing commas are let through — what is saved is written out again from the value — and
      // anything else wrong is named by line and column, with the cursor put on it.
      const read = readJson(value);
      if (!read.ok) {
        setError(`Line ${read.line}, column ${read.column}: ${read.message}`);
        goTo()?.(read.offset);
        return;
      }
      value = read.text;
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
        borderBottom={`1px solid ${tokenVar('color', 'border')}`}
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
          <Show when={sourceMoved() && !error()}>
            <we-text fontSize="200" color="warning-text">
              This changed while you were editing it. Saving replaces that change.
            </we-text>
            <we-button size="sm" variant="ghost" onClick={startEdit}>
              Load latest
            </we-button>
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
        {/*
          A door with a handle on it, and an answer to "did it find everything?".

          CodeMirror's search has always been here and only Mod-F opened it, which is no use to
          somebody who does not know it exists — and it reports no count, so this panel could not
          answer the question it is most often open for: whether a value appears once or twice.
        */}
        <we-button size="sm" variant="ghost" onClick={() => find()?.()} disabled={!find()}>
          <we-icon name="magnifying-glass" size="sm" />
          Find
        </we-button>
        <Show when={matches().query}>
          <we-text fontSize="200" color="text-muted">
            {matches().matches === 0
              ? 'No matches'
              : `${matches().matches}${matches().capped ? '+' : ''} ${matches().matches === 1 ? 'match' : 'matches'}`}
          </we-text>
        </Show>
      </Row>

      {/* Editor */}
      <CodeEditor
        code={editing() ? editValue() : props.json}
        language={language()}
        readOnly={!editing()}
        onChange={setEditValue}
        onReady={(api) => {
          setFind(() => api.find);
          setGoTo(() => api.goTo);
        }}
        onSearchMatches={setMatches}
        styles={{ flex: '1', 'min-height': '0' }}
      />
    </Column>
  );
}
