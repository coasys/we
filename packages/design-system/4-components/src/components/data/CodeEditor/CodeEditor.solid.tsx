/**
 * CodeMirror arrives when an editor is actually mounted.
 *
 * This component lives in the same bundle as every layout primitive, so a static import put a full
 * code editor — CodeMirror's view, state, language modes and highlighter, around 270 KB — into any
 * page that used a `Column`. Type-only imports below cost nothing; the runtime pieces are fetched
 * in `onMount`, which is the first moment one is genuinely needed.
 *
 * The theme is a plain object rather than `EditorView.theme(...)` for the same reason: calling into
 * CodeMirror at module scope would defeat the deferral.
 */
import type { Compartment, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { createEffect, onCleanup, onMount } from 'solid-js';

export type * from './CodeEditor.types';
import type { CodeEditorProps } from './CodeEditor.types';

const baseThemeSpec: Record<string, Record<string, string>> = {
  '&': {
    height: '100%',
    fontSize: 'var(--we-font-size-100)',
    fontFamily: 'monospace',
    backgroundColor: 'var(--we-color-neutral-50)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--we-color-neutral-800)',
    padding: 'var(--we-space-400)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--we-color-neutral-75)',
    borderRight: '1px solid var(--we-color-neutral-200)',
    color: 'var(--we-color-neutral-400)',
    userSelect: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--we-color-neutral-100)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--we-color-neutral-200)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--we-color-neutral-200)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    cursor: 'pointer',
    padding: '0 4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-foldGutter .cm-gutterElement > span': {
    fontSize: '14px',
    lineHeight: '1',
  },
  '.cm-foldGutter .cm-gutterElement > span[title="Fold line"]': {
    position: 'relative',
    top: '-3px',
  },
  // Search panel
  '.cm-panels-bottom': {
    all: 'unset',
  },
  '.cm-panel.cm-search': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    backgroundColor: 'var(--we-color-neutral-0)',
    borderTop: '1px solid var(--we-color-neutral-100)',
    flexWrap: 'wrap',
    fontSize: 'var(--we-font-size-100)',
  },
  '.cm-search label': {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
  },
  '.cm-search input': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    background: 'var(--we-color-neutral-50)',
    border: '1px solid var(--we-color-neutral-200)',
    borderRadius: 'var(--we-radius-200)',
    padding: '2px 8px',
    color: 'var(--we-color-neutral-800)',
    outline: 'none',
    height: '26px',
  },
  '.cm-search input:focus': {
    borderColor: 'var(--we-color-primary-400)',
  },
  '.cm-search button': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    background: 'var(--we-color-neutral-100)',
    border: '1px solid var(--we-color-neutral-200)',
    borderRadius: 'var(--we-radius-200)',
    padding: '2px 8px',
    cursor: 'pointer',
    color: 'var(--we-color-neutral-700)',
    height: '26px',
  },
  '.cm-search button:hover': {
    background: 'var(--we-color-neutral-200)',
  },
  '.cm-panel.cm-search [name=close]': {
    background: 'none',
    border: 'none',
    color: 'var(--we-color-neutral-500)',
    padding: '2px 4px',
    fontSize: '20px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--we-color-warning-200)',
    outline: '1px solid var(--we-color-warning-400)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--we-color-primary-200)',
    outline: '1px solid var(--we-color-primary-500)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  // Cursor
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--we-color-neutral-700)',
  },
  // Syntax tokens (.tok-* classes from classHighlighter)
  '.tok-propertyName': { color: 'var(--we-color-primary-600)' },
  '.tok-string': { color: 'var(--we-color-success-600)' },
  '.tok-number, .tok-integer, .tok-float': { color: 'var(--we-color-warning-600)' },
  '.tok-bool, .tok-null, .tok-atom': { color: 'var(--we-color-danger-500)' },
  '.tok-keyword, .tok-controlKeyword, .tok-moduleKeyword': { color: 'var(--we-color-primary-700)', fontWeight: 'bold' },
  '.tok-comment, .tok-lineComment, .tok-blockComment': { color: 'var(--we-color-neutral-400)', fontStyle: 'italic' },
  '.tok-tagName': { color: 'var(--we-color-primary-500)' },
  '.tok-className, .tok-labelName': { color: 'var(--we-color-success-700)' },
  '.tok-unit': { color: 'var(--we-color-warning-500)' },
  '.tok-color': { color: 'var(--we-color-success-600)' },
  '.tok-operator, .tok-punctuation': { color: 'var(--we-color-neutral-500)' },
  '.tok-invalid': { color: 'var(--we-color-danger-600)', textDecoration: 'underline' },
};

export function CodeEditor(props: CodeEditorProps) {
  let containerRef!: HTMLDivElement;
  let view: EditorView | undefined;
  // Captured from the loaded module so the effects below can reconfigure without importing again.
  let readOnlyCompartment: Compartment | undefined;
  let state: typeof EditorState | undefined;

  onMount(async () => {
    const [langCss, langJson, language, cmState, cmView, highlight, cm] = await Promise.all([
      import('@codemirror/lang-css'),
      import('@codemirror/lang-json'),
      import('@codemirror/language'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@lezer/highlight'),
      import('codemirror'),
    ]);

    // The component can unmount while the editor is still loading; without this the view mounts
    // into a detached node and is never cleaned up.
    if (!containerRef.isConnected) return;

    readOnlyCompartment = new cmState.Compartment();
    state = cmState.EditorState;

    view = new cmView.EditorView({
      doc: props.code ?? '',
      extensions: [
        cm.basicSetup,
        language.syntaxHighlighting(highlight.classHighlighter),
        props.language === 'css' ? langCss.css() : langJson.json(),
        readOnlyCompartment.of(cmState.EditorState.readOnly.of(props.readOnly ?? false)),
        cmView.EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const value = update.state.doc.toString();
            props.onChange?.(value);
          }
        }),
        cmView.EditorView.theme(baseThemeSpec),
      ],
      parent: containerRef,
      root: containerRef.ownerDocument,
    });
  });

  // Sync external code changes (e.g. undo/redo from outside, node switching)
  createEffect(() => {
    const incoming = props.code ?? '';
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== incoming) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: incoming },
      });
    }
  });

  // Sync readOnly changes
  createEffect(() => {
    const readOnly = props.readOnly ?? false;
    if (!view || !readOnlyCompartment || !state) return;
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(state.readOnly.of(readOnly)),
    });
  });

  onCleanup(() => {
    view?.destroy();
    view = undefined;
  });

  return <div class="we-code-editor" ref={containerRef} style={props.styles} onPointerDown={() => view?.focus()} />;
}
