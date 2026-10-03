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

/**
 * The editor's own box.
 *
 * `height: 100%` by default, which is what a panel filling a dock needs. A caller that passes
 * `maxHeight` gets the opposite arrangement — auto height with a ceiling — so a short document
 * takes only the room it needs and a long one scrolls inside the cap rather than reserving the
 * full height regardless.
 */
/**
 * Where counting matches stops.
 *
 * High enough that a real search — a prop name, an id — is counted exactly, and low enough that
 * typing one character into the box over a half-megabyte schema is not a scan of the whole thing
 * per keystroke. Past it the caller says "500+", which answers the question a count is asked for.
 */
const MATCH_CAP = 500;

function themeSpecFor(maxHeight?: string): Record<string, Record<string, string>> {
  if (!maxHeight) return baseThemeSpec;
  return { ...baseThemeSpec, '&': { ...baseThemeSpec['&'], height: 'auto', maxHeight } };
}

const baseThemeSpec: Record<string, Record<string, string>> = {
  '&': {
    height: '100%',
    fontSize: 'var(--we-font-size-100)',
    fontFamily: 'monospace',
    backgroundColor: 'var(--we-role-page)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--we-role-text)',
    padding: 'var(--we-space-400)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--we-role-surface-hover)',
    borderRight: '1px solid var(--we-role-border)',
    color: 'var(--we-role-text-faint)',
    userSelect: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--we-role-surface-sunken)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--we-role-surface-active)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--we-role-surface-active)',
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
    backgroundColor: 'var(--we-role-surface)',
    borderTop: '1px solid var(--we-role-border)',
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
    background: 'var(--we-role-page)',
    border: '1px solid var(--we-role-border)',
    borderRadius: 'var(--we-radius-200)',
    padding: '2px 8px',
    color: 'var(--we-role-text)',
    outline: 'none',
    height: '26px',
  },
  '.cm-search input:focus': {
    borderColor: 'var(--we-role-accent)',
  },
  '.cm-search button': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    background: 'var(--we-role-surface-sunken)',
    border: '1px solid var(--we-role-border)',
    borderRadius: 'var(--we-radius-200)',
    padding: '2px 8px',
    cursor: 'pointer',
    color: 'var(--we-role-text)',
    height: '26px',
  },
  '.cm-search button:hover': {
    background: 'var(--we-role-control-surface)',
  },
  '.cm-panel.cm-search [name=close]': {
    background: 'none',
    border: 'none',
    color: 'var(--we-role-text-muted)',
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
  // The caret is chrome, not syntax — it marks where typing goes, so it is the text colour. The
  // palette exemption below covers the tokens beneath it and not this.
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--we-role-text)',
  },
  /*
    Syntax tokens are a palette, so they keep their scale positions: a theme pinning `dangerText`
    means "make my error messages this", not "recolour every string literal". They still follow the
    hue and polarity parameters. The editor's *chrome* above — gutter, panel, selection, borders —
    is UI and does take roles. (Comments are the one crossover: faint text is faint text.)
  */
  // Syntax tokens (.tok-* classes from classHighlighter)
  '.tok-propertyName': { color: 'var(--we-role-accent-text)' },
  '.tok-string': { color: 'var(--we-color-success-600)' },
  '.tok-number, .tok-integer, .tok-float': { color: 'var(--we-color-warning-600)' },
  '.tok-bool, .tok-null, .tok-atom': { color: 'var(--we-color-danger-500)' },
  '.tok-keyword, .tok-controlKeyword, .tok-moduleKeyword': { color: 'var(--we-color-primary-700)', fontWeight: 'bold' },
  '.tok-comment, .tok-lineComment, .tok-blockComment': { color: 'var(--we-role-text-faint)', fontStyle: 'italic' },
  '.tok-tagName': { color: 'var(--we-role-accent)' },
  '.tok-className, .tok-labelName': { color: 'var(--we-color-success-700)' },
  '.tok-unit': { color: 'var(--we-color-warning-500)' },
  '.tok-color': { color: 'var(--we-color-success-600)' },
  '.tok-operator, .tok-punctuation': { color: 'var(--we-role-text-muted)' },
  '.tok-invalid': { color: 'var(--we-color-danger-600)', textDecoration: 'underline' },
};

export function CodeEditor(props: CodeEditorProps) {
  let containerRef!: HTMLDivElement;
  let view: EditorView | undefined;
  // Captured from the loaded module so the effects below can reconfigure without importing again.
  let readOnlyCompartment: Compartment | undefined;
  let state: typeof EditorState | undefined;
  /** The query the count was last reported for, so typing in the document does not recount it. */
  let lastQuery = '';

  onMount(async () => {
    const [langCss, langJson, language, cmState, cmView, highlight, cm, cmSearch] = await Promise.all([
      import('@codemirror/lang-css'),
      import('@codemirror/lang-json'),
      import('@codemirror/language'),
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@lezer/highlight'),
      import('codemirror'),
      import('@codemirror/search'),
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
        cmView.EditorView.theme(themeSpecFor(props.maxHeight)),
        /*
          Mod-S saves.

          `onSave` was in the props type, documented, passed by callers — and bound to nothing. The
          editor took the browser's own Save-page dialog instead, which is the one keystroke every
          person editing text in a box will try. Registered ahead of `basicSetup`'s keymap
          (`Prec.highest`) so nothing there can claim it first, and it returns `true` so the browser
          does not also act on it.
        */
        cmState.Prec.highest(
          cmView.keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: (target) => {
                props.onSave?.(target.state.doc.toString());
                return true;
              },
            },
          ]),
        ),
        /*
          The find bar at the TOP, under whatever toolbar the caller has.

          CodeMirror puts it at the bottom by default, which on a tall docked panel is the far
          end of the document from the control that opened it and from the count beside that
          control. Top keeps the three together.
        */
        cmSearch.search({ top: true }),
        /*
          How many matches there are, reported outward.

          CodeMirror's panel shows none, so "did it find everything?" is unanswerable — which
          matters most where this editor is used to CHECK something, as it was when reading
          whether an AI edit had reached one node or two.

          Counted here and not drawn here: the panel is CodeMirror's DOM, and appending to it
          would be a guess about markup nobody promised. STOPPED at a cap, because a schema runs
          to hundreds of thousands of characters and a one-character query matches most of them,
          on every keystroke.
        */
        cmView.EditorView.updateListener.of((update) => {
          if (!props.onSearchMatches) return;
          const query = cmSearch.getSearchQuery(update.state);
          const text = query.search;
          if (text === lastQuery && !update.docChanged) return;
          lastQuery = text;
          if (!text || !query.valid) return props.onSearchMatches({ query: '', matches: 0, capped: false });

          let matches = 0;
          let capped = false;
          const cursor = query.getCursor(update.state);
          for (let next = cursor.next(); !next.done; next = cursor.next()) {
            if (++matches >= MATCH_CAP) {
              capped = true;
              break;
            }
          }
          props.onSearchMatches({ query: text, matches, capped });
        }),
      ],
      parent: containerRef,
      root: containerRef.ownerDocument,
    });

    props.onReady?.({ find: () => view && cmSearch.openSearchPanel(view) });
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
